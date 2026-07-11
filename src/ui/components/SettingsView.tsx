import { useEffect, useState, type ReactNode } from "react";
import {
  loadClusterConfig,
  saveClusterConfig,
  type ClusterConfig,
} from "../../core/config/cluster-config";
import {
  fetchStorageSettings,
  saveStorageSettings,
} from "../../lib/settings-api";
import type { SavedStorageSettings, StorageSettingsView } from "../../core/types/storage-settings";

interface SettingsViewProps {
  busy: boolean;
  connected: boolean;
  error: string | null;
  onConnect: (config: ClusterConfig) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

interface StorageForm {
  backend: "file" | "s3";
  dataDir: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const EMPTY_STORAGE: StorageForm = {
  backend: "file",
  dataDir: "",
  endpoint: "",
  region: "us-east-1",
  bucket: "",
  prefix: "",
  accessKeyId: "",
  secretAccessKey: "",
};

function storageToForm(view: StorageSettingsView): StorageForm {
  return {
    backend: view.backend,
    dataDir: view.dataDir,
    endpoint: view.s3?.endpoint ?? "",
    region: view.s3?.region ?? "us-east-1",
    bucket: view.s3?.bucket ?? "",
    prefix: view.s3?.prefix ?? "",
    accessKeyId: view.s3?.accessKeyId ?? "",
    secretAccessKey: "",
  };
}

function formToSaved(form: StorageForm): SavedStorageSettings {
  if (form.backend === "file") {
    return {
      backend: "file",
      dataDir: form.dataDir.trim() || undefined,
    };
  }

  return {
    backend: "s3",
    dataDir: form.dataDir.trim() || undefined,
    s3: {
      endpoint: form.endpoint.trim() || undefined,
      region: form.region.trim() || "us-east-1",
      bucket: form.bucket.trim(),
      prefix: form.prefix.trim(),
      accessKeyId: form.accessKeyId.trim(),
      secretAccessKey: form.secretAccessKey.trim() || undefined,
    },
  };
}

function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="settings-field">
      <span className="settings-field-label">{label}</span>
      {children}
      {hint ? <span className="settings-field-hint">{hint}</span> : null}
    </label>
  );
}

