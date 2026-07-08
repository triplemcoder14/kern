import { Link } from "react-router-dom";
import {
  ConnectClusterFlow,
  FeaturesSection,
  FooterManifesto,
  HeroIsometric,
  ProductMockup,
  ProfilingPreview,
  TalkEventsPreview,
  type LandingFeature,
} from "../components/landing/LandingGraphics";
import { GitHubStarButton } from "../components/landing/GitHubStarButton";
import { PlatformBubbles } from "../components/landing/PlatformBubbles";
import { LandingNavMenu, LandingNavMenuGroup } from "../components/landing/LandingNavMenu";
import { KernWordmark } from "../components/KernWordmark";

const GITHUB_REPO = "https://github.com/triplemcoder14/kern";
const INSTALL_DOCS = `${GITHUB_REPO}/blob/main/docs/INSTALL.md`;
const DISCORD_URL = "https://discord.gg/kern";

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
    body: "No code changes. TCP paths and pod context from the node — no agents in every pod.",
  },
  {
    title: "Minimal overhead",
    body: "One DaemonSet per node reads /proc and optional eBPF or Cilium Hubble — not a sidecar mesh.",
  },
  {
    title: "Deep visibility",
    body: "Connections, latency, drops, CPU, memory pressure, and kernel stacks at the source.",
  },
  {
    title: "End-to-end context",
    body: "Pod → service → pod paths enriched from Kubernetes and correlated in one console.",
  },
] as const;

