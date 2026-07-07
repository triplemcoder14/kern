//go:build linux

package profile

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func readProcessCgroupStats(pid int) (cacheKB, majorFaults uint64) {
	cgroupPath, ok := unifiedCgroupPath(pid)
	if !ok {
		return 0, 0
	}

	statFile := filepath.Join(cgroupPath, "memory.stat")
	file, err := os.Open(statFile)
	if err != nil {
		return 0, 0
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "file":
			cacheKB += value / 1024
		case "anon":
			_ = value
		case "pgmajfault":
			majorFaults = value
		}
	}
	return cacheKB, majorFaults
}

func unifiedCgroupPath(pid int) (string, bool) {
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "cgroup"))
	if err != nil {
		return "", false
	}

	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 {
			continue
		}
		if parts[0] != "0" {
			continue
		}
		rel := strings.TrimPrefix(parts[2], "/")
		if rel == "" {
			continue
		}
		return filepath.Join("/sys/fs/cgroup", rel), true
	}
	return "", false
}
