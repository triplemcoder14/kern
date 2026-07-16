//go:build linux

package k8s

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/kern/agent/internal/store"
)

// EnrichClientFromPID fills SrcPod/SrcNamespace (and SrcIP when known) from the
// process cgroup. Used when DNS syscall captures omit the local client address.
func (r *Resolver) EnrichClientFromPID(flow *store.Flow, pid uint32) {
	if r == nil || flow == nil || pid == 0 {
		return
	}
	if flow.SrcPod != "" && flow.SrcIP != "" {
		return
	}
	ns, name, ok := r.podFromPID(int(pid))
	if !ok {
		return
	}
	if flow.SrcPod == "" {
		flow.SrcPod = name
		flow.SrcNamespace = ns
	}
	if flow.SrcIP == "" {
		if ip, found := r.lookupIP(ns, name); found {
			flow.SrcIP = ip
		}
	}
}

func (r *Resolver) lookupIP(namespace, name string) (string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for ip, ref := range r.byIP {
		if ref.Namespace == namespace && ref.Name == name {
			return ip, true
		}
	}
	return "", false
}

func (r *Resolver) podFromPID(pid int) (namespace, name string, ok bool) {
	file, err := os.Open(filepath.Join("/proc", strconv.Itoa(pid), "cgroup"))
	if err != nil {
		return "", "", false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		for _, uid := range cgroupPodUIDCandidates(scanner.Text()) {
			if meta, found := r.LookupPodByUID(uid); found {
				return meta.Namespace, meta.Name, true
			}
		}
	}
	return "", "", false
}

// cgroupPodUIDCandidates extracts pod UIDs from a cgroup path.
// Important: skip the "pod" substring inside "kubepods".
func cgroupPodUIDCandidates(line string) []string {
	var out []string
	seen := map[string]struct{}{}
	for i := 0; i < len(line); {
		rel := strings.Index(line[i:], "pod")
		if rel < 0 {
			break
		}
		abs := i + rel
		// Previous: idx := strings.Index(line, "pod") — matched kubepods first.
		if abs >= 4 && strings.EqualFold(line[abs-4:abs], "kube") {
			i = abs + 3
			continue
		}
		rest := line[abs+3:]
		rest = strings.TrimPrefix(rest, "-")
		rest = strings.TrimPrefix(rest, "/")
		rest = strings.TrimPrefix(rest, "_")

		var token strings.Builder
		for _, ch := range rest {
			if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F') || ch == '-' || ch == '_' {
				token.WriteRune(ch)
				continue
			}
			break
		}

		raw := strings.Trim(token.String(), "-_")
		raw = strings.ReplaceAll(raw, "_", "-")
		compact := strings.ReplaceAll(raw, "-", "")
		i = abs + 3
		if len(compact) < 32 {
			continue
		}
		if len(compact) > 32 {
			compact = compact[:32]
		}
		for _, key := range podUIDKeys(formatPodUID(compact)) {
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, key)
		}
	}
	return out
}
