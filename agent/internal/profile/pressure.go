package profile

func psiLabel(level PSILevel) string {
	switch level {
	case PSICritical:
		return "Critical"
	case PSIWarn:
		return "High"
	default:
		return "Normal"
	}
}
