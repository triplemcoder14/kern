//go:build linux

package profile

import (
	"bufio"
	"debug/elf"
	"debug/gosym"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type mapRegion struct {
	start  uint64
	end    uint64
	offset uint64
	path   string
}

type elfSymCache struct {
	mu       sync.Mutex
	syms     map[string][]elfSym // path -> sorted by value
	goTables map[string]*gosym.Table
}

type elfSym struct {
	value uint64
	size  uint64
	name  string
}

var (
	userSymCache   = &elfSymCache{syms: map[string][]elfSym{}, goTables: map[string]*gosym.Table{}}
	libVersionTrim = regexp.MustCompile(`-\d+(\.\d+)*\.so`)
)

func resolveUserStackAddrs(tgid int, addrs []uint64) []resolvedFrame {
	if tgid <= 0 || len(addrs) == 0 {
		return nil
	}
	regions := readProcMaps(tgid)
	if len(regions) == 0 {
		return hexResolved(addrs, "app")
	}

	frames := make([]resolvedFrame, 0, len(addrs))
	for _, addr := range addrs {
		if addr == 0 {
			break
		}
		frames = append(frames, resolveUserFrame(tgid, addr, regions))
	}
	return frames
}

func resolveUserFrame(tgid int, addr uint64, regions []mapRegion) resolvedFrame {
	reg, ok := findRegion(regions, addr)
	if !ok {
		return resolvedFrame{
			Label:  "0x" + strconv.FormatUint(addr, 16),
			Kind:   "app",
			Offset: "+0x" + strconv.FormatUint(addr, 16),
		}
	}
	base := shortenLibName(filepath.Base(reg.path))
	off := "+0x" + strconv.FormatUint(addr-reg.start+reg.offset, 16)
	if base == "" || strings.HasPrefix(base, "[") {
		if base == "" {
			base = "anon"
		}
		return resolvedFrame{
			Label:  base,
			Kind:   classifyUserFrame(base, ""),
			Binary: reg.path,
			Offset: "+0x" + strconv.FormatUint(addr-reg.start, 16),
		}
	}

	bias := reg.start - reg.offset
	fileVA := addr - bias
	filePath := resolveMappedPath(tgid, reg.path)

	symbol := lookupGoSymbol(filePath, fileVA)
	if symbol == "" {
		symbol = lookupELFSymbol(filePath, fileVA)
	}

	kind := classifyUserFrame(base, symbol)
	label := base
	if symbol != "" {
		// Flame shows the function; binary/offset live in metadata + tooltip.
		label = symbol
	}

	return resolvedFrame{
		Label:  label,
		Kind:   kind,
		Binary: pickFirstString(reg.path, base),
		Offset: off,
		Symbol: symbol,
	}
}

func classifyUserFrame(base, symbol string) string {
	lower := strings.ToLower(base)
	sym := strings.ToLower(symbol)

	switch {
	case strings.Contains(lower, "libjvm"),
		strings.Contains(lower, "libjli"),
		strings.Contains(lower, "libjsig"),
		strings.HasPrefix(lower, "ld-"),
		lower == "[vdso]",
		lower == "[vsyscall]",
		strings.HasPrefix(sym, "runtime."),
		strings.HasPrefix(sym, "runtime/"),
		strings.Contains(sym, "runtime.malloc"),
		strings.Contains(sym, "runtime.scan"),
		strings.Contains(sym, "runtime.gc"),
		strings.Contains(sym, "runtime.system"),
		strings.Contains(sym, "runtime.netpoll"),
		strings.Contains(sym, "runtime.mcall"),
		strings.Contains(sym, "runtime.park"),
		strings.Contains(sym, "runtime.unlock"):
		return "runtime"
	case strings.HasSuffix(lower, ".so"),
		strings.Contains(lower, ".so."),
		strings.HasPrefix(lower, "lib"):
		return "library"
	default:
		return "app"
	}
}

func pickFirstString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func shortenLibName(name string) string {
	if name == "" {
		return name
	}
	// libc-2.31.so → libc.so
	if strings.HasSuffix(name, ".so") || strings.Contains(name, ".so.") {
		trimmed := libVersionTrim.ReplaceAllString(name, ".so")
		if trimmed != "" {
			name = trimmed
		}
	}
	// libc.so.6 → libc.so
	if i := strings.Index(name, ".so."); i > 0 {
		return name[:i+3]
	}
	return name
}

func findRegion(regions []mapRegion, addr uint64) (mapRegion, bool) {
	for _, r := range regions {
		if addr >= r.start && addr < r.end {
			return r, true
		}
	}
	return mapRegion{}, false
}

func readProcMaps(tgid int) []mapRegion {
	f, err := os.Open(filepath.Join("/proc", strconv.Itoa(tgid), "maps"))
	if err != nil {
		return nil
	}
	defer f.Close()

	var out []mapRegion
	scanner := bufio.NewScanner(f)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		// Only executable mappings — code we can attribute.
		if !strings.Contains(fields[1], "x") {
			continue
		}
		rangeParts := strings.SplitN(fields[0], "-", 2)
		if len(rangeParts) != 2 {
			continue
		}
		start, err1 := strconv.ParseUint(rangeParts[0], 16, 64)
		end, err2 := strconv.ParseUint(rangeParts[1], 16, 64)
		off, err3 := strconv.ParseUint(fields[2], 16, 64)
		if err1 != nil || err2 != nil || err3 != nil || end <= start {
			continue
		}
		path := ""
		if len(fields) >= 6 {
			path = fields[5]
		}
		out = append(out, mapRegion{start: start, end: end, offset: off, path: path})
	}
	return out
}

