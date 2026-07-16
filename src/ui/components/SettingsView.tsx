import { useEffect, useState, type ReactNode } from "react";
import {
  loadClusterConfig,
  saveClusterConfig,
  type ClusterConfig,
} from "../../core/config/cluster-config";
import {
  fetchRetentionSettings,
  fetchStorageSettings,
  saveRetentionSettings,
  saveStorageSettings,
} from "../../lib/settings-api";
import { friendlySettingsLoadError } from "../lib/friendly-errors";
import type { SavedStorageSettings, StorageSettingsView } from "../../core/types/storage-settings";
import type { SavedRetentionSettings } from "../../core/types/retention-settings";

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

interface RetentionForm {
  maxEventAgeHours: number;
  maxEvents: number;
  maxIncidents: number;
  maxSnapshots: number;
  maxFlows: number;
  maxSnapshotFlows: number;
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

const EMPTY_RETENTION: RetentionForm = {
  maxEventAgeHours: 6,
  maxEvents: 300,
  maxIncidents: 100,
  maxSnapshots: 60,
  maxFlows: 200,
  maxSnapshotFlows: 80,
};

const RETENTION_WINDOWS = [
  { label: "1 hour", hours: 1 },
  { label: "6 hours", hours: 6 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "Count only", hours: 0 },
] as const;

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

function retentionToForm(settings: SavedRetentionSettings): RetentionForm {
  return {
    maxEventAgeHours: settings.maxEventAgeHours,
    maxEvents: settings.maxEvents,
    maxIncidents: settings.maxIncidents,
    maxSnapshots: settings.maxSnapshots,
    maxFlows: settings.maxFlows,
    maxSnapshotFlows: settings.maxSnapshotFlows,
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

function IconGlobe() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="settings-card-icon-svg">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9c-2.5-2.8-3.8-5.8-3.8-9s1.3-6.2 3.8-9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function IconStorage() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="settings-card-icon-svg">
      <ellipse cx="12" cy="6" rx="7" ry="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="settings-card-icon-svg">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="settings-card-icon-svg">
      <path
        d="M12 3l7 3v5c0 4.5-2.8 7.8-7 9-4.2-1.2-7-4.5-7-9V6l7-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSave() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="14" height="14">
      <path
        d="M5 5h11l3 3v11H5V5zM8 5v4h7V5M8 19v-6h8v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={`settings-chevron${open ? " settings-chevron-open" : ""}`}
    >
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(config.token.trim() || config.kubeconfig.trim()),
  );
  const [storage, setStorage] = useState<StorageForm>(EMPTY_STORAGE);
  const [retention, setRetention] = useState<RetentionForm>(EMPTY_RETENTION);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [softNotice, setSoftNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void fetchStorageSettings()
      .then((view) => {
        setStorage(storageToForm(view));
      })
      .catch((loadError) => {
        const friendly = friendlySettingsLoadError(loadError);
        if (friendly.soft) {
          setSoftNotice(friendly.message);
        } else {
          setSaveError(friendly.message);
        }
      });

    void fetchRetentionSettings()
      .then((view) => {
        setRetention(retentionToForm(view));
      })
      .catch((loadError) => {
        const friendly = friendlySettingsLoadError(loadError);
        if (friendly.soft) {
          setSoftNotice(friendly.message);
        } else {
          setSaveError(friendly.message);
        }
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
    setSaveNote(null);
    setSaveError(null);
  };

  const updateRetention = <K extends keyof RetentionForm>(key: K, value: RetentionForm[K]) => {
    setRetention((prev) => ({ ...prev, [key]: value }));
    setSaveNote(null);
    setSaveError(null);
  };

  const handleSaveAll = async () => {
    setSaveBusy(true);
    setSaveError(null);
    setSaveNote(null);
    try {
      const [storageResult, retentionResult] = await Promise.all([
        saveStorageSettings(formToSaved(storage)),
        saveRetentionSettings(retention),
      ]);
      setStorage(storageToForm(storageResult));
      setRetention(retentionToForm(retentionResult));
      setSaveNote(
        storageResult.restartRequired
          ? "Saved. Restart the API to apply storage backend changes."
          : "All settings saved.",
      );
    } catch (saveErr) {
      setSaveError(saveErr instanceof Error ? saveErr.message : "Failed to save settings");
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">
            Configure how KERN connects, stores, and retains data.
          </p>
        </div>
        <button
          type="button"
          className="settings-btn settings-btn-primary settings-save-all"
          disabled={saveBusy}
          onClick={() => void handleSaveAll()}
        >
          <IconSave />
          {saveBusy ? "Saving…" : "Save all"}
        </button>
      </header>

      <div className="settings-stack">
        {saveError ? <div className="settings-alert settings-alert-error">{saveError}</div> : null}
        {softNotice ? <div className="settings-alert settings-alert-soft">{softNotice}</div> : null}
        {saveNote ? <div className="settings-alert settings-alert-ok">{saveNote}</div> : null}
        {localError || error ? (
          <div
            className={`settings-alert ${
              (localError ?? error ?? "").toLowerCase().includes("abort")
                ? "settings-alert-soft"
                : "settings-alert-error"
            }`}
          >
            {(localError ?? error ?? "").toLowerCase().includes("abort")
              ? "Unable to refresh settings."
              : (localError ?? error)}
          </div>
        ) : null}

        <div className="settings-grid-top">
        <section className="settings-card">
          <div className="settings-card-head">
            <div className="settings-card-title-row">
              <span className="settings-card-icon">
                <IconGlobe />
              </span>
              <div>
                <h2 className="settings-card-title">Cluster</h2>
                <p className="settings-card-desc">Connect to your cluster agent.</p>
              </div>
            </div>
            <span className={`settings-status${connected ? " settings-status-on" : ""}`}>
              <span className="settings-status-dot" aria-hidden />
              {connected ? "Connected" : "Offline"}
            </span>
          </div>

          <div className="settings-fields">
            <SettingsField
              label="Cluster name"
              hint="Optional — auto-detected from the live cluster when left blank"
            >
              <input
                value={config.clusterName}
                onChange={(e) => {
                  setLocalError(null);
                  updateConfig("clusterName", e.target.value);
                }}
                className="settings-input"
                disabled={connected}
                placeholder="Auto-detect from nodes"
              />
            </SettingsField>

            <SettingsField
              label="Agent URL"
              hint="KERN agent endpoint. Use local port-forward or in-cluster URL."
            >
              <input
                value={config.ebpfCollectorUrl}
                onChange={(e) => updateConfig("ebpfCollectorUrl", e.target.value)}
                className="settings-input settings-input-mono"
                disabled={connected}
                placeholder="http://127.0.0.1:9474"
              />
            </SettingsField>
          </div>

          <div className="settings-card-actions">
            {!connected ? (
              <button
                type="button"
                className="settings-btn settings-btn-primary"
                disabled={busy}
                onClick={() => {
                  setLocalError(null);
                  const next = {
                    ...config,
                    clusterName: config.clusterName.trim() || "cluster",
                  };
                  void onConnect(next);
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

        <section className="settings-card">
          <div className="settings-card-head">
            <div className="settings-card-title-row">
              <span className="settings-card-icon">
                <IconStorage />
              </span>
              <div>
                <h2 className="settings-card-title">Storage</h2>
                <p className="settings-card-desc">Choose where KERN stores data.</p>
              </div>
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
              <SettingsField label="Data directory" hint="Used by API and agent for local storage.">
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
        </section>
        </div>

        <section className="settings-card">
          <div className="settings-card-head">
            <div className="settings-card-title-row">
              <span className="settings-card-icon">
                <IconClock />
              </span>
              <div>
                <h2 className="settings-card-title">Data retention</h2>
                <p className="settings-card-desc">
                  Cap how long data is kept and how much is stored.
                </p>
              </div>
            </div>
          </div>

          <div className="settings-fields">
            <SettingsField
              label="Event window"
              hint={
                retention.maxEventAgeHours === 0
                  ? "Count-only mode keeps the newest events in memory."
                  : "Drop monitor events older than this window."
              }
            >
              <div
                className="settings-segment settings-segment-wrap"
                role="tablist"
                aria-label="Event retention window"
              >
                {RETENTION_WINDOWS.map((option) => (
                  <button
                    key={option.hours}
                    type="button"
                    role="tab"
                    aria-selected={retention.maxEventAgeHours === option.hours}
                    className={`settings-segment-btn${retention.maxEventAgeHours === option.hours ? " active" : ""}`}
                    onClick={() => updateRetention("maxEventAgeHours", option.hours)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </SettingsField>

            <div className="settings-retention-grid">
              <SettingsField label="Max events" hint="Newest events kept">
                <input
                  type="number"
                  min={50}
                  max={5000}
                  value={retention.maxEvents}
                  onChange={(e) => updateRetention("maxEvents", Number(e.target.value) || 50)}
                  className="settings-input settings-input-mono"
                />
              </SettingsField>
              <SettingsField label="Max incidents" hint="Open incidents kept">
                <input
                  type="number"
                  min={10}
                  max={1000}
                  value={retention.maxIncidents}
                  onChange={(e) => updateRetention("maxIncidents", Number(e.target.value) || 10)}
                  className="settings-input settings-input-mono"
                />
              </SettingsField>
              <SettingsField label="Max snapshots" hint="Snapshots retained">
                <input
                  type="number"
                  min={10}
                  max={500}
                  value={retention.maxSnapshots}
                  onChange={(e) => updateRetention("maxSnapshots", Number(e.target.value) || 10)}
                  className="settings-input settings-input-mono"
                />
              </SettingsField>
              <SettingsField label="Flows per snapshot" hint="Flows stored per snapshot">
                <input
                  type="number"
                  min={20}
                  max={500}
                  value={retention.maxSnapshotFlows}
                  onChange={(e) =>
                    updateRetention("maxSnapshotFlows", Number(e.target.value) || 20)
                  }
                  className="settings-input settings-input-mono"
                />
              </SettingsField>
            </div>
          </div>
        </section>

        <section className="settings-card settings-card-advanced">
          <button
            type="button"
            className="settings-advanced-trigger"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <div className="settings-card-title-row">
              <span className="settings-card-icon">
                <IconShield />
              </span>
              <div className="settings-advanced-copy">
                <h2 className="settings-card-title">Advanced</h2>
                <p className="settings-card-desc">Optional network settings.</p>
              </div>
            </div>
            <IconChevron open={advancedOpen} />
          </button>

          {advancedOpen ? (
            <div className="settings-fields settings-advanced-body">
              <SettingsField label="Live flow buffer" hint="Flows kept in the live network engine">
                <input
                  type="number"
                  min={50}
                  max={2000}
                  value={retention.maxFlows}
                  onChange={(e) => updateRetention("maxFlows", Number(e.target.value) || 50)}
                  className="settings-input settings-input-mono"
                />
              </SettingsField>

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
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
