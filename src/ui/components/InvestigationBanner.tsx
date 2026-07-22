import {
  investigationLabel,
  investigationStartedAgo,
  investigationWindowLabel,
  type InvestigationFocus,
} from "../investigation/types";

interface InvestigationBannerProps {
  focus: InvestigationFocus;
  onExit: () => void;
}

export function InvestigationBanner({ focus, onExit }: InvestigationBannerProps) {
  const label = investigationLabel(focus);

  return (
    <div className="investigation-banner" role="status">
      <div className="investigation-banner-copy">
        <span className="investigation-banner-kicker">Investigating</span>
        <strong className="investigation-banner-target">{label}</strong>
        {/* Previous: only "Started from … · just now" — implied data began at click time.
        <span className="investigation-banner-meta">
          Started from {focus.startedFrom} · {investigationStartedAgo(focus)}
        </span>
        */}
        <span className="investigation-banner-meta">
          Started from {focus.startedFrom} · {investigationStartedAgo(focus)}
        </span>
        <span className="investigation-banner-window">
          Data window: {investigationWindowLabel(focus.window)}
          {focus.live ? " · Live updates: On" : " · Live updates: Off"}
        </span>
      </div>
      <button type="button" className="investigation-banner-exit" onClick={onExit}>
        Exit investigation
      </button>
    </div>
  );
}