const FEATURES: readonly LandingFeature[] = [
  {
    id: "topology",
    label: "Topology",
    body: "Live service map from enriched flows — see pod-to-service paths as your cluster shifts.",
    accent: "ok",
  },
  {
    id: "flows",
    label: "Flows",
    body: "Every connection with protocol, port, latency, and verdict — filterable in one table.",
    accent: "line",
  },
  {
    id: "alerts",
    label: "Alerts",
    body: "Path-level incidents tied to real traffic — latency, drops, silence, and spikes.",
    accent: "warn",
  },
  {
    id: "workloads",
    label: "Workloads & network",
    body: "Pod health at a glance plus a network board for drops, timeouts, and slow paths.",
    accent: "line",
  },
  {
    id: "profiling",
    label: "Node profiling",
    body: "PSI, memory pressure, top pods, kernel stacks, and a pressure timeline per node.",
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

const FOOTER_LINKS = [
  { label: "Install", href: INSTALL_DOCS },
  { label: "Roadmap", href: `${GITHUB_REPO}/blob/main/docs/ROADMAP.md` },
  { label: "Docs", href: INSTALL_DOCS },
  { label: "Contributing", href: `${GITHUB_REPO}/blob/main/docs/CONTRIBUTING.md` },
  { label: "Agent", href: `${GITHUB_REPO}/tree/main/agent` },
  { label: "API", href: `${GITHUB_REPO}/tree/main/api` },
  { label: "License", href: `${GITHUB_REPO}/blob/main/LICENSE` },
] as const;

const FOOTER_PLATFORMS = [
  "On-prem",
  "Kubernetes",
  "Docker",
  "Linux",
  "Helm",
  "MinIO",
  "AWS S3",
  "Cloudflare R2",
] as const;

const FOOTER_SOCIALS = [
  { label: "GitHub", href: GITHUB_REPO },
  { label: "Discord", href: DISCORD_URL },
] as const;

const PRODUCT_NAV = PRODUCT_LINKS;

const FEATURE_NAV = [
  { label: "Topology", href: "#feature-topology" },
  { label: "Flows", href: "#feature-flows" },
  { label: "Talk events", href: "#events" },
  { label: "Alerts", href: "#feature-alerts" },
  { label: "Workloads", href: "#feature-workloads" },
  { label: "Profiling", href: "#profiling" },
  { label: "Storage", href: "#feature-storage" },
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
            <a href={`${GITHUB_REPO}/blob/main/docs/INSTALL.md`} target="_blank" rel="noreferrer">
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
              <h1 className="landing-headline">See what talks to what in Kubernetes.</h1>
              <p className="landing-lede">
                Self-hosted, open source observability — live topology, flow events, path alerts, and
                node profiling from the kernel up. No SaaS. No instrumentation.
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
            <p className="landing-why-lede">Node-level visibility — /proc by default, eBPF or Hubble where available.</p>
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
            <h2 className="landing-section-headline">From kernel flows to a live console.</h2>
            <p className="landing-section-lede">
              Topology, talk events, alerts, workloads, and node profiles — one self-hosted stack on
              your infrastructure.
            </p>
            <FeaturesSection features={FEATURES} />
          </div>
        </section>

        <section id="events" className="landing-events">
          <div className="landing-wrap landing-events-grid">
            <div className="landing-events-copy">
              <p className="landing-features-eyebrow">Talk events</p>
              <h2>Hear when services talk.</h2>
              <p className="landing-events-tagline">
                Flow events as paths open, slow down, or drop — latency, timeouts, and verdicts in one
                live stream, enriched with pod and service names.
              </p>
            </div>
            <TalkEventsPreview />
          </div>
        </section>

        <section id="profiling" className="landing-profiling">
          <div className="landing-wrap landing-profiling-grid">
            <div className="landing-profiling-copy">
              <p className="landing-features-eyebrow">Profiling</p>
              <h2>Node-level profiling.</h2>
              <p className="landing-profiling-tagline">
                PSI, memory pressure, top pods, kernel stack frames, and a pressure timeline per node
                — without SSH or a profiler sidecar.
              </p>
            </div>
            <ProfilingPreview />
          </div>
        </section>

        <section id="install" className="landing-cta">
          <PlatformBubbles />
          <div className="landing-wrap landing-cta-grid landing-cta-content">
            <div className="landing-cta-copy">
              <h2>Deploy on your infrastructure</h2>
              <p>Apache 2.0 and fully self-hosted</p>
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

        <section className="landing-founder" aria-label="About the creator">
          <div className="landing-wrap landing-founder-inner">
            <blockquote className="landing-founder-quote">
              I build systems that measure, profile, and optimize production workloads, from kernel
              instrumentation to low-latency telemetry pipelines and high-cardinality storage. My
              experience spans Interswitch and now MTN.
            </blockquote>
            <div className="landing-founder-meta">
              <img
                className="landing-founder-avatar"
                src="/founder.jpg"
                alt="Muutassim Mukhtar"
                width={48}
                height={48}
              />
              <div className="landing-founder-id">
                <span className="landing-founder-name">Muutassim Mukhtar</span>
                <span className="landing-founder-role">Creator</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-star" aria-label="Star on GitHub">
          <div className="landing-wrap landing-star-inner">
            <GitHubStarButton />
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-wrap">
          <div className="landing-footer-grid">
            <FooterManifesto />

            <div className="landing-footer-nav">
              <div className="landing-footer-nav-brand">
                <KernWordmark />
              </div>

              <div className="landing-footer-columns">
                <div className="landing-footer-col">
                  <span className="landing-footer-heading">Links</span>
                  {FOOTER_LINKS.map((item) => (
                    <a key={item.label} href={item.href} target="_blank" rel="noreferrer">
                      {item.label}
                    </a>
                  ))}
                </div>

                <div className="landing-footer-col">
                  <span className="landing-footer-heading">Platforms</span>
                  {FOOTER_PLATFORMS.map((platform) => (
                    <span key={platform} className="landing-footer-platform">
                      {platform}
                    </span>
                  ))}
                </div>

                <div className="landing-footer-col">
                  <span className="landing-footer-heading">Socials</span>
                  {FOOTER_SOCIALS.map((item) => (
                    <a key={item.label} href={item.href} target="_blank" rel="noreferrer">
                      {item.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="landing-footer-bottom">
            <p className="landing-footer-copy">© {new Date().getFullYear()} KERN</p>
            <p className="landing-footer-meta">Apache 2.0 · Open source</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
