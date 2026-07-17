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

// const maxInlineStack = 16
const maxInlineStack = 12

const (
	maxTrackedPIDs  = 48
	maxStacksPerPID = 12
	// pruneInterval = 30 * time.Second
	pruneInterval = 10 * time.Second
)

type stackHit struct {
	tgid  int
	kern  []uint64
	user  []uint64
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
	// log.Printf("eBPF CPU stack sampler attached (sched_switch ~100Hz/cpu, kernel+user FP unwind, deferred symbolize)")
	log.Printf("eBPF CPU stack sampler attached (sched_switch ~20Hz/cpu, kernel+user FP unwind, deferred symbolize, memory-capped)")
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
	// event: ts_ns u64 | pid u32 | tgid u32 | n_kern u32 | n_user u32 | kern[16] u64 | user[16] u64
	const header = 24
	const stackBytes = 8 * maxInlineStack
	minSize := header + 8 // at least one IP somewhere

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
		tgid := int(binary.LittleEndian.Uint32(raw[12:16]))
		nKern := int(binary.LittleEndian.Uint32(raw[16:20]))
		nUser := int(binary.LittleEndian.Uint32(raw[20:24]))
		if pid <= 0 {
			continue
		}
		if tgid <= 0 {
			tgid = pid
		}
		if nKern > maxInlineStack {
			nKern = maxInlineStack
		}
		if nUser > maxInlineStack {
			nUser = maxInlineStack
		}
		need := header + stackBytes + stackBytes
		if len(raw) < need {
			continue
		}

		kern := readIPSlice(raw, header, nKern)
		user := readIPSlice(raw, header+stackBytes, nUser)
		if len(kern) == 0 && len(user) == 0 {
			continue
		}

		// Cheap signature from raw IPs — symbolize only when building flames.
		sig := stackSignature(kern, user)

		s.mu.Lock()
		byPID, ok := s.hits[pid]
		if !ok {
			// byPID = make(map[string]*stackHit)
			// s.hits[pid] = byPID
			if len(s.hits) >= maxTrackedPIDs {
				s.dropColdestPIDLocked()
			}
			if len(s.hits) >= maxTrackedPIDs {
				s.mu.Unlock()
				continue
			}
			byPID = make(map[string]*stackHit)
			s.hits[pid] = byPID
		}
		if hit, exists := byPID[sig]; exists {
			hit.count++
			// } else {
			// 	byPID[sig] = &stackHit{tgid: tgid, kern: kern, user: user, count: 1}
		} else if len(byPID) >= maxStacksPerPID {
			// Prefer counting an existing hot stack over growing unique signatures.
			s.bumpOldestOrDropLocked(byPID)
		} else {
			byPID[sig] = &stackHit{tgid: tgid, kern: kern, user: user, count: 1}
		}
		s.totalHits++
		s.mu.Unlock()
	}
}

func readIPSlice(raw []byte, base, n int) []uint64 {
	if n <= 0 {
		return nil
	}
	out := make([]uint64, 0, n)
	for i := 0; i < n; i++ {
		off := base + i*8
		if off+8 > len(raw) {
			break
		}
		addr := binary.LittleEndian.Uint64(raw[off : off+8])
		if addr == 0 {
			break
		}
		out = append(out, addr)
	}
	return out
}

