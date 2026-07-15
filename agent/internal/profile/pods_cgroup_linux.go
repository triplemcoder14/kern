//go:build linux

package profile

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

var kubepodsRoots = []string{
	"/sys/fs/cgroup/kubepods.slice",
	"/sys/fs/cgroup/kubepods",
	"/sys/fs/cgroup/memory/kubepods.slice",
	"/sys/fs/cgroup/memory/kubepods",
}

// collectPodsFromCgroups walks kubepods cgroup trees and reads memory.current per pod.
// This does not require per-PID attribution, which fails when kubelet metadata is unavailable.
func (c *platformCollector) collectPodsFromCgroups(limit int) []PodConsumer {
	type bucket struct {
		consumer PodConsumer
		uid      string
	}
	byUID := map[string]*bucket{}

	for _, root := range kubepodsRoots {
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || !d.IsDir() {
				return nil
			}
			uid, ok := podUIDFromCgroupDir(d.Name())
			if !ok {
				return nil
			}
			if _, exists := byUID[uid]; exists {
				return filepath.SkipDir
			}

			stats := readCgroupMemAt(path)
			if stats.currentKB == 0 && stats.anonKB == 0 && stats.fileKB == 0 {
				return nil
			}

			ns, name := "", ""
			if metaNS, metaPod, metaOK := readKubeletPodMeta(uid); metaOK {
				ns, name = metaNS, metaPod
			} else if c.podLookup != nil {
				if lookupNS, lookupPod, lookupOK := c.podLookup.LookupPodByUID(uid); lookupOK {
					ns, name = lookupNS, lookupPod
				}
			}
			if name == "" {
				return filepath.SkipDir
			}

			byUID[uid] = &bucket{
				uid: uid,
				consumer: PodConsumer{
					Namespace:     ns,
					Pod:           name,
					RSSMB:         stats.currentKB / 1024,
					WorkingSetMB:  stats.currentKB / 1024,
					AnonymousMB:   stats.anonKB / 1024,
					CacheMB:       stats.fileKB / 1024,
					MajorFaults:   stats.majorFaults,
					MinorFaults:   stats.minorFaults,
					PageFaults:    stats.majorFaults,
					MemoryLimitMB: stats.limitKB / 1024,
				},
			}
			return filepath.SkipDir
		})
	}

	items := make([]PodConsumer, 0, len(byUID))
	for _, item := range byUID {
		items = append(items, item.consumer)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].RSSMB > items[j].RSSMB
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items
}

func podUIDFromCgroupDir(name string) (string, bool) {
	// systemd: kubepods-burstable-pod<uid>.slice  or pod<uid>.slice
	// cgroupfs: pod<uid>
	lower := strings.ToLower(name)
	idx := strings.Index(lower, "pod")
	if idx < 0 {
		return "", false
	}
	rest := name[idx+3:]
	rest = strings.TrimPrefix(rest, "-")
	rest = strings.TrimPrefix(rest, "_")
	rest = strings.TrimSuffix(rest, ".slice")
	rest = strings.Trim(rest, "-_")

	compact := strings.ReplaceAll(strings.ReplaceAll(rest, "-", ""), "_", "")
	if len(compact) < 32 {
		return "", false
	}
	if len(compact) > 32 {
		compact = compact[:32]
	}
	return formatPodUID(compact), true
}

func readCgroupMemAt(path string) cgroupMemStats {
	stats := cgroupMemStats{path: path}
	if data, err := os.ReadFile(filepath.Join(path, "memory.current")); err == nil {
		if value, err := parseUint(strings.TrimSpace(string(data))); err == nil {
			stats.currentKB = value / 1024
		}
	} else if data, err := os.ReadFile(filepath.Join(path, "memory.usage_in_bytes")); err == nil {
		if value, err := parseUint(strings.TrimSpace(string(data))); err == nil {
			stats.currentKB = value / 1024
		}
	}
	if data, err := os.ReadFile(filepath.Join(path, "memory.max")); err == nil {
		raw := strings.TrimSpace(string(data))
		if raw != "" && raw != "max" {
			if value, err := parseUint(raw); err == nil {
				stats.limitKB = value / 1024
			}
		}
	}
	statPath := filepath.Join(path, "memory.stat")
	file, err := os.Open(statPath)
	if err != nil {
		return stats
	}
	defer file.Close()

	// reuse scanner logic via small read helper inlined
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 1024)
	for {
		n, readErr := file.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if readErr != nil {
			break
		}
	}
	for _, line := range strings.Split(string(buf), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		value, err := parseUint(fields[1])
		if err != nil {
			continue
		}
		switch fields[0] {
		case "file":
			stats.fileKB = value / 1024
		case "anon":
			stats.anonKB = value / 1024
		case "total_cache", "cache":
			if stats.fileKB == 0 {
				stats.fileKB = value / 1024
			}
		case "total_rss", "rss":
			if stats.anonKB == 0 {
				stats.anonKB = value / 1024
			}
		case "pgmajfault", "total_pgmajfault":
			stats.majorFaults = value
		case "pgfault", "total_pgfault":
			stats.minorFaults = value
		}
	}
	return stats
}

func parseUint(raw string) (uint64, error) {
	return strconv.ParseUint(raw, 10, 64)
}
