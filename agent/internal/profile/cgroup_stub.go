//go:build !linux

package profile

func readProcessCgroupMem(_ int) cgroupMemStats {
	return cgroupMemStats{}
}

func (c *platformCollector) collectPodsFromCgroups(_ int) []PodConsumer {
	return nil
}