func resolveMappedPath(tgid int, mapped string) string {
	if mapped == "" || strings.HasPrefix(mapped, "[") {
		return ""
	}
	// Prefer the process view so container paths resolve via /proc/<pid>/root.
	candidate := filepath.Join("/proc", strconv.Itoa(tgid), "root", mapped)
	if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
		return candidate
	}
	if st, err := os.Stat(mapped); err == nil && !st.IsDir() {
		return mapped
	}
	return mapped
}

func lookupELFSymbol(path string, fileVA uint64) string {
	if path == "" {
		return ""
	}
	syms := userSymCache.symbolsFor(path)
	if len(syms) == 0 {
		return ""
	}
	i := sort.Search(len(syms), func(i int) bool {
		return syms[i].value > fileVA
	}) - 1
	if i < 0 {
		return ""
	}
	sym := syms[i]
	// Reject hits that land far past a sized symbol (reduces false nearest-lower).
	if sym.size > 0 && fileVA >= sym.value+sym.size {
		return ""
	}
	return sym.name
}

func lookupGoSymbol(path string, fileVA uint64) string {
	if path == "" {
		return ""
	}
	table := userSymCache.goTableFor(path)
	if table == nil {
		return ""
	}
	fn := table.PCToFunc(fileVA)
	if fn == nil || fn.Name == "" {
		return ""
	}
	return demangleLite(fn.Name)
}

const (
	maxCachedELFBins = 8
	maxELFSymbols    = 1024
	maxCachedGoTabs  = 2
	maxGoPclntabSize = 512 * 1024
)

func (c *elfSymCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.syms = map[string][]elfSym{}
	c.goTables = map[string]*gosym.Table{}
}

func (c *elfSymCache) symbolsFor(path string) []elfSym {
	c.mu.Lock()
	if cached, ok := c.syms[path]; ok {
		c.mu.Unlock()
		return cached
	}
	c.mu.Unlock()

	loaded := loadELFSymbols(path)

	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.syms[path]; ok {
		return existing
	}
	c.syms[path] = loaded
	// Bound cache growth for long-lived agents (128Mi-class limits OOM easily).
	// if len(c.syms) > 48 {
	// Bound cache growth for long-lived agents (tight memory limits OOM easily).
	if len(c.syms) > maxCachedELFBins {
		c.syms = map[string][]elfSym{path: loaded}
	}
	return loaded
}

