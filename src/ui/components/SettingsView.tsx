import { useState } from "react";
import {
  loadClusterConfig,
  saveClusterConfig,
  type ClusterConfig,
} from "../../core/config/cluster-config";

interface SettingsViewProps {
  busy: boolean;
  connected: boolean;
  error: string | null;
  onConnect: (config: ClusterConfig) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function SettingsView({
  busy,
  connected,
  error,
  onConnect,
  onDisconnect,
}: SettingsViewProps) {
  const [config, setConfig] = useState<ClusterConfig>(loadClusterConfig);
  const [showKubeconfig, setShowKubeconfig] = useState(Boolean(config.kubeconfig));

  const update = <K extends keyof ClusterConfig>(key: K, value: ClusterConfig[K]) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      saveClusterConfig(next);
      return next;
    });
  };

  return (
    <div className="settings-page">
      <header className="events-header">
        <div>
          <h1 className="events-title">Settings</h1>
          <p className="events-sub">Cluster connection, collector, and Hubble flow source</p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-title">CONNECTION</div>
          <label className="field-label">
            CLUSTER
            <input
              value={config.clusterName}
              onChange={(e) => update("clusterName", e.target.value)}
              className="text-input"
              disabled={connected}
            />
          </label>
          <label className="field-label">
            PROXY
            <input
              value={config.proxyUrl}
              onChange={(e) => update("proxyUrl", e.target.value)}
              className="text-input"
              disabled={connected}
            />
          </label>
          <label className="field-label">
            EBPF COLLECTOR
            <input
              value={config.ebpfCollectorUrl}
              onChange={(e) => update("ebpfCollectorUrl", e.target.value)}
              className="text-input"
              disabled={connected}
              placeholder="http://127.0.0.1:9474 — run port-forward-collector.sh"
            />
          </label>
          <label className="field-label">
            TOKEN
            <input
              value={config.token}
              onChange={(e) => update("token", e.target.value)}
              className="text-input"
              disabled={connected}
              type="password"
              autoComplete="off"
              placeholder="optional"
            />
          </label>
          <button
            type="button"
            className="config-toggle"
            disabled={connected}
            onClick={() => setShowKubeconfig((v) => !v)}
          >
            {showKubeconfig ? "− KUBECONFIG" : "+ KUBECONFIG"}
          </button>
          {showKubeconfig ? (
            <label className="field-label">
              KUBECONFIG
              <textarea
                value={config.kubeconfig}
                onChange={(e) => update("kubeconfig", e.target.value)}
                className="connect-textarea"
                disabled={connected}
                spellCheck={false}
              />
            </label>
          ) : null}
          {error ? <div className="connect-error">{error}</div> : null}
          <div className="connect-actions">
            {!connected ? (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => onConnect(config)}
              >
                {busy ? "CONNECTING…" : "CONNECT"}
              </button>
            ) : (
              <button type="button" className="btn-secondary" disabled={busy} onClick={onDisconnect}>
                DISCONNECT
              </button>
            )}
          </div>
        </section>

        <section className="settings-card settings-card-wide">
          <div className="settings-card-title">FLOW SOURCE (v0.4)</div>
          <p className="settings-hint">
            The collector supports <strong>auto</strong> (Hubble if available, else ProcNet),{" "}
            <strong>hubble</strong>, and <strong>proc</strong> modes. Mode is reported on the Network
            tab under eBPF Status after connect.
          </p>
          <pre className="settings-code">
            {`# Enable Cilium + Hubble on minikube
./scripts/enable-hubble.sh

# Deploy collector (auto mode, default)
./scripts/deploy-collector.sh

# Port-forward collector + optional Hubble UI
./scripts/port-forward-collector.sh
./scripts/port-forward-hubble.sh`}
          </pre>
        </section>
      </div>
    </div>
  );
}
