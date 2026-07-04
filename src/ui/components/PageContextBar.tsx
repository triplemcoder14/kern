interface PageContextBarProps {
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
  showWindow?: boolean;
}

export function PageContextBar({
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
  connected,
  showWindow = false,
}: PageContextBarProps) {
  return (
    <div className="page-context-bar">
      <label className="page-context-control">
        <span>CLUSTER</span>
        <div className="page-context-value">{clusterName}</div>
      </label>
      <label className="page-context-control">
        <span>NAMESPACE</span>
        <select value={namespace} onChange={(event) => onNamespaceChange(event.target.value)}>
          <option value="all">All namespaces</option>
          {namespaces.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {showWindow ? (
        <label className="page-context-control">
          <span>WINDOW</span>
          <div className="page-context-value">Last 15 minutes</div>
        </label>
      ) : null}
      <div className={`page-context-live ${connected ? "on" : ""}`}>
        <span className="page-context-live-dot" />
        {connected ? "LIVE" : "OFFLINE"}
      </div>
    </div>
  );
}
