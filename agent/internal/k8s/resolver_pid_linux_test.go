//go:build linux

package k8s

import (
	"strings"
	"testing"
)

func TestCgroupPodUIDCandidatesSkipsKubepods(t *testing.T) {
	line := "0::/kubepods.slice/kubepods-burstable.slice/kubepods-burstable-pod226d4fd3_3f8a_427b_afb1_00ecf9e5c760.slice/cri-containerd-abc.scope"
	got := cgroupPodUIDCandidates(line)
	if len(got) == 0 {
		t.Fatal("expected pod uid candidates")
	}
	want := "226d4fd3-3f8a-427b-afb1-00ecf9e5c760"
	found := false
	for _, key := range got {
		if key == want || strings.ReplaceAll(key, "-", "") == strings.ReplaceAll(want, "-", "") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected uid %s in %v", want, got)
	}
}
