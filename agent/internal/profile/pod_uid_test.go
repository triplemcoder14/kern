//go:build linux

package profile

import "testing"

func TestPodUIDCandidatesContainerdUnderscores(t *testing.T) {
	line := "0::/kubepods.slice/kubepods-burstable.slice/kubepods-burstable-poda1b2c3d4e5f67890abcd1234ef567890.slice"
	// 32 hex chars after "pod"
	got := podUIDCandidates(line)
	if len(got) == 0 {
		t.Fatalf("expected candidates, got none")
	}
	found := false
	for _, candidate := range got {
		if candidate == "a1b2c3d4-e5f6-7890-abcd-1234ef567890" || candidate == "a1b2c3d4e5f67890abcd1234ef567890" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing formatted uid in %#v", got)
	}
}

func TestPodUIDCandidatesWithUnderscoreUUID(t *testing.T) {
	line := "0::/kubepods.slice/kubepods-burstable.slice/kubepods-burstable-poda1b2c3d4_e5f6_7890_abcd_1234ef567890.slice"
	got := podUIDCandidates(line)
	want := "a1b2c3d4-e5f6-7890-abcd-1234ef567890"
	found := false
	for _, candidate := range got {
		if candidate == want {
			found = true
		}
	}
	if !found {
		t.Fatalf("want %s in %#v", want, got)
	}
}
