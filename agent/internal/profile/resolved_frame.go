package profile

// resolvedFrame is one symbolized stack frame with provenance for the flame UI.
type resolvedFrame struct {
	Label  string // Prefer symbol; fall back to binary name (no raw offset).
	Kind   string // "app" | "runtime" | "library" | "kernel"
	Binary string // Mapped object basename or path
	Offset string // "+0x…" for tooltip / detail; empty when unknown
	Symbol string // Resolved function name when available
}