func (c *elfSymCache) goTableFor(path string) *gosym.Table {
	// Go pclntab is large; off by default. Set KERN_GO_SYMBOLS=1 to enable.
	if os.Getenv("KERN_GO_SYMBOLS") != "1" {
		return nil
	}
	c.mu.Lock()
	if cached, ok := c.goTables[path]; ok {
		c.mu.Unlock()
		return cached
	}
	c.mu.Unlock()

	loaded := loadGoTable(path)

	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.goTables[path]; ok {
		return existing
	}
	c.goTables[path] = loaded
	// if len(c.goTables) > 16 {
	if len(c.goTables) > maxCachedGoTabs {
		c.goTables = map[string]*gosym.Table{path: loaded}
	}
	return loaded
}

func loadELFSymbols(path string) []elfSym {
	f, err := elf.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	// var all []elf.Symbol
	// if syms, err := f.Symbols(); err == nil {
	// 	all = append(all, syms...)
	// }
	// if dyn, err := f.DynamicSymbols(); err == nil {
	// 	all = append(all, dyn...)
	// }
	// Prefer dynsym only — full .symtab on large binaries blows RSS under OOM limits.
	var all []elf.Symbol
	if dyn, err := f.DynamicSymbols(); err == nil {
		all = append(all, dyn...)
	}
	// Fall back to .symtab only when dynsym is empty (static/stripped-dyn cases).
	if len(all) == 0 {
		if syms, err := f.Symbols(); err == nil {
			all = append(all, syms...)
		}
	}
	if len(all) == 0 {
		return nil
	}

	// out := make([]elfSym, 0, len(all))
	out := make([]elfSym, 0, min(len(all), maxELFSymbols))
	seen := map[string]struct{}{}
	for _, sym := range all {
		if sym.Name == "" || sym.Value == 0 {
			continue
		}
		if elf.ST_TYPE(sym.Info) != elf.STT_FUNC && elf.ST_TYPE(sym.Info) != elf.STT_NOTYPE {
			continue
		}
		if _, ok := seen[sym.Name]; ok {
			continue
		}
		seen[sym.Name] = struct{}{}
		out = append(out, elfSym{value: sym.Value, size: sym.Size, name: demangleLite(sym.Name)})
		// if len(out) >= 8192 {
		if len(out) >= maxELFSymbols {
			break
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].value < out[j].value
	})
	return out
}

func loadGoTable(path string) *gosym.Table {
	f, err := elf.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	sec := f.Section(".gopclntab")
	if sec == nil {
		return nil
	}
	// Skip large pclntab blobs under tight memory limits (keeps agent alive).
	// if sec.Size > 12*1024*1024 {
	if sec.Size > maxGoPclntabSize {
		return nil
	}
	data, err := sec.Data()
	if err != nil || len(data) < 16 {
		return nil
	}
	textStart := uint64(0)
	if text := f.Section(".text"); text != nil {
		textStart = text.Addr
	}
	lineTable := gosym.NewLineTable(data, textStart)
	table, err := gosym.NewTable([]byte{}, lineTable)
	if err != nil {
		return nil
	}
	return table
}

func demangleLite(name string) string {
	// Keep Go-style and C names readable; strip module path prefix.
	if i := strings.LastIndex(name, "/"); i >= 0 && i+1 < len(name) {
		return name[i+1:]
	}
	return name
}

func hexResolved(addrs []uint64, kind string) []resolvedFrame {
	frames := make([]resolvedFrame, 0, len(addrs))
	for _, addr := range addrs {
		if addr == 0 {
			break
		}
		frames = append(frames, resolvedFrame{
			Label:  "0x" + strconv.FormatUint(addr, 16),
			Kind:   kind,
			Offset: "+0x" + strconv.FormatUint(addr, 16),
		})
	}
	return frames
}

func resolveMixedStack(tgid int, kern, user []uint64) []resolvedFrame {
	// Leaf-first: kernel innermost … kernel entry, then user innermost … user root.
	var frames []resolvedFrame
	if len(kern) > 0 {
		for _, label := range resolveStackAddrs(kern) {
			frames = append(frames, resolvedFrame{Label: label, Kind: "kernel"})
		}
	}
	if len(user) > 0 {
		frames = append(frames, resolveUserStackAddrs(tgid, user)...)
	}
	if len(frames) == 0 {
		return nil
	}
	return frames
}
