//go:build !linux

package profile

import "strconv"

func resolveUserStackAddrs(_ int, addrs []uint64) []resolvedFrame {
	return hexResolvedStub(addrs, "app")
}

func resolveMixedStack(_ int, kern, user []uint64) []resolvedFrame {
	out := append(hexResolvedStub(kern, "kernel"), hexResolvedStub(user, "app")...)
	if len(out) == 0 {
		return nil
	}
	return out
}

func hexResolvedStub(addrs []uint64, kind string) []resolvedFrame {
	out := make([]resolvedFrame, 0, len(addrs))
	for _, addr := range addrs {
		if addr == 0 {
			break
		}
		out = append(out, resolvedFrame{
			Label:  "0x" + strconv.FormatUint(addr, 16),
			Kind:   kind,
			Offset: "+0x" + strconv.FormatUint(addr, 16),
		})
	}
	return out
}
