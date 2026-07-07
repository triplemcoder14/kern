import { Link } from "react-router-dom";
import {
  ConnectClusterFlow,
  FeaturesSection,
  HeroIsometric,
  ProductMockup,
  ProfilingPreview,
  TalkEventsPreview,
  type LandingFeature,
} from "../components/landing/LandingGraphics";
import { LandingNavMenu, LandingNavMenuGroup } from "../components/landing/LandingNavMenu";
import { KernWordmark } from "../components/KernWordmark";

const GITHUB_REPO = "https://github.com/triplemcoder14/kern";
const INSTALL_DOCS = `${GITHUB_REPO}#quick-start`;
const DISCORD_URL = "https://discord.gg/kern";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 19 19" aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9.356 1.85C5.05 1.85 1.57 5.356 1.57 9.694a7.84 7.84 0 0 0 5.324 7.44c.387.079.528-.168.528-.376 0-.182-.013-.805-.013-1.454-2.165.467-2.616-.935-2.616-.935-.349-.91-.864-1.143-.864-1.143-.71-.48.051-.48.051-.48.787.051 1.2.805 1.2.805.695 1.194 1.817.857 2.268.649.064-.507.27-.857.49-1.052-1.728-.182-3.545-.857-3.545-3.87 0-.857.31-1.558.8-2.104-.078-.195-.349-1 .077-2.078 0 0 .657-.208 2.14.805a7.5 7.5 0 0 1 1.946-.26c.657 0 1.328.092 1.946.26 1.483-1.013 2.14-.805 2.14-.805.426 1.078.155 1.883.078 2.078.502.546.799 1.247.799 2.104 0 3.013-1.818 3.675-3.558 3.87.284.247.528.714.528 1.454 0 1.052-.012 1.896-.012 2.156 0 .208.142.455.528.377a7.84 7.84 0 0 0 5.324-7.441c.013-4.338-3.48-7.844-7.773-7.844"
        clipRule="evenodd"
      />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 20 19" aria-hidden>
      <path
        fill="currentColor"
        d="M16.224 3.768a14.5 14.5 0 0 0-3.67-1.153c-.158.286-.343.67-.47.976a13.5 13.5 0 0 0-4.067 0c-.128-.306-.317-.69-.476-.976A14.4 14.4 0 0 0 3.868 3.77C1.546 7.28.916 10.703 1.231 14.077a14.7 14.7 0 0 0 4.5 2.306q.545-.748.965-1.587a9.5 9.5 0 0 1-1.518-.74q.191-.14.372-.293c2.927 1.369 6.107 1.369 8.999 0q.183.152.372.294-.723.437-1.52.74.418.838.963 1.588a14.6 14.6 0 0 0 4.504-2.308c.37-3.911-.63-7.302-2.644-10.309m-9.13 8.234c-.878 0-1.599-.82-1.599-1.82 0-.998.705-1.82 1.6-1.82.894 0 1.614.82 1.599 1.82.001 1-.705 1.82-1.6 1.82m5.91 0c-.878 0-1.599-.82-1.599-1.82 0-.998.705-1.82 1.6-1.82.893 0 1.614.82 1.599 1.82 0 1-.706 1.82-1.6 1.82"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="landing-star-icon">
      <path
        fill="currentColor"
        d="M8 1.5l1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 10.77l-3.52 1.85.67-3.92-2.85-2.78 3.94-.57L8 1.5Z"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="landing-btn-arrow">
      <path d="M3 8h9M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const WHY_KERNEL = [
  {
    title: "Zero instrumentation",
    body: "No code changes. The kernel sees syscalls, HTTP, and database calls.",
  },
  {
    title: "Minimal overhead",
    body: "No sidecar per pod — lightweight eBPF in kernel space.",
  },
  {
    title: "Deep visibility",
    body: "Connections, DNS, CPU, memory, and latency at the source.",
  },
  {
    title: "End-to-end context",
    body: "Pods, policy, and traffic correlated in one place.",
  },
] as const;

const FEATURES: readonly LandingFeature[] = [
  {
    id: "topology",
    label: "Topology",
    body: "Live service map from kernel flows — pods, DNS, and connections as your cluster shifts.",
    accent: "ok",
  },
  {
    id: "flows",
    label: "Flows",
    body: "Talk events when a path starts, degrades, or drops — traced at the kernel, not guessed from logs.",
    accent: "line",
  },
  {
    id: "alerts",
    label: "Alerts",
    body: "Path-level incidents tied to real traffic — not vague thresholds on aggregated metrics.",
    accent: "warn",
  },
  {
    id: "profiling",
    label: "Kernel-level profiling",
    body: "CPU, memory, network, and scheduler activity.",
    accent: "neutral",
  },
  {
    id: "storage",
    label: "Local & S3 storage",
    body: "Local files for dev, or your own S3-compatible bucket — MinIO, R2, AWS.",
    accent: "ok",
  },
] as const;

