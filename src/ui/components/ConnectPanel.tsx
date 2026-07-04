import { useState } from "react";
import {
  loadClusterConfig,
  saveClusterConfig,
  type ClusterConfig,
} from "../../core/config/cluster-config";

interface ConnectPanelProps {
  busy: boolean;
  connected: boolean;
  error: string | null;
  onConnect: (config: ClusterConfig) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function ConnectPanel({
  busy,
  connected,
  error,
  onConnect,
  onDisconnect,
}: ConnectPanelProps) {
  const [config, setConfig] = useState<ClusterConfig>(loadClusterConfig);
  const [showKubeconfig, setShowKubeconfig] = useState(Boolean(config.kubeconfig));

  const update = <K extends keyof ClusterConfig>(key: K, value: ClusterConfig[K]) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      saveClusterConfig(next);
      return next;
    });
  };

  const handleConnect = async () => {
    saveClusterConfig(config);
    await onConnect(config);
  };

  return (
    <section className="panel connect-panel">
      <div className="panel-header">CONFIG</div>
      <div className="connect-body">
        <label className="field-label">
          CLUSTER
          <input
            value={config.clusterName}
            onChange={(event) => update("clusterName", event.target.value)}
            className="text-input"
            disabled={connected}
            placeholder="minikube"
          />
        </label>

        <label className="field-label">
          EBPF
          <input
            value={config.ebpfCollectorUrl}
            onChange={(event) => update("ebpfCollectorUrl", event.target.value)}
            className="text-input"
            disabled={connected}
            placeholder="/ebpf-api"
          />
        </label>

        <label className="field-label">
          PROXY
          <input
            value={config.proxyUrl}
            onChange={(event) => update("proxyUrl", event.target.value)}
            className="text-input"
            disabled={connected}
            placeholder="/k8s-api"
          />
        </label>

        <label className="field-label">
          TOKEN
          <input
            value={config.token}
            onChange={(event) => update("token", event.target.value)}
            className="text-input"
            disabled={connected}
            placeholder="optional"
            type="password"
            autoComplete="off"
          />
        </label>

        <button
          type="button"
          className="config-toggle"
          disabled={connected}
          onClick={() => setShowKubeconfig((value) => !value)}
        >
          {showKubeconfig ? "− KUBECONFIG" : "+ KUBECONFIG"}
        </button>

        {showKubeconfig ? (
          <label className="field-label">
            KUBECONFIG
            <textarea
              value={config.kubeconfig}
              onChange={(event) => update("kubeconfig", event.target.value)}
              className="connect-textarea"
              disabled={connected}
              placeholder="optional"
              spellCheck={false}
            />
          </label>
        ) : null}

        {error ? <div className="connect-error">{error}</div> : null}

        <div className="connect-actions">
          {!connected ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={handleConnect}>
              {busy ? "CONNECTING…" : "CONNECT"}
            </button>
          ) : (
            <button type="button" className="btn-secondary" disabled={busy} onClick={onDisconnect}>
              DISCONNECT
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
