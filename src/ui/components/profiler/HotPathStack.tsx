import type { ProfileStackFrame } from "../../../core/types/profiling";
import type { InvestigationTarget } from "./InvestigationPanel";

interface HotPathStackProps {
  frames: ProfileStackFrame[];
  label: string;
  onSelect: (target: InvestigationTarget) => void;
  selectedLabel?: string;
}

export function HotPathStack({ frames, label, onSelect, selectedLabel }: HotPathStackProps) {
  const sorted = [...frames].sort((a, b) => a.depth - b.depth);

  return (
    <div className="profile-hotpath">
      <span className="profile-panel-label">{label}</span>
      <div className="profile-hotpath-stack">
        {sorted.map((frame, index) => (
          <div key={`${frame.label}-${frame.depth}`} className="profile-hotpath-item">
            {index > 0 ? <span className="profile-hotpath-arrow" aria-hidden>↓</span> : null}
            <button
              type="button"
              className={`profile-hotpath-node${selectedLabel === frame.label ? " profile-hotpath-node-active" : ""}`}
              onClick={() => onSelect({ kind: "stack", label: frame.label, heat: frame.heat })}
            >
              <span>{frame.label}</span>
              <span className="profile-hotpath-heat">{(frame.heat * 100).toFixed(0)}%</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