const PRODUCT_LINKS = [
  { label: "Install", href: INSTALL_DOCS },
  { label: "API", href: `${GITHUB_REPO}/tree/main/api` },
  { label: "Agent", href: `${GITHUB_REPO}/tree/main/agent` },
  { label: "Helm chart", href: `${GITHUB_REPO}/tree/main/deploy/helm/kern` },
] as const;

const PRODUCT_NAV = PRODUCT_LINKS;

const FEATURE_NAV = [
  { label: "Topology", href: "#feature-topology" },
  { label: "Flows", href: "#feature-flows" },
  { label: "Events", href: "#events" },
  { label: "Alerts", href: "#feature-alerts" },
  { label: "Profiling", href: "#profiling" },
  { label: "Local & S3 storage", href: "#feature-storage" },
] as const;

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-wrap landing-nav-inner">
          <Link to="/" className="landing-brand">
            <KernWordmark />
          </Link>

          <nav className="landing-nav-center">
            <LandingNavMenuGroup>
              <LandingNavMenu label="Product" items={PRODUCT_NAV} />
              <LandingNavMenu label="Features" items={FEATURE_NAV} />
            </LandingNavMenuGroup>
            <a href="https://github.com/triplemcoder14/kern" target="_blank" rel="noreferrer">
              Docs
            </a>
          </nav>

          <div className="landing-nav-right">
            <a
              href="https://github.com/triplemcoder14/kern"
              target="_blank"
              rel="noreferrer"
              className="landing-nav-github"
              aria-label="GitHub"
            >
              <svg viewBox="0 0 19 19" aria-hidden>
                <path
                  fill="currentColor"
                  fillRule="evenodd"
                  d="M9.356 1.85C5.05 1.85 1.57 5.356 1.57 9.694a7.84 7.84 0 0 0 5.324 7.44c.387.079.528-.168.528-.376 0-.182-.013-.805-.013-1.454-2.165.467-2.616-.935-2.616-.935-.349-.91-.864-1.143-.864-1.143-.71-.48.051-.48.051-.48.787.051 1.2.805 1.2.805.695 1.194 1.817.857 2.268.649.064-.507.27-.857.49-1.052-1.728-.182-3.545-.857-3.545-3.87 0-.857.31-1.558.8-2.104-.078-.195-.349-1 .077-2.078 0 0 .657-.208 2.14.805a7.5 7.5 0 0 1 1.946-.26c.657 0 1.328.092 1.946.26 1.483-1.013 2.14-.805 2.14-.805.426 1.078.155 1.883.078 2.078.502.546.799 1.247.799 2.104 0 3.013-1.818 3.675-3.558 3.87.284.247.528.714.528 1.454 0 1.052-.012 1.896-.012 2.156 0 .208.142.455.528.377a7.84 7.84 0 0 0 5.324-7.441c.013-4.338-3.48-7.844-7.773-7.844"
                  clipRule="evenodd"
                />
              </svg>
            </a>
            <a href={INSTALL_DOCS} target="_blank" rel="noreferrer" className="landing-nav-cta">
              Install
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-wrap landing-hero-grid">
            <div className="landing-hero-copy">
              <h1 className="landing-headline">Kernel observability for Kubernetes.</h1>
              <p className="landing-lede">
                Self-hosted eBPF profiling that lets you investigate CPU, memory, networking, and
                kernel behavior—from pod to kernel stack.
              </p>

              <div className="landing-hero-actions">
                <a href={INSTALL_DOCS} target="_blank" rel="noreferrer" className="landing-btn landing-btn-primary">
                  Install KERN
                  <ArrowIcon />
                </a>
                <a
                  href={`${GITHUB_REPO}#readme`}
                  target="_blank"
                  rel="noreferrer"
                  className="landing-btn landing-btn-secondary"
                >
                  Read docs
                </a>
              </div>
            </div>
            <HeroIsometric />
          </div>
        </section>

        <section className="landing-why">
          <div className="landing-wrap">
            <p className="landing-features-eyebrow">Why kernel-native</p>
            <h2 className="landing-why-headline">Observability from the OS up.</h2>
            <p className="landing-why-lede">eBPF in the kernel — not agents in every pod.</p>
            <div className="landing-why-grid">
              {WHY_KERNEL.map((item, index) => (
                <article
                  key={item.title}
                  className={`landing-why-card${index % 2 === 1 ? " landing-why-card-offset" : ""}`}
                  style={{ animationDelay: `${index * 0.55}s` }}
                >
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="product" className="landing-product">
          <div className="landing-wrap landing-product-wrap">
            <ProductMockup />
          </div>
        </section>

        <section id="features" className="landing-features">
          <div className="landing-wrap">
            <p className="landing-features-eyebrow">Capabilities</p>
            <h2 className="landing-section-headline">From kernel events to a live console.</h2>
            <p className="landing-section-lede">
              Topology, talk events, alerts, and node profiles — built from the same kernel-level
              telemetry stream.
            </p>
            <FeaturesSection features={FEATURES} />
          </div>
        </section>

        <section id="events" className="landing-events">
          <div className="landing-wrap landing-events-grid">
            <div className="landing-events-copy">
              <p className="landing-features-eyebrow">Events</p>
              <h2>Hear when services talk.</h2>
              <p className="landing-events-tagline">
                Kernel flow events as paths open, slow down, or drop — connections, timeouts, and
                retransmits in one live stream, with no manual instrumentation.
              </p>
            </div>
            <TalkEventsPreview />
          </div>
        </section>

        <section id="profiling" className="landing-profiling">
          <div className="landing-wrap landing-profiling-grid">
            <div className="landing-profiling-copy">
              <p className="landing-features-eyebrow">Profiling</p>
              <h2>Kernel-level profiling.</h2>
              <p className="landing-profiling-tagline">
                CPU, memory, network, and scheduler activity per node — syscall and stack visibility
                without SSH or a profiler sidecar.
              </p>
            </div>
            <ProfilingPreview />
          </div>
        </section>

        <section id="install" className="landing-cta">
          <div className="landing-wrap landing-cta-grid">
            <div className="landing-cta-copy">
              <h2>Deploy on your infrastructure</h2>
              <p>
                Run KERN like Grafana or Elastic — on a laptop, VM, or Kubernetes cluster. One
                install command brings up the console and agent; sign in with the admin password you
                set during setup.
              </p>
              <div className="landing-cta-actions">
                <a href={INSTALL_DOCS} target="_blank" rel="noreferrer" className="landing-btn landing-btn-primary">
                  Install KERN
                  <ArrowIcon />
                </a>
                <a
                  href={`${GITHUB_REPO}#readme`}
                  target="_blank"
                  rel="noreferrer"
                  className="landing-btn landing-btn-secondary"
                >
                  Read docs
                </a>
              </div>
            </div>
            <ConnectClusterFlow />
          </div>
        </section>

        <section className="landing-star" aria-label="Star on GitHub">
          <div className="landing-wrap landing-star-inner">
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="landing-star-link"
            >
              <StarIcon />
              Star KERN on GitHub
            </a>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-wrap">
          <div className="landing-footer-grid">
            <div className="landing-footer-brand-col">
              <div className="landing-footer-brand">
                <KernWordmark />
              </div>
              <p className="landing-footer-blurb">
                Kernel-native observability for Kubernetes. eBPF telemetry, local or S3 storage, zero
                instrumentation.
              </p>
            </div>

            <div className="landing-footer-col">
              <span className="landing-footer-heading">Product</span>
              {PRODUCT_LINKS.map((item) =>
                item.href.startsWith("/") ? (
                  <Link key={item.label} to={item.href}>
                    {item.label}
                  </Link>
                ) : (
                  <a key={item.label} href={item.href} target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                ),
              )}
            </div>

            <div className="landing-footer-col">
              <span className="landing-footer-heading">Resources</span>
              <a href={`${GITHUB_REPO}#quick-start`} target="_blank" rel="noreferrer">
                Quick start
              </a>
              <a href={`${GITHUB_REPO}#readme`} target="_blank" rel="noreferrer">
                Docs
              </a>
              <a href={`${GITHUB_REPO}/blob/main/docs/ROADMAP.md`} target="_blank" rel="noreferrer">
                Roadmap
              </a>
            </div>
          </div>

          <div className="landing-footer-bottom">
            <p className="landing-footer-copy">© {new Date().getFullYear()} KERN</p>
            <div className="landing-footer-social">
              <a href={GITHUB_REPO} target="_blank" rel="noreferrer" aria-label="GitHub">
                <GitHubIcon />
              </a>
              <a href={DISCORD_URL} target="_blank" rel="noreferrer" aria-label="Discord">
                <DiscordIcon />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
