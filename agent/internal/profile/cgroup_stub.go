//go:build !linux

package profile

func readProcessCgroupStats(_ int) (cacheKB, majorFaults uint64) {
	return 0, 0
}
