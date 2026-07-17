//go:build linux

package profile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveMixedStackOrder(t *testing.T) {
	kern := []uint64{0x10, 0x20}
	user := []uint64{0x30, 0x40}
	frames := resolveMixedStack(0, kern, user)
	if len(frames) < 2 {
		t.Fatalf("expected frames, got %#v", frames)
	}
	if frames[0].Kind != "kernel" {
		t.Fatalf("expected kernel first (leaf-first), got %#v", frames[0])
	}
	// if frames[len(frames)-1].Kind != "user" {
	// 	t.Fatalf("expected user last (leaf-first), got %#v", frames[len(frames)-1])
	// }
	if frames[len(frames)-1].Kind != "app" {
		t.Fatalf("expected user/app last (leaf-first), got %#v", frames[len(frames)-1])
	}
}

func TestShortenLibName(t *testing.T) {
	if got := shortenLibName("libc-2.31.so"); got != "libc.so" {
		t.Fatalf("got %q", got)
	}
	if got := shortenLibName("libpthread-2.31.so"); got != "libpthread.so" {
		t.Fatalf("got %q", got)
	}
	if got := shortenLibName("libc.so.6"); got != "libc.so" {
		t.Fatalf("got %q", got)
	}
	if got := shortenLibName("metrics-server"); got != "metrics-server" {
		t.Fatalf("got %q", got)
	}
}

func TestClassifyUserFrame(t *testing.T) {
	if got := classifyUserFrame("libjvm.so", ""); got != "runtime" {
		t.Fatalf("libjvm → %q", got)
	}
	if got := classifyUserFrame("libc.so", ""); got != "library" {
		t.Fatalf("libc → %q", got)
	}
	if got := classifyUserFrame("kubelet", "runtime.mallocgc"); got != "runtime" {
		t.Fatalf("go runtime → %q", got)
	}
	if got := classifyUserFrame("kubelet", "main.serve"); got != "app" {
		t.Fatalf("app → %q", got)
	}
}

func TestReadProcMapsSelf(t *testing.T) {
	pid := os.Getpid()
	regions := readProcMaps(pid)
	if len(regions) == 0 {
		t.Skip("no executable maps readable")
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	base := filepath.Base(exe)
	t.Logf("parsed %d executable regions (exe=%s)", len(regions), base)
}
