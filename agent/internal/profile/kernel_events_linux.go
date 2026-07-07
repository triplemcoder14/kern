//go:build linux

package profile

import (
	"os"
	"strings"
	"time"
)

type kernelEventTracker struct {
	prevOOMKills uint64
}

func newKernelEventTracker() *kernelEventTracker {
	return &kernelEventTracker{}
}

func (t *kernelEventTracker) observeOOMKill() uint32 {
	if t == nil {
		return 0
	}
	current := readVmStatCounter("oom_kill")
	delta := uint64(0)
	if current >= t.prevOOMKills {
		delta = current - t.prevOOMKills
	}
	t.prevOOMKills = current
	if delta > uint64(^uint32(0)) {
		return ^uint32(0)
	}
	return uint32(delta)
}

func readKernelEvents(oomDelta uint32) []TimelineEvent {
	events := []TimelineEvent{}
	now := timeNowRFC3339()

	if oomDelta > 0 {
		events = append(events, TimelineEvent{
			Timestamp: now,
			Title:     "OOM killer invoked",
			Detail:    "Kernel reported " + formatUint(oomDelta) + " oom_kill event(s) since last sample",
			Severity:  "crit",
		})
	}

	for _, line := range readRecentDmesgLines(40) {
		lower := strings.ToLower(line)
		switch {
		case strings.Contains(lower, "out of memory") || strings.Contains(lower, "oom-kill"):
			events = append(events, TimelineEvent{
				Timestamp: now,
				Title:     "Kernel OOM event",
				Detail:    trimEventLine(line),
				Severity:  "crit",
			})
		case strings.Contains(lower, "segfault") || strings.Contains(lower, "general protection fault"):
			events = append(events, TimelineEvent{
				Timestamp: now,
				Title:     "Kernel fault",
				Detail:    trimEventLine(line),
				Severity:  "warn",
			})
		case strings.Contains(lower, "nf_drop") || strings.Contains(lower, "drop packet"):
			events = append(events, TimelineEvent{
				Timestamp: now,
				Title:     "Network drop",
				Detail:    trimEventLine(line),
				Severity:  "warn",
			})
		}
		if len(events) >= 6 {
			break
		}
	}
	return events
}

func readRecentDmesgLines(limit int) []string {
	file, err := os.Open("/dev/kmsg")
	if err != nil {
		return nil
	}
	defer file.Close()

	_ = file.SetReadDeadline(time.Now().Add(25 * time.Millisecond))
	data := make([]byte, 8192)
	n, err := file.Read(data)
	if err != nil || n == 0 {
		return nil
	}

	lines := make([]string, 0, limit)
	for _, raw := range strings.Split(string(data[:n]), "\n") {
		line := raw
		if idx := strings.Index(line, ";"); idx >= 0 {
			line = line[idx+1:]
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		lines = append(lines, line)
	}
	if len(lines) > limit {
		lines = lines[len(lines)-limit:]
	}
	return lines
}

func trimEventLine(line string) string {
	if len(line) <= 160 {
		return line
	}
	return line[:157] + "..."
}

func formatUint(value uint32) string {
	return strings.TrimSpace(strings.TrimRight(strings.TrimRight(
		strconvFormat(float64(value), 0), "0"), "."))
}
