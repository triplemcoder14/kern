//go:build linux

package profile

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

func readPSI() PSISnapshot {
	cpuAvg := readPressureAvg("/proc/pressure/cpu")
	memAvg := readPressureAvg("/proc/pressure/memory")
	return PSISnapshot{
		CPULevel:    psiLevel(cpuAvg),
		MemoryLevel: psiLevel(memAvg),
		CPUAvg10:    cpuAvg,
		MemoryAvg10: memAvg,
	}
}

func readPressureAvg(path string) float64 {
	file, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "some avg10=") {
			value := strings.TrimPrefix(line, "some avg10=")
			if idx := strings.Index(value, " "); idx >= 0 {
				value = value[:idx]
			}
			parsed, err := strconv.ParseFloat(value, 64)
			if err == nil {
				return parsed
			}
		}
	}
	return 0
}

func psiLevel(avg10 float64) PSILevel {
	switch {
	case avg10 >= 50:
		return PSICritical
	case avg10 >= 10:
		return PSIWarn
	default:
		return PSINormal
	}
}
