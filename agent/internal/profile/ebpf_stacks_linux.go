//go:build linux && ebpf

package profile

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64,arm64 profileStacks ../../bpf/profile_stacks.c -- -I../../bpf

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
)

const maxInlineStack = 16

type stackHit struct {
	addrs []uint64
	count uint64
}

type ebpfStackSampler struct {
	objs      profileStacksObjects
	link      link.Link
	reader    *ringbuf.Reader
	mu        sync.Mutex
	hits      map[int]map[string]*stackHit
	totalHits uint64
	cancel    context.CancelFunc
}

func newPlatformStackSampler() StackSampler {
	if os.Getenv("KERN_STACK_SAMPLER") == "0" {
		log.Printf("eBPF CPU stack sampler disabled (KERN_STACK_SAMPLER=0)")
		return noopStackSampler{}
	}
	sampler, err := newEBPFStackSampler()
	if err != nil {
		log.Printf("eBPF CPU stack sampler unavailable: %v", err)
		return noopStackSampler{}
	}
	return sampler
}

func newEBPFStackSampler() (*ebpfStackSampler, error) {
	objs := profileStacksObjects{}
	if err := loadProfileStacksObjects(&objs, nil); err != nil {
		return nil, err
	}

	tp, err := link.Tracepoint("sched", "sched_switch", objs.TpProfileSchedSwitch, nil)
	if err != nil {
		_ = objs.Close()
		return nil, err
	}

	reader, err := ringbuf.NewReader(objs.KernProfileStackEvents)
	if err != nil {
		_ = tp.Close()
		_ = objs.Close()
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	s := &ebpfStackSampler{
		objs:   objs,
		link:   tp,
		reader: reader,
		hits:   make(map[int]map[string]*stackHit),
		cancel: cancel,
	}
	go s.consume(ctx)
	go s.pruneLoop(ctx)
	go s.statsLoop(ctx)
	log.Printf("eBPF CPU stack sampler attached (sched_switch ~100Hz/cpu, deferred symbolize)")
	return s, nil
}

func (s *ebpfStackSampler) Available() bool {
	return s != nil && s.reader != nil
}

func (s *ebpfStackSampler) Close() {
	if s == nil {
		return
	}
	if s.cancel != nil {
		s.cancel()
	}
	if s.reader != nil {
		_ = s.reader.Close()
	}
	if s.link != nil {
		_ = s.link.Close()
	}
	_ = s.objs.Close()
}

func (s *ebpfStackSampler) consume(ctx context.Context) {
	// event: ts_ns u64 | pid u32 | n_ips u32 | ips[16] u64
	const header = 16
	const ipBytes = 8 * maxInlineStack
	minSize := header + 8 // at least one ip slot

	for {
		record, err := s.reader.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) || ctx.Err() != nil {
				return
			}
			continue
		}
		raw := record.RawSample
		if len(raw) < minSize {
			continue
		}
		pid := int(binary.LittleEndian.Uint32(raw[8:12]))
		nIPs := int(binary.LittleEndian.Uint32(raw[12:16]))
		if pid <= 0 || nIPs <= 0 {
			continue
		}
		if nIPs > maxInlineStack {
			nIPs = maxInlineStack
		}
		need := header + nIPs*8
		if len(raw) < need {
			if len(raw) < header+ipBytes {
				continue
			}
			nIPs = (len(raw) - header) / 8
		}

		addrs := make([]uint64, 0, nIPs)
		for i := 0; i < nIPs; i++ {
			off := header + i*8
			addr := binary.LittleEndian.Uint64(raw[off : off+8])
			if addr == 0 {
				break
			}
			addrs = append(addrs, addr)
		}
		if len(addrs) == 0 {
			continue
		}

		// Cheap signature from raw IPs — symbolize only when building flames.
		var sigBuilder strings.Builder
		sigBuilder.Grow(len(addrs) * 17)
		for i, addr := range addrs {
			if i > 0 {
				sigBuilder.WriteByte('|')
			}
			sigBuilder.WriteString(strconv.FormatUint(addr, 16))
		}
		sig := sigBuilder.String()

		s.mu.Lock()
		byPID, ok := s.hits[pid]
		if !ok {
			byPID = make(map[string]*stackHit)
			s.hits[pid] = byPID
		}
		if hit, exists := byPID[sig]; exists {
			hit.count++
		} else {
			byPID[sig] = &stackHit{addrs: addrs, count: 1}
		}
		s.totalHits++
		s.mu.Unlock()
	}
}

func (s *ebpfStackSampler) statsLoop(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			total := s.totalHits
			pids := len(s.hits)
			s.mu.Unlock()
			if total > 0 {
				log.Printf("eBPF stack sampler: %d hits across %d threads", total, pids)
			}
		}
	}
}

func (s *ebpfStackSampler) pruneLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			for pid, bySig := range s.hits {
				if len(bySig) > 64 {
					type pair struct {
						sig   string
						count uint64
					}
					ordered := make([]pair, 0, len(bySig))
					for sig, hit := range bySig {
						ordered = append(ordered, pair{sig: sig, count: hit.count})
					}
					sort.Slice(ordered, func(i, j int) bool {
						return ordered[i].count > ordered[j].count
					})
					keep := make(map[string]*stackHit, 48)
					for i := 0; i < len(ordered) && i < 48; i++ {
						keep[ordered[i].sig] = bySig[ordered[i].sig]
					}
					s.hits[pid] = keep
				}
			}
			s.mu.Unlock()
		}
	}
}

func (s *ebpfStackSampler) SampleTopProcess(pid int) []string {
	frames := s.FlameFrames(pid)
	out := make([]string, 0, len(frames))
	for _, frame := range frames {
		if frame.Depth >= 1 {
			out = append(out, frame.Label)
		}
	}
	if len(out) > 16 {
		out = out[:16]
	}
	return out
}

