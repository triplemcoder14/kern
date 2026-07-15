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
	name string
}

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
	return kallsymsSorted[i].name
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

	entries := make([]kallsymEntry, 0, 65536)
	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 1024*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		addr, err := strconv.ParseUint(fields[0], 16, 64)
		if err != nil || addr == 0 {
			continue
		}
		entries = append(entries, kallsymEntry{addr: addr, name: fields[2]})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].addr < entries[j].addr
	})
	kallsymsSorted = entries
}
