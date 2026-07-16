//go:build !linux

package profile

func readProcessKernelStack(_ int, _ int) []string {
	return nil
}

// func readProcessKernelStack(_ int, _ int) [] string {

// }