export function SettingsView({
  busy,
  connected,
  error,
  onConnect,
  onDisconnect,
}: SettingsViewProps) {
  const [config, setConfig] = useState<ClusterConfig>(loadClusterConfig);
  const [advanced, setAdvanced] = useState(
    Boolean(config.token.trim() || config.kubeconfig.trim()),
  );
  const [storage, setStorage] = useState<StorageForm>(EMPTY_STORAGE);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void fetchStorageSettings()
      .then((view) => {
        setStorage(storageToForm(view));
      })
      .catch((loadError) => {
        setStorageError(loadError instanceof Error ? loadError.message : "Failed to load storage");
      });
  }, []);

  const updateConfig = <K extends keyof ClusterConfig>(key: K, value: ClusterConfig[K]) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      saveClusterConfig(next);
      return next;
    });
  };

  const updateStorage = <K extends keyof StorageForm>(key: K, value: StorageForm[K]) => {
    setStorage((prev) => ({ ...prev, [key]: value }));
    setStorageNote(null);
    setStorageError(null);
  };

  const handleSaveStorage = async () => {
    setStorageBusy(true);
    setStorageError(null);
    try {
      const result = await saveStorageSettings(formToSaved(storage));
      setStorage(storageToForm(result));
      setStorageNote(result.restartRequired ? "Saved. Restart the API to apply storage changes." : "Saved.");
    } catch (saveError) {
      setStorageError(saveError instanceof Error ? saveError.message : "Failed to save storage");
    } finally {
      setStorageBusy(false);
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">Connect your cluster and choose where KERN persists data.</p>
        </div>
      </header>

      <div className="settings-layout">
        <section className="settings-panel">
          <div className="settings-panel-head">
            <div>
              <h2 className="settings-panel-title">Cluster</h2>
              <p className="settings-panel-desc">Agent URL and optional credentials.</p>
            </div>
            <span className={`settings-pill${connected ? " settings-pill-on" : ""}`}>
              {connected ? "Connected" : "Offline"}
            </span>
          </div>

          <div className="settings-fields">
            <SettingsField
              label="Cluster name"
              hint="Display name shown in the console (e.g. ocp-uat, prod-east)"
            >
              <input
                value={config.clusterName}
                onChange={(e) => {
                  setLocalError(null);
                  updateConfig("clusterName", e.target.value);
                }}
                className="settings-input"
                disabled={connected}
                placeholder="My cluster"
                required
              />
            </SettingsField>

            <SettingsField
              label="Agent URL"
              hint="Optional local port-forward; otherwise KERN reaches the in-cluster agent via kubectl proxy"
            >
              <input
                value={config.ebpfCollectorUrl}
                onChange={(e) => updateConfig("ebpfCollectorUrl", e.target.value)}
                className="settings-input settings-input-mono"
                disabled={connected}
                placeholder="http://127.0.0.1:9474"
              />
            </SettingsField>

            <button
              type="button"
              className="settings-advanced-toggle"
              disabled={connected}
              onClick={() => setAdvanced((value) => !value)}
            >
              {advanced ? "Hide advanced" : "Advanced"}
            </button>

            {advanced ? (
              <>
                <SettingsField label="Bearer token">
                  <input
                    value={config.token}
                    onChange={(e) => updateConfig("token", e.target.value)}
                    className="settings-input"
                    disabled={connected}
                    type="password"
                    autoComplete="off"
                    placeholder="Optional"
                  />
                </SettingsField>

                <SettingsField label="Kubeconfig">
                  <textarea
                    value={config.kubeconfig}
                    onChange={(e) => updateConfig("kubeconfig", e.target.value)}
                    className="settings-textarea"
                    disabled={connected}
                    spellCheck={false}
                    placeholder="Paste kubeconfig YAML"
                    rows={5}
                  />
                </SettingsField>
              </>
            ) : null}
          </div>

          {localError || error ? (
            <div className="settings-alert settings-alert-error">{localError ?? error}</div>
          ) : null}

          <div className="settings-actions">
            {!connected ? (
              <button
                type="button"
                className="settings-btn settings-btn-primary"
                disabled={busy}
                onClick={() => {
                  if (!config.clusterName.trim()) {
                    setLocalError("Cluster name is required.");
                    return;
                  }
                  setLocalError(null);
                  void onConnect(config);
                }}
              >
                {busy ? "Connecting…" : "Connect"}
              </button>
            ) : (
              <button
                type="button"
                className="settings-btn settings-btn-ghost"
                disabled={busy}
                onClick={() => void onDisconnect()}
              >
                Disconnect
              </button>
            )}
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-head">
            <div>
              <h2 className="settings-panel-title">Storage</h2>
              <p className="settings-panel-desc">Local files for dev, or your own S3-compatible bucket.</p>
            </div>
          </div>

          <div className="settings-segment" role="tablist" aria-label="Storage backend">
            <button
              type="button"
              role="tab"
              aria-selected={storage.backend === "file"}
              className={`settings-segment-btn${storage.backend === "file" ? " active" : ""}`}
              onClick={() => updateStorage("backend", "file")}
            >
              Local
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={storage.backend === "s3"}
              className={`settings-segment-btn${storage.backend === "s3" ? " active" : ""}`}
              onClick={() => updateStorage("backend", "s3")}
            >
              S3
            </button>
          </div>

          <div className="settings-fields">
            {storage.backend === "file" ? (
              <SettingsField label="Data directory" hint="Used when the API runs with local file storage">
                <input
                  value={storage.dataDir}
                  onChange={(e) => updateStorage("dataDir", e.target.value)}
                  className="settings-input settings-input-mono"
                  placeholder="api/data"
                />
              </SettingsField>
            ) : (
              <>
                <SettingsField label="Bucket">
                  <input
                    value={storage.bucket}
                    onChange={(e) => updateStorage("bucket", e.target.value)}
                    className="settings-input"
                    placeholder="kern-data"
                  />
                </SettingsField>

                <div className="settings-field-row">
                  <SettingsField label="Region">
                    <input
                      value={storage.region}
                      onChange={(e) => updateStorage("region", e.target.value)}
                      className="settings-input settings-input-mono"
                      placeholder="us-east-1"
                    />
                  </SettingsField>
                  <SettingsField label="Prefix">
                    <input
                      value={storage.prefix}
                      onChange={(e) => updateStorage("prefix", e.target.value)}
                      className="settings-input settings-input-mono"
                      placeholder="production"
                    />
                  </SettingsField>
                </div>

                <SettingsField label="Endpoint" hint="Optional — MinIO, R2, or custom S3">
                  <input
                    value={storage.endpoint}
                    onChange={(e) => updateStorage("endpoint", e.target.value)}
                    className="settings-input settings-input-mono"
                    placeholder="https://s3.amazonaws.com"
                  />
                </SettingsField>

                <SettingsField label="Access key ID">
                  <input
                    value={storage.accessKeyId}
                    onChange={(e) => updateStorage("accessKeyId", e.target.value)}
                    className="settings-input settings-input-mono"
                    autoComplete="off"
                  />
                </SettingsField>

                <SettingsField label="Secret access key">
                  <input
                    value={storage.secretAccessKey}
                    onChange={(e) => updateStorage("secretAccessKey", e.target.value)}
                    className="settings-input settings-input-mono"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Leave blank to keep existing"
                  />
                </SettingsField>
              </>
            )}
          </div>

          {storageError ? <div className="settings-alert settings-alert-error">{storageError}</div> : null}
          {storageNote ? <div className="settings-alert settings-alert-ok">{storageNote}</div> : null}

          <div className="settings-actions">
            <button
              type="button"
              className="settings-btn settings-btn-primary"
              disabled={storageBusy}
              onClick={() => void handleSaveStorage()}
            >
              {storageBusy ? "Saving…" : "Save storage"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
