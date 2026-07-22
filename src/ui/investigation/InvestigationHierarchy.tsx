import {
  investigationLabel,
  investigationLevel,
  type InvestigationFocus,
  type InvestigationLevel,
} from "./types";

interface InvestigationHierarchyProps {
  focus: InvestigationFocus | null;
  activeNode?: string;
  frameLabel?: string;
  onExitToNode: () => void;
  onClimb: (level: InvestigationLevel) => void;
  /** True when a prior workload investigation can be restored after Node mode. */
  canEnterWorkload?: boolean;
}

export function InvestigationHierarchy({
  focus,
  activeNode,
  frameLabel,
  onExitToNode,
  onClimb,
  canEnterWorkload = false,
}: InvestigationHierarchyProps) {
  const mode = focus ? "workload" : "node";
  const level = focus ? investigationLevel(focus) : "workload";
  const workloadAvailable = Boolean(focus) || canEnterWorkload;

  return (
    <div className="investigation-hierarchy">
      <div className="investigation-mode-switch" role="group" aria-label="Investigation mode">
        <button
          type="button"
          className={`investigation-mode-btn${mode === "node" ? " is-active" : ""}`}
          onClick={onExitToNode}
        >
          Node
        </button>
        <button
          type="button"
          className={`investigation-mode-btn${mode === "workload" ? " is-active" : ""}`}
          disabled={!workloadAvailable}
          title={
            workloadAvailable
              ? "Scope this node to the investigated workload"
              : "Start an investigation from the Service Map"
          }
          onClick={() => {
            onClimb("workload");
          }}
        >
          Workload
        </button>
      </div>

      <ol className="investigation-hierarchy-crumbs">
        <li>
          <span className="investigation-hierarchy-crumb investigation-hierarchy-crumb-static">
            {activeNode ?? focus?.nodeName ?? "node"}
          </span>
        </li>
        {focus ? (
          <>
            <li className="investigation-hierarchy-sep" aria-hidden>
              ›
            </li>
            <li>
              <button
                type="button"
                className={`investigation-hierarchy-crumb${level === "workload" ? " is-active" : ""}`}
                onClick={() => onClimb("workload")}
              >
                {investigationLabel(focus)}
              </button>
            </li>
            {focus.pod ? (
              <>
                <li className="investigation-hierarchy-sep" aria-hidden>
                  ›
                </li>
                <li>
                  <button
                    type="button"
                    className={`investigation-hierarchy-crumb${level === "pod" ? " is-active" : ""}`}
                    onClick={() => onClimb("pod")}
                  >
                    {focus.pod}
                  </button>
                </li>
              </>
            ) : null}
            {focus.pid !== undefined ? (
              <>
                <li className="investigation-hierarchy-sep" aria-hidden>
                  ›
                </li>
                <li>
                  <button
                    type="button"
                    className={`investigation-hierarchy-crumb${level === "process" ? " is-active" : ""}`}
                    onClick={() => onClimb("process")}
                  >
                    {focus.processName
                      ? `${focus.processName} · PID ${focus.pid}`
                      : `PID ${focus.pid}`}
                  </button>
                </li>
              </>
            ) : null}
            {frameLabel ? (
              <>
                <li className="investigation-hierarchy-sep" aria-hidden>
                  ›
                </li>
                <li>
                  <span className="investigation-hierarchy-crumb is-active investigation-hierarchy-crumb-static">
                    {frameLabel}
                  </span>
                </li>
              </>
            ) : null}
          </>
        ) : (
          <>
            <li className="investigation-hierarchy-sep" aria-hidden>
              ›
            </li>
            <li>
              <span className="investigation-hierarchy-crumb investigation-hierarchy-crumb-static">
                all workloads
              </span>
            </li>
          </>
        )}
      </ol>

      <p className="investigation-hierarchy-hint">
        {mode === "node"
          ? "Node investigation — samples from this node, every workload visible."
          : "Workload investigation — node-level samples, attributed and filtered to this focus."}
      </p>
    </div>
  );
}
