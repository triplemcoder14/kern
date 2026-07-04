import { PageContextBar } from "./PageContextBar";

interface NetworkObservatoryHeaderProps {
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
  flowCount: number;
  routeCount: number;
}

export function NetworkObservatoryHeader({
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
  connected,
  flowCount,
  routeCount,
}: NetworkObservatoryHeaderProps) {
  return (
    <header className="obs-header">
      <div className="obs-header-left">
        <h1 className="obs-title">Network Observability</h1>
        <p className="obs-sub">
          {routeCount} routes · {flowCount} flows · real-time pod & service map
        </p>
      </div>
      <PageContextBar
        clusterName={clusterName}
        namespace={namespace}
        namespaces={namespaces}
        onNamespaceChange={onNamespaceChange}
        connected={connected}
        showWindow
      />
    </header>
  );
}