func stackSignature(kern, user []uint64) string {
	var b strings.Builder
	b.Grow((len(kern) + len(user)) * 17)
	for i, addr := range kern {
		if i > 0 {
			b.WriteByte('|')
		}
		b.WriteString(strconv.FormatUint(addr, 16))
	}
	b.WriteByte('#')
	for i, addr := range user {
		if i > 0 {
			b.WriteByte('|')
		}
		b.WriteString(strconv.FormatUint(addr, 16))
	}
	return b.String()
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

func (s *ebpfStackSampler) dropColdestPIDLocked() {
	var coldPID int
	var coldCount uint64 = ^uint64(0)
	for pid, bySig := range s.hits {
		var sum uint64
		for _, hit := range bySig {
			sum += hit.count
		}
		if sum < coldCount {
			coldCount = sum
			coldPID = pid
		}
	}
	if coldPID != 0 {
		delete(s.hits, coldPID)
	}
}

func (s *ebpfStackSampler) bumpOldestOrDropLocked(byPID map[string]*stackHit) {
	// No room for a new signature — leave map unchanged (sample discarded).
	_ = byPID
}

func (s *ebpfStackSampler) pruneLoop(ctx context.Context) {
	// ticker := time.NewTicker(30 * time.Second)
	ticker := time.NewTicker(pruneInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			// Drop cold PIDs first.
			for len(s.hits) > maxTrackedPIDs {
				s.dropColdestPIDLocked()
			}
			for pid, bySig := range s.hits {
				// if len(bySig) > 64 {
				if len(bySig) <= maxStacksPerPID {
					continue
				}
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
				// keep := make(map[string]*stackHit, 48)
				// for i := 0; i < len(ordered) && i < 48; i++ {
				keep := make(map[string]*stackHit, maxStacksPerPID)
				for i := 0; i < len(ordered) && i < maxStacksPerPID; i++ {
					keep[ordered[i].sig] = bySig[ordered[i].sig]
				}
				s.hits[pid] = keep
				// }
			}
			s.mu.Unlock()
			// Drop heavy symbol tables between flame builds.
			userSymCache.clear()
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
		tgid  int
		kern  []uint64
		user  []uint64
		count uint64
	}
	s.mu.Lock()
	var all []scored
	for tid, bySig := range s.hits {
		for _, hit := range bySig {
			tgid := hit.tgid
			if tgid <= 0 {
				tgid = readTgid(tid)
			}
			if tgid <= 0 {
				tgid = tid
			}
			all = append(all, scored{tgid: tgid, kern: hit.kern, user: hit.user, count: hit.count})
		}
	}
	s.mu.Unlock()
	sort.Slice(all, func(i, j int) bool { return all[i].count > all[j].count })
	if len(all) > limit {
		all = all[:limit]
	}
	out := make([][]string, 0, len(all))
	for _, item := range all {
		resolved := resolveMixedStack(item.tgid, item.kern, item.user)
		labels := make([]string, 0, len(resolved))
		for _, frame := range resolved {
			labels = append(labels, frame.Label)
		}
		out = append(out, labels)
	}
	return out
}

func (s *ebpfStackSampler) FlameFrames(pid int) []StackFrame {
	if !s.Available() {
		return nil
	}
	// Symbol tables are built on demand for this request; drop them after so RSS stays flat.
	defer userSymCache.clear()

	// pid <= 0 → node-wide merge (classic pyramid). pid > 0 → that process only.
	nodeWide := pid <= 0

	s.mu.Lock()
	bySig := map[string]*stackHit{}
	tgidCache := map[int]int{}
	for tid, hits := range s.hits {
		if !nodeWide && tid != pid && !sameProcessCached(pid, tid, tgidCache) {
			continue
		}
		for sig, hit := range hits {
			if existing, ok := bySig[sig]; ok {
				existing.count += hit.count
			} else {
				cp := *hit
				bySig[sig] = &cp
			}
		}
	}
	// If no thread match yet, use hottest node-wide stacks so UI can still report ebpf.
	// if len(bySig) == 0 {
	// 	for _, hits := range s.hits {
	// 		...
	// 	}
	// }
	if !nodeWide && len(bySig) == 0 {
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
		tgid  int
		kern  []uint64
		user  []uint64
		count uint64
	}
	scoredHits := make([]scored, 0, len(bySig))
	var total uint64
	for _, hit := range bySig {
		scoredHits = append(scoredHits, scored{tgid: hit.tgid, kern: hit.kern, user: hit.user, count: hit.count})
		total += hit.count
	}
	s.mu.Unlock()

	if total == 0 || len(scoredHits) == 0 {
		return nil
	}

	sort.Slice(scoredHits, func(i, j int) bool {
		return scoredHits[i].count > scoredHits[j].count
	})
	// Keep enough unique stacks for a dense merged pyramid (was 12).
	// if len(scoredHits) > 12 {
	// 	scoredHits = scoredHits[:12]
	// }
	maxStacks := 12
	if nodeWide {
		maxStacks = 48
	}
	if len(scoredHits) > maxStacks {
		scoredHits = scoredHits[:maxStacks]
	}

	type resolved struct {
		frames []resolvedFrame
		count  uint64
	}
	resolvedHits := make([]resolved, 0, len(scoredHits))
	for _, hit := range scoredHits {
		// resolvePid := pid
		resolvePid := hit.tgid
		if resolvePid <= 0 {
			resolvePid = pid
		}
		frames := resolveMixedStack(resolvePid, hit.kern, hit.user)
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
		kind     string
		binary   string
		offset   string
		count    uint64
		children map[string]*node
	}
				// root := &node{label: "all", children: map[string]*node{}}
	// root := &node{label: "Node CPU", kind: "cpu", children: map[string]*node{}}
	// root := &node{label: "CPU Samples", kind: "root", children: map[string]*node{}}
	root := &node{label: "Node CPU", kind: "root", children: map[string]*node{}}
	for _, hit := range resolvedHits {
		cur := root
		cur.count += hit.count
		for i := len(hit.frames) - 1; i >= 0; i-- {
			frame := hit.frames[i]
			child, ok := cur.children[frame.Label]
			if !ok {
				child = &node{
					label:    frame.Label,
					kind:     frame.Kind,
					binary:   frame.Binary,
					offset:   frame.Offset,
					children: map[string]*node{},
				}
				cur.children[frame.Label] = child
			}
			child.count += hit.count
			if child.kind == "" {
				child.kind = frame.Kind
			}
			if child.binary == "" {
				child.binary = frame.Binary
			}
			if child.offset == "" {
				child.offset = frame.Offset
			}
			cur = child
		}
	}

	frames := make([]StackFrame, 0, 64)
	// Width must be the frame's own share of the root (parent * child/parent), not
	// parentWidth * child/root — the latter shrinks every level and leaves gaps.
	// var walk func(n *node, depth int, offset float64, parentWidth float64)
	// walk = func(n *node, depth int, offset float64, parentWidth float64) {
	// 	width := parentWidth
	// 	if root.count > 0 && depth > 0 {
	// 		width = parentWidth * (float64(n.count) / float64(root.count))
	// 	}
	// 	if depth == 0 {
	// 		width = 1
	// 	}
	var walk func(n *node, depth int, offset float64, frameWidth float64)
	walk = func(n *node, depth int, offset float64, frameWidth float64) {
		width := frameWidth
		if depth == 0 {
			width = 1
		}
		share := 100 * float64(n.count) / float64(root.count)
		kind := n.kind
		if kind == "" {
			kind = "cpu"
		}
		frames = append(frames, StackFrame{
			ID:       fmt.Sprintf("cpu-%d-%s", depth, n.label),
			Label:    n.label,
			Subtitle: n.offset,
			Binary:   n.binary,
			Depth:    depth,
			Width:    width,
			Offset:   offset,
			Heat:     min(1, 0.15+float64(n.count)/float64(root.count)),
			SharePct: int(share + 0.5),
			Samples:  int(n.count),
			Kind:     kind,
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
			// walk(child, depth+1, childOffset, width)
			walk(child, depth+1, childOffset, childWidth)
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
