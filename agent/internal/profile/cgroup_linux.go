//go:build linux

package profile

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func readProcessCgroupMem(pid int) cgroupMemStats {
	cgroupPath, ok := unifiedCgroupPath(pid)
	if !ok {
		return cgroupMemStats{}
	}

	stats := cgroupMemStats{path: cgroupPath}
	if data, err := os.ReadFile(filepath.Join(cgroupPath, "memory.current")); err == nil {
		if value, err := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64); err == nil {
			stats.currentKB = value / 1024
		}
	}
	if data, err := os.ReadFile(filepath.Join(cgroupPath, "memory.max")); err == nil {
		raw := strings.TrimSpace(string(data))
		if raw != "" && raw != "max" {
			if value, err := strconv.ParseUint(raw, 10, 64); err == nil {
				stats.limitKB = value / 1024
			}
		}
	}

	statFile := filepath.Join(cgroupPath, "memory.stat")
	file, err := os.Open(statFile)
	if err != nil {
		return stats
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
			stats.fileKB = value / 1024
		case "anon":
			stats.anonKB = value / 1024
		case "pgmajfault":
			stats.majorFaults = value
		case "pgfault":
			stats.minorFaults = value
		}
	}
	return stats
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
