//go:build linux && ebpf

package profile

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go@v0.19.0 -cc clang -cflags "-O2 -g -Wall -Werror" -target amd64 profileStacks ../../bpf/profile_stacks.c -- -I../../bpf

import (
	"context"
	"encoding/binary"
	"errors"
	"log"
	"os"
	"sync"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
)

type ebpfStackSampler struct {
	objs      profileStacksObjects
	link      link.Link
	reader    *ringbuf.Reader
	stackMap  *ebpf.Map
	latestPID int
	latestID  int32
	mu        sync.Mutex
	cancel    context.CancelFunc
}

func newPlatformStackSampler() StackSampler {
	if os.Getenv("KERN_EBPF_STACKS") != "1" {
		return noopStackSampler{}
	}

	sampler, err := newEBPFStackSampler()
	if err != nil {
		log.Printf("ebpf stack sampler unavailable: %v", err)
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
		objs:     objs,
		link:     tp,
		reader:   reader,
		stackMap: objs.KernProfileStacks,
		cancel:   cancel,
	}
	go s.consume(ctx)
	log.Printf("ebpf profile stack sampler attached (tracepoint sched/sched_switch)")
	return s, nil
}

func (s *ebpfStackSampler) Available() bool {
	return s != nil && s.stackMap != nil
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
	for {
		record, err := s.reader.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) || ctx.Err() != nil {
				return
			}
			continue
		}
		if len(record.RawSample) < 16 {
			continue
		}
		pid := int(binary.LittleEndian.Uint32(record.RawSample[8:12]))
		stackID := int32(binary.LittleEndian.Uint32(record.RawSample[12:16]))
		s.mu.Lock()
		s.latestPID = pid
		s.latestID = stackID
		s.mu.Unlock()
	}
}

func (s *ebpfStackSampler) SampleTopProcess(pid int) []string {
	if !s.Available() || pid <= 0 {
		return nil
	}

	s.mu.Lock()
	samplePID := s.latestPID
	stackID := s.latestID
	s.mu.Unlock()
	if samplePID != pid || stackID < 0 {
		return nil
	}

	entries, err := s.stackMap.GetStacktrace(int(stackID))
	if err != nil || len(entries) == 0 {
		return nil
	}

	frames := make([]string, 0, min(len(entries), 10))
	for _, addr := range entries {
		name := lookupKallsym(uint64(addr))
		if name == "" {
			name = formatHexAddr(uint64(addr))
		}
		frames = append(frames, name)
		if len(frames) >= 10 {
			break
		}
	}
	return frames
}

func formatHexAddr(addr uint64) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 18)
	out[0] = '0'
	out[1] = 'x'
	for i := 15; i >= 0; i-- {
		out[2+(15-i)] = hex[(addr>>(i*4))&0xf]
	}
	return string(out)
}

type noopStackSampler struct{}

func (noopStackSampler) Available() bool { return false }
func (noopStackSampler) SampleTopProcess(_ int) []string { return nil }
func (noopStackSampler) Close() {}
