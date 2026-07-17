//go:build linux

package profile

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

var (
	stackLinePattern = regexp.MustCompile(`^\[<([0-9a-fA-F]+)>\]\s*(.+)$`)
	kallsymsOnce     sync.Once
	kallsymsSorted   []kallsymEntry
)

type kallsymEntry struct {
	addr uint64
	// end exclusive — next symbol addr (or addr+maxSpan). Added so nearest-lower can't span holes.
	end  uint64
	name string
}

// type kallsymEntry struct {
// 	addr uint64
// 	name string
// }

const maxKallsymSpan = 512 * 1024 // reject nearest-lower hits farther than this

func readProcessKernelStack(pid int, limit int) []string {
	if pid <= 0 || limit <= 0 {
		return nil
	}

	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stack"))
	if err != nil {
		return nil
	}

	frames := make([]string, 0, limit)
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		label := parseKernelStackLine(strings.TrimSpace(line))
		if label == "" {
			continue
		}
		frames = append(frames, label)
		if len(frames) >= limit {
			break
		}
	}
	return frames
}

func parseKernelStackLine(line string) string {
	match := stackLinePattern.FindStringSubmatch(line)
	if len(match) != 3 {
		return ""
	}

	symbol := strings.TrimSpace(match[2])
	if symbol == "" {
		return ""
	}

	if strings.HasPrefix(symbol, "0x") {
		if addr, err := strconv.ParseUint(strings.TrimPrefix(symbol, "0x"), 16, 64); err == nil {
			if name := lookupKallsym(addr); name != "" {
				return name
			}
		}
		return symbol
	}

	if idx := strings.Index(symbol, "+"); idx > 0 {
		symbol = symbol[:idx]
	}
	if idx := strings.Index(symbol, "/"); idx > 0 {
		symbol = symbol[:idx]
	}
	return strings.TrimSpace(symbol)
}

func lookupKallsym(addr uint64) string {
	kallsymsOnce.Do(loadKallsyms)
	if len(kallsymsSorted) == 0 {
		return ""
	}

	// Largest symbol address <= addr (standard kallsyms nearest-lower).
	i := sort.Search(len(kallsymsSorted), func(i int) bool {
		return kallsymsSorted[i].addr > addr
	}) - 1
	if i < 0 {
		return ""
	}
	entry := kallsymsSorted[i]
	// Reject unbounded nearest-lower matches (truncated tables / wrong module range).
	// return kallsymsSorted[i].name
	// if addr >= entry.end || addr-entry.addr > maxKallsymSpan {
	if addr >= entry.end {
		return ""
	}
	if addr-entry.addr > maxKallsymSpan {
		return ""
	}
	return entry.name
}

func resolveStackAddrs(addrs []uint64) []string {
	if len(addrs) == 0 {
		return nil
	}
	frames := make([]string, 0, len(addrs))
	for _, addr := range addrs {
		if addr == 0 {
			break
		}
		name := lookupKallsym(addr)
		if name == "" {
			name = "0x" + strconv.FormatUint(addr, 16)
		}
		frames = append(frames, name)
	}
	return frames
}

func loadKallsyms() {
	file, err := os.Open("/proc/kallsyms")
	if err != nil {
		return
	}
	defer file.Close()

	// Load all text symbols — truncating mid-table caused wrong nearest-lower hits
	// (e.g. display-driver symbols attributed to unrelated kernel IPs).
	// const maxKallsyms = 49152
	// entries := make([]kallsymEntry, 0, 32768)
	entries := make([]kallsymEntry, 0, 65536)
	scanner := bufio.NewScanner(file)
	// buf := make([]byte, 0, 256*1024)
	buf := make([]byte, 0, 256*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		// Keep code symbols only — skips absolute/data noise that balloons RSS.
		typ := fields[1]
		if typ != "t" && typ != "T" && typ != "w" && typ != "W" {
			continue
		}
		addr, err := strconv.ParseUint(fields[0], 16, 64)
		if err != nil || addr == 0 {
			continue
		}
		entries = append(entries, kallsymEntry{addr: addr, name: fields[2]})
		// if len(entries) >= maxKallsyms {
		// 	break
		// }
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].addr < entries[j].addr
	})
	for i := range entries {
		if i+1 < len(entries) {
			entries[i].end = entries[i+1].addr
		} else {
			entries[i].end = entries[i].addr + maxKallsymSpan
		}
		// Clamp absurd gaps so a hit in a huge hole doesn't stick to the previous symbol.
		if entries[i].end > entries[i].addr+maxKallsymSpan {
			entries[i].end = entries[i].addr + maxKallsymSpan
		}
	}
	kallsymsSorted = entries
}
