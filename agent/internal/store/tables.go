package store

import (
	"sync"
	"time"
)

const (
	TableFlows     = "flows"
	TableCPUStacks = "cpu_stacks"
	DefaultMaxRows = 4096
)

// Row is one columnar-ish record stored in a named in-memory table.
type Row map[string]any

type MemoryTable struct {
	mu      sync.RWMutex
	name    string
	maxRows int
	rows    []Row
}

func NewMemoryTable(name string, maxRows int) *MemoryTable {
	if maxRows <= 0 {
		maxRows = DefaultMaxRows
	}
	return &MemoryTable{name: name, maxRows: maxRows, rows: make([]Row, 0, maxRows)}
}

func (t *MemoryTable) Name() string {
	return t.name
}

func (t *MemoryTable) Append(row Row) {
	if row == nil {
		return
	}
	if _, ok := row["ts"]; !ok {
		row["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rows = append(t.rows, row)
	if len(t.rows) > t.maxRows {
		t.rows = t.rows[len(t.rows)-t.maxRows:]
	}
}

func (t *MemoryTable) Snapshot(limit int) []Row {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if limit <= 0 || limit > len(t.rows) {
		limit = len(t.rows)
	}
	out := make([]Row, limit)
	copy(out, t.rows[len(t.rows)-limit:])
	return out
}

func (t *MemoryTable) Len() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.rows)
}

// TableStore holds short-lived per-node tables used by the agent API.
type TableStore struct {
	mu     sync.RWMutex
	tables map[string]*MemoryTable
}

func NewTableStore() *TableStore {
	ts := &TableStore{tables: make(map[string]*MemoryTable)}
	ts.tables[TableFlows] = NewMemoryTable(TableFlows, MaxFlows)
	ts.tables[TableCPUStacks] = NewMemoryTable(TableCPUStacks, 2048)
	return ts
}

func (s *TableStore) Get(name string) (*MemoryTable, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	table, ok := s.tables[name]
	return table, ok
}

func (s *TableStore) Names() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	names := make([]string, 0, len(s.tables))
	for name := range s.tables {
		names = append(names, name)
	}
	return names
}

func (s *TableStore) Append(name string, row Row) {
	s.mu.RLock()
	table, ok := s.tables[name]
	s.mu.RUnlock()
	if !ok {
		s.mu.Lock()
		table, ok = s.tables[name]
		if !ok {
			table = NewMemoryTable(name, DefaultMaxRows)
			s.tables[name] = table
		}
		s.mu.Unlock()
	}
	table.Append(row)
}