func (s *ebpfStackSampler) HotStacks(limit int) [][]string {
	if !s.Available() || limit <= 0 {
		return nil
	}
	type scored struct {
		addrs []uint64
		count uint64
	}
	s.mu.Lock()
	var all []scored
	for _, bySig := range s.hits {
		for _, hit := range bySig {
			all = append(all, scored{addrs: hit.addrs, count: hit.count})
		}
	}
	s.mu.Unlock()
	sort.Slice(all, func(i, j int) bool { return all[i].count > all[j].count })
	if len(all) > limit {
		all = all[:limit]
	}
	out := make([][]string, 0, len(all))
	for _, item := range all {
		out = append(out, resolveStackAddrs(item.addrs))
	}
	return out
}

func (s *ebpfStackSampler) FlameFrames(pid int) []StackFrame {
	if !s.Available() || pid <= 0 {
		return nil
	}

	s.mu.Lock()
	bySig := map[string]*stackHit{}
	tgidCache := map[int]int{}
	for tid, hits := range s.hits {
		if tid == pid || sameProcessCached(pid, tid, tgidCache) {
			for sig, hit := range hits {
				if existing, ok := bySig[sig]; ok {
					existing.count += hit.count
				} else {
					cp := *hit
					bySig[sig] = &cp
				}
			}
		}
	}
	// If no thread match yet, use hottest node-wide stacks so UI can still report ebpf.
	if len(bySig) == 0 {
		for _, hits := range s.hits {
			for sig, hit := range hits {
				if existing, ok := bySig[sig]; ok {
					existing.count += hit.count
				} else {
					cp := *hit
					bySig[sig] = &cp
				}
			}
		}
	}

	type scored struct {
		addrs []uint64
		count uint64
	}
	scoredHits := make([]scored, 0, len(bySig))
	var total uint64
	for _, hit := range bySig {
		scoredHits = append(scoredHits, scored{addrs: hit.addrs, count: hit.count})
		total += hit.count
	}
	s.mu.Unlock()

	if total == 0 || len(scoredHits) == 0 {
		return nil
	}

	sort.Slice(scoredHits, func(i, j int) bool {
		return scoredHits[i].count > scoredHits[j].count
	})
	if len(scoredHits) > 12 {
		scoredHits = scoredHits[:12]
	}

	type resolved struct {
		frames []string
		count  uint64
	}
	resolvedHits := make([]resolved, 0, len(scoredHits))
	for _, hit := range scoredHits {
		frames := resolveStackAddrs(hit.addrs)
		if len(frames) == 0 {
			continue
		}
		resolvedHits = append(resolvedHits, resolved{frames: frames, count: hit.count})
	}
	if len(resolvedHits) == 0 {
		return nil
	}

	type node struct {
		label    string
		count    uint64
		children map[string]*node
	}
	root := &node{label: "all", children: map[string]*node{}}
	for _, hit := range resolvedHits {
		cur := root
		cur.count += hit.count
		for i := len(hit.frames) - 1; i >= 0; i-- {
			label := hit.frames[i]
			child, ok := cur.children[label]
			if !ok {
				child = &node{label: label, children: map[string]*node{}}
				cur.children[label] = child
			}
			child.count += hit.count
			cur = child
		}
	}

	frames := make([]StackFrame, 0, 64)
	var walk func(n *node, depth int, offset float64, parentWidth float64)
	walk = func(n *node, depth int, offset float64, parentWidth float64) {
		width := parentWidth
		if root.count > 0 && depth > 0 {
			width = parentWidth * (float64(n.count) / float64(root.count))
		}
		if depth == 0 {
			width = 1
		}
		share := 100 * float64(n.count) / float64(root.count)
		frames = append(frames, StackFrame{
			ID:       fmt.Sprintf("cpu-%d-%s", depth, n.label),
			Label:    n.label,
			Depth:    depth,
			Width:    width,
			Offset:   offset,
			Heat:     min(1, 0.15+float64(n.count)/float64(root.count)),
			SharePct: int(share + 0.5),
			Samples:  int(n.count),
			Kind:     "cpu",
		})
		childList := make([]*node, 0, len(n.children))
		for _, child := range n.children {
			childList = append(childList, child)
		}
		sort.Slice(childList, func(i, j int) bool {
			return childList[i].count > childList[j].count
		})
		childOffset := offset
		for _, child := range childList {
			childWidth := width * (float64(child.count) / float64(n.count))
			walk(child, depth+1, childOffset, width)
			childOffset += childWidth
		}
	}
	walk(root, 0, 0, 1)
	return frames
}

type noopStackSampler struct{}

func (noopStackSampler) Available() bool               { return false }
func (noopStackSampler) SampleTopProcess(int) []string { return nil }
func (noopStackSampler) FlameFrames(int) []StackFrame  { return nil }
func (noopStackSampler) Close()                        {}

func sameProcessCached(tgid, tid int, cache map[int]int) bool {
	if tgid <= 0 || tid <= 0 {
		return false
	}
	if tgid == tid {
		return true
	}
	if cached, ok := cache[tid]; ok {
		return cached == tgid
	}
	parsed := readTgid(tid)
	cache[tid] = parsed
	return parsed == tgid
}

func readTgid(tid int) int {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", tid))
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "Tgid:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				var parsed int
				_, _ = fmt.Sscanf(fields[1], "%d", &parsed)
				return parsed
			}
		}
	}
	return 0
}

func sameProcess(tgid, tid int) bool {
	return sameProcessCached(tgid, tid, map[int]int{})
}
