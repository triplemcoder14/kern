import type {
  FrameExplanation,
  InvestigationEvidence,
  InvestigationNextStep,
  InvestigationWorkflow,
  LayeredHotspot,
} from "./investigation-workflow";

type InvestigationWorkflowPanelProps = {
  workflow: InvestigationWorkflow;
  frameExplanation?: FrameExplanation | null;
  onEvidence: (item: InvestigationEvidence) => void;
  onHotspot: (item: LayeredHotspot) => void;
  onNextStep: (item: InvestigationNextStep) => void;
};

function qualityMark(value: "ok" | "partial" | "missing"): string {
  if (value === "ok") {
    return "✓";
  }
  if (value === "partial") {
    return "~";
  }
  return "—";
}

export function InvestigationWorkflowPanel({
  workflow,
  frameExplanation,
  onEvidence,
  onHotspot,
  onNextStep,
}: InvestigationWorkflowPanelProps) {
  const stars = "★".repeat(workflow.quality.stars) + "☆".repeat(5 - workflow.quality.stars);

  return (
    <div className="investigation-workflow" role="region" aria-label="Investigation workflow">
      <section className="investigation-block">
        <div className="investigation-block-head">
          <span className="profile-panel-label">Investigation Summary</span>
          <span
            className={`network-flame-confidence network-flame-confidence-${workflow.confidence.toLowerCase()}`}
          >
            Confidence: {workflow.confidence}
          </span>
        </div>
        <h3 className="investigation-headline">{workflow.headline}</h3>

        <div className="investigation-section">
          <span className="profile-panel-label">Reasoning</span>
          <ul className="investigation-check-list">
            {workflow.reasoning.map((item) => (
              <li key={item}>✓ {item}</li>
            ))}
          </ul>
        </div>

        <div className="investigation-section">
          <span className="profile-panel-label">Interpretation</span>
          <p className="investigation-interpretation">{workflow.interpretation}</p>
        </div>

        {workflow.evidence.length > 0 ? (
          <div className="investigation-section">
            <span className="profile-panel-label">Evidence</span>
            <ul className="investigation-evidence-list">
              {workflow.evidence.map((item) => (
                <li key={item.id}>
                  {item.action ? (
                    <button
                      type="button"
                      className="network-flame-evidence-btn"
                      onClick={() => onEvidence(item)}
                    >
                      {item.text}
                    </button>
                  ) : (
                    <span>{item.text}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="investigation-block">
        <span className="profile-panel-label">Investigation Questions</span>
        <div className="investigation-questions">
          {workflow.questions.map((item) => (
            <article key={item.id} className="investigation-question">
              <h4>{item.question}</h4>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
      </section>

      {workflow.hotspots.length > 0 ? (
        <section className="investigation-block">
          <span className="profile-panel-label">Hotspots</span>
          <ul className="investigation-hotspots">
            {workflow.hotspots.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="investigation-hotspot-btn"
                  onClick={() => onHotspot(item)}
                >
                  <span className="investigation-hotspot-layer">{item.layer}</span>
                  <span className="investigation-hotspot-label">{item.label}</span>
                  <span className="investigation-hotspot-share">{item.sharePct}%</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="investigation-block">
        <span className="profile-panel-label">Recommended Next Steps</span>
        <ul className="investigation-next-steps">
          {workflow.nextSteps.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="investigation-next-btn"
                onClick={() => onNextStep(item)}
              >
                <span className="investigation-next-label">{item.label}</span>
                <span className="investigation-next-hint">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="investigation-block">
        <span className="profile-panel-label">Profile Quality</span>
        <div className="investigation-quality">
          <div className="investigation-quality-stars" aria-label={`${workflow.quality.stars} of 5`}>
            {stars}
          </div>
          <dl className="investigation-quality-grid">
            <div>
              <dt>Samples</dt>
              <dd>
                {workflow.quality.samples !== undefined
                  ? workflow.quality.samples.toLocaleString()
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Window</dt>
              <dd>
                {workflow.quality.windowSeconds !== undefined
                  ? `${workflow.quality.windowSeconds}s`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Rate</dt>
              <dd>
                {workflow.quality.sampleHz !== undefined
                  ? `${workflow.quality.sampleHz}Hz`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Kernel stacks</dt>
              <dd>{qualityMark(workflow.quality.kernelStacks)}</dd>
            </div>
            <div>
              <dt>Userspace stacks</dt>
              <dd>{qualityMark(workflow.quality.userspaceStacks)}</dd>
            </div>
            <div>
              <dt>PID attribution</dt>
              <dd>{qualityMark(workflow.quality.pidAttribution)}</dd>
            </div>
            <div>
              <dt>Pod attribution</dt>
              <dd>{qualityMark(workflow.quality.podAttribution)}</dd>
            </div>
          </dl>
          {workflow.quality.notes.length > 0 ? (
            <ul className="investigation-quality-notes">
              {workflow.quality.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {frameExplanation ? (
        <section className="investigation-block investigation-explain">
          <span className="profile-panel-label">What is this?</span>
          <h4 className="investigation-explain-title">{frameExplanation.title}</h4>
          <p>{frameExplanation.what}</p>
          {frameExplanation.commonReasons.length > 0 ? (
            <>
              <span className="profile-panel-label">Common reasons</span>
              <ul className="investigation-check-list">
                {frameExplanation.commonReasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </>
          ) : null}
          {frameExplanation.docsHint ? (
            <p className="investigation-explain-hint">{frameExplanation.docsHint}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
