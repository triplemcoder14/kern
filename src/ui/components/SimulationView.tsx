import { useState } from "react";
import type { K8sResource, ResourceKind } from "../../core/types/k8s";
import {
  Inspector,
  ResourceTable,
  Sidebar,
  YamlEditor,
} from "./ClusterShell";

const DEFAULT_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: nginx
  namespace: default
spec:
  containers:
    - name: nginx
      image: nginx:1.25
`;

interface SimulationViewProps {
  yaml: string;
  onYamlChange: (value: string) => void;
  resources: K8sResource[];
  busy: boolean;
  onApply: () => Promise<void>;
  onReset: () => Promise<void>;
  onDelete: (resource: K8sResource) => Promise<void>;
}

export function SimulationView({
  yaml,
  onYamlChange,
  resources,
  busy,
  onApply,
  onReset,
  onDelete,
}: SimulationViewProps) {
  const [activeKind, setActiveKind] = useState<ResourceKind | "all">("all");
  const [selected, setSelected] = useState<K8sResource | null>(null);

  const filtered = resources.filter((resource) => {
    return activeKind === "all" || resource.kind === activeKind;
  });

  return (
    <div className="sim-page">
      <header className="events-header">
        <div>
          <h1 className="events-title">YAML Sandbox</h1>
          <p className="events-sub">Local simulation — no cluster required</p>
        </div>
      </header>
      <div className="sim-layout">
        <Sidebar
          activeKind={activeKind}
          onKindChange={setActiveKind}
          onApply={onApply}
          onReset={onReset}
          busy={busy}
        />
        <main className="app-main">
          <div className="app-upper">
            <YamlEditor value={yaml} onChange={onYamlChange} />
            <Inspector resource={selected} />
          </div>
          <div className="app-lower">
            <ResourceTable
              resources={filtered}
              selected={selected}
              onSelect={setSelected}
              onDelete={onDelete}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

export { DEFAULT_YAML };
