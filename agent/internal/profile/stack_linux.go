//go:build linux

package profile

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

var (
	stackLinePattern = regexp.MustCompile(`^\[<([0-9a-fA-F]+)>\]\s*(.+)$`)
	kallsymsOnce     sync.Once
	kallsymsLookup   map[uint64]string
)

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
	if len(kallsymsLookup) == 0 {
		return ""
	}

	bestAddr := uint64(0)
	bestName := ""
	for symbolAddr, name := range kallsymsLookup {
		if symbolAddr <= addr && symbolAddr >= bestAddr {
			bestAddr = symbolAddr
			bestName = name
		}
	}
	return bestName
}

func loadKallsyms() {
	file, err := os.Open("/proc/kallsyms")
	if err != nil {
		return
	}
	defer file.Close()

	lookup := make(map[uint64]string, 4096)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		addr, err := strconv.ParseUint(fields[0], 16, 64)
		if err != nil {
			continue
		}
		lookup[addr] = fields[2]
	}
	kallsymsLookup = lookup
}
