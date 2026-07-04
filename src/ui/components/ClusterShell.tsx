import type { K8sResource, ResourceKind } from "../../core/types/k8s";
import { getResourceNamespace, getResourceStatus } from "../../core/types/k8s";

interface TopBarProps {
  ready: boolean;
  namespace: string;
  onNamespaceChange: (value: string) => void;
  stats: { pods: number; deployments: number; services: number; namespaces: number };
}

export function TopBar({ ready, namespace, onNamespaceChange, stats }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">PORT-OF-K8S</span>
        </div>
        <span className="version">v0.1.0</span>
      </div>

      <div className="topbar-right">
        <label className="ns-label">
          NS
          <select value={namespace} onChange={(event) => onNamespaceChange(event.target.value)}>
            <option value="all">all</option>
            <option value="default">default</option>
          </select>
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`status-dot ${ready ? "ready" : ""}`} />
          <span>{ready ? "RUNNING" : "BOOTING"}</span>
        </div>
        <div className="stats">
          <span>PODS {stats.pods}</span>
          <span>DEPL {stats.deployments}</span>
          <span>SVC {stats.services}</span>
          <span>NS {stats.namespaces}</span>
        </div>
      </div>
    </header>
  );
}

interface SidebarProps {
  activeKind: ResourceKind | "all";
  onKindChange: (kind: ResourceKind | "all") => void;
  onApply: () => void;
  onReset: () => void;
  busy: boolean;
}

const NAV_ITEMS: Array<{ id: ResourceKind | "all"; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "Pod", label: "PODS" },
  { id: "Deployment", label: "DEPL" },
  { id: "Service", label: "SVC" },
  { id: "Namespace", label: "NS" },
];

export function Sidebar({ activeKind, onKindChange, onApply, onReset, busy }: SidebarProps) {
  return (
    <aside className="sidebar">
      <nav>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onKindChange(item.id)}
            className={`nav-btn ${activeKind === item.id ? "active" : ""}`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-actions">
        <button type="button" onClick={onApply} disabled={busy} className="btn-primary">
          APPLY
        </button>
        <button type="button" onClick={onReset} disabled={busy} className="btn-secondary">
          RESET
        </button>
      </div>
    </aside>
  );
}

interface YamlEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function YamlEditor({ value, onChange }: YamlEditorProps) {
  return (
    <section className="panel yaml-panel">
      <div className="panel-header">MANIFEST</div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="yaml-input"
      />
    </section>
  );
}

interface ResourceTableProps {
  resources: K8sResource[];
  selected: K8sResource | null;
  onSelect: (resource: K8sResource) => void;
  onDelete: (resource: K8sResource) => void;
}

export function ResourceTable({ resources, selected, onSelect, onDelete }: ResourceTableProps) {
  return (
    <section className="panel" style={{ flex: 1 }}>
      <div className="panel-header">RESOURCES</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>KIND</th>
              <th>NAME</th>
              <th>NS</th>
              <th>STATUS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {resources.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-row">
                  No resources. Apply a manifest to begin.
                </td>
              </tr>
            ) : (
              resources.map((resource) => {
                const isSelected =
                  selected?.kind === resource.kind &&
                  selected.metadata.name === resource.metadata.name &&
                  getResourceNamespace(selected) === getResourceNamespace(resource);

                return (
                  <tr
                    key={`${resource.kind}-${getResourceNamespace(resource)}-${resource.metadata.name}`}
                    onClick={() => onSelect(resource)}
                    className={isSelected ? "selected" : undefined}
                  >
                    <td>{resource.kind}</td>
                    <td>{resource.metadata.name}</td>
                    <td>{getResourceNamespace(resource) || "—"}</td>
                    <td>{getResourceStatus(resource)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(resource);
                        }}
                        className="btn-del"
                      >
                        DEL
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface InspectorProps {
  resource: K8sResource | null;
}

export function Inspector({ resource }: InspectorProps) {
  return (
    <aside className="panel inspector">
      <div className="panel-header">INSPECTOR</div>
      <pre>{resource ? JSON.stringify(resource, null, 2) : "Select a resource to inspect."}</pre>
    </aside>
  );
}

interface StatusBarProps {
  error: string | null;
  busy: boolean;
}

export function StatusBar({ error, busy }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span className={`statusbar-msg ${error ? "error" : ""}`}>
        {error ?? (busy ? "PROCESSING..." : "READY")}
      </span>
      <span className="statusbar-meta">WORKER RUNTIME · INDEXEDDB · SIMULATION MODE</span>
    </footer>
  );
}
