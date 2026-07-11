import { useState, type ReactElement, type ReactNode, type SVGProps } from "react";
import type { AuthUser } from "../../lib/auth-api";
import { getCloudNav, type CloudNavItem } from "@kern/platform";
import { KernWordmark } from "./KernWordmark";

export type CoreNavPage =
  | "overview"
  | "topology"
  | "flows"
  | "workloads"
  | "network"
  | "profiling"
  | "alerts"
  | "events"
  | "settings";

export type NavPage = CoreNavPage | string;
export type NavId = CoreNavPage | string;

interface AppShellProps {
  activeNav: NavId;
  onNavigate: (nav: NavId, page: NavPage) => void;
  connected: boolean;
  alertCount: number;
  soundMuted?: boolean;
  onSoundMutedChange?: (muted: boolean) => void;
  user?: AuthUser | null;
  onLogout?: () => Promise<void>;
  children: ReactNode;
  footer?: ReactNode;
}

interface NavItem {
  id: NavId;
  page: NavPage;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => ReactElement;
}

function cloudNavToItem(item: CloudNavItem): NavItem {
  return {
    id: item.id,
    page: item.page,
    label: item.label,
    Icon: item.Icon as NavItem["Icon"],
  };
}

function IconOverview(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconTopology(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4" cy="5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="16" cy="5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4" cy="15" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="16" cy="15" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.6 6.2 8.2 8.6M14.4 6.2 11.8 8.6M5.6 13.8 8.2 11.4M14.4 13.8 11.8 11.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconFlows(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <path d="M3 10h10M11 10l-3-3M11 10l-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13 6h4M13 10h4M13 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

function IconNetwork(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <circle cx="5" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="15" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="15" cy="15" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 9.2 12.6 6.1M7 10.8l5.6 3.1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconWorkloads(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <rect x="3" y="4" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 14V9.5l2.5 2 2-1.5 2.5 2V14" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function IconAlerts(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <path
        d="M10 3a5.5 5.5 0 0 1 5.5 5.5c0 4.2 1.5 5.5 1.5 5.5H3.5S5 12.7 5 8.5A5.5 5.5 0 0 1 10 3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8.2 15.5a1.8 1.8 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconEvents(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <path d="M4 5h12M4 10h8M4 15h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconSound(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <path
        d="M4 8.5h2.5L9 5.5v9L6.5 11.5H4a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 7.5a4 4 0 0 1 0 5M13.5 5.5a7 7 0 0 1 0 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLogout(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <path
        d="M7.5 3.5H5.5A1.5 1.5 0 0 0 4 5v10a1.5 1.5 0 0 0 1.5 1.5h2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M8.5 10h7M13 7l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconProfiling(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <path d="M4 15V8l3 4 2-3 3 6 4-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 2.5v2M10 15.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M5.4 14.6l1.4-1.4M13.2 6.8l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const PRIMARY_NAV: NavItem[] = [
  { id: "overview", page: "overview", label: "Overview", Icon: IconOverview },
  { id: "topology", page: "topology", label: "Topology", Icon: IconTopology },
  { id: "flows", page: "flows", label: "Flows", Icon: IconFlows },
  { id: "workloads", page: "workloads", label: "Workloads", Icon: IconWorkloads },
  { id: "network", page: "network", label: "Network", Icon: IconNetwork },
  { id: "profiling", page: "profiling", label: "Profiling", Icon: IconProfiling },
  { id: "alerts", page: "alerts", label: "Alerts", Icon: IconAlerts },
  { id: "events", page: "events", label: "Events", Icon: IconEvents },
];

const SECONDARY_NAV: NavItem[] = [
  { id: "settings", page: "settings", label: "Settings", Icon: IconSettings },
];

export function AppShell({
  activeNav,
  onNavigate,
  connected,
  alertCount,
  soundMuted = false,
  onSoundMutedChange,
  user,
  onLogout,
  children,
  footer,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const userInitial = user?.name.slice(0, 1).toUpperCase() ?? "?";
  const cloudItems = getCloudNav();
  const cloudNav = cloudItems.map(cloudNavToItem);

  const handleLogout = () => {
    if (!onLogout) {
      return;
    }
    void onLogout().then(() => {
      window.location.href = "/login";
    });
  };

  const renderNavItem = (item: NavItem, accent?: "promo") => {
    const isActive = activeNav === item.id;
    const showBadge = item.id === "alerts" && alertCount > 0;
    return (
      <button
        key={item.id}
        type="button"
        className={`shell-nav-item${isActive ? " active" : ""}${accent === "promo" ? " shell-nav-item-promo" : ""}`}
        onClick={() => onNavigate(item.id, item.page)}
        title={collapsed ? item.label : undefined}
      >
        <span className="shell-nav-icon">
          <item.Icon className="shell-nav-svg" />
        </span>
        {!collapsed ? <span className="shell-nav-label">{item.label}</span> : null}
        {showBadge && !collapsed ? <span className="shell-nav-badge">{alertCount}</span> : null}
        {showBadge && collapsed ? <span className="shell-nav-badge-dot">{alertCount}</span> : null}
      </button>
    );
  };

  return (
    <div className={`shell ${collapsed ? "shell-collapsed" : ""}`}>
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <KernWordmark className="shell-wordmark" showText={!collapsed} />
          <button
            type="button"
            className="shell-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        <nav className="shell-nav shell-nav-primary">
          {PRIMARY_NAV.map((item) => renderNavItem(item))}
        </nav>

        {cloudNav.length > 0 ? (
          <nav className="shell-nav shell-nav-cloud" aria-label="Kern K8s Runner">
            {!collapsed ? <div className="shell-nav-section">K8s Runner</div> : null}
            {cloudItems.map((source) => {
              const item = cloudNav.find((entry) => entry.id === source.id);
              return item ? renderNavItem(item, source.accent) : null;
            })}
          </nav>
        ) : null}

        <nav className="shell-nav shell-nav-secondary">{SECONDARY_NAV.map((item) => renderNavItem(item))}</nav>

        <div className="shell-sidebar-foot">
          <div className="shell-account">
            <div className="shell-user-avatar">{userInitial}</div>

            {!collapsed ? (
              <div className="shell-account-meta">
                <div className="shell-user-name">{user?.name ?? "Signed in"}</div>
                <div className="shell-account-sub">
                  <span className="shell-user-role">{user?.username ?? "Account"}</span>
                  <span className="shell-account-sep" aria-hidden>
                    ·
                  </span>
                  <span className="shell-account-status">
                    <span className={`shell-status-dot ${connected ? "on" : ""}`} />
                    {connected ? "Connected" : "Offline"}
                  </span>
                </div>
              </div>
            ) : (
              <span className={`shell-status-dot shell-account-dot ${connected ? "on" : ""}`} />
            )}

            {onSoundMutedChange ? (
              <button
                type="button"
                className={`shell-account-sound${soundMuted ? " muted" : " on"}`}
                onClick={() => onSoundMutedChange(!soundMuted)}
                aria-label={soundMuted ? "Unmute talk sounds" : "Mute talk sounds"}
                title={
                  soundMuted
                    ? "Unmute live pod ↔ service talk sounds"
                    : "Mute live pod ↔ service talk sounds"
                }
              >
                <IconSound className="shell-nav-svg" />
              </button>
            ) : null}

            {onLogout ? (
              <button
                type="button"
                className="shell-account-logout"
                onClick={handleLogout}
                aria-label="Sign out"
                title="Sign out"
              >
                <IconLogout className="shell-nav-svg" />
              </button>
            ) : null}
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <div className="shell-content">{children}</div>
        {footer ? <div className="shell-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
