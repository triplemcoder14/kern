import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type SVGProps,
} from "react";
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
  /** Live agent / eBPF status for the SYSTEM panel. */
  agentConnected?: boolean;
  ebpfMode?: string;
  programsAttached?: number;
  flowsPerSecond?: number;
  ebpfConnected?: boolean;
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
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

// function IconNetwork(props: SVGProps<SVGSVGElement>) {
//   return (
//     <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
//       <circle cx="5" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
//       <circle cx="15" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
//       <circle cx="15" cy="15" r="2.2" stroke="currentColor" strokeWidth="1.4" />
//       <path d="M7 9.2 12.6 6.1M7 10.8l5.6 3.1" stroke="currentColor" strokeWidth="1.4" />
//     </svg>
//   );
// }
function IconNetwork(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <path
        d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6L10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 8.2V4.8M11.6 11l3.2 1.8M8.4 11 5.2 12.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// function IconWorkloads(props: SVGProps<SVGSVGElement>) {
//   return (
//     <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
//       <rect x="3" y="4" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
//       <path d="M6 14V9.5l2.5 2 2-1.5 2.5 2V14" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
//     </svg>
//   );
// }
function IconWorkloads(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <path
        d="M10 2.8 16.2 6.2v7.6L10 17.2 3.8 13.8V6.2L10 2.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M10 10v7.2M10 10 16.2 6.2M10 10 3.8 6.2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
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

// function IconEvents(props: SVGProps<SVGSVGElement>) {
//   return (
//     <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
//       <path d="M4 5h12M4 10h8M4 15h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
//     </svg>
//   );
// }
function IconEvents(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <rect x="3" y="3.5" width="14" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 8h.01M8.5 8H14M6 12h.01M8.5 12H12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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

// function IconProfiling(props: SVGProps<SVGSVGElement>) {
//   return (
//     <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
//       <path d="M4 15V8l3 4 2-3 3 6 4-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
//       <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
//     </svg>
//   );
// }
function IconProfiling(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden {...props}>
      <path
        d="M10 16.5c2.2-2.2 5.5-3.4 5.5-7.2A4.2 4.2 0 0 0 10 5.2 4.2 4.2 0 0 0 4.5 9.3c0 3.8 3.3 5 5.5 7.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M10 12.2c.9-.8 2-1.3 2-2.6A1.8 1.8 0 0 0 10 7.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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

// const PRIMARY_NAV: NavItem[] = [
//   { id: "overview", page: "overview", label: "Overview", Icon: IconOverview },
//   { id: "network", page: "network", label: "Network", Icon: IconNetwork },
//   { id: "workloads", page: "workloads", label: "Workloads", Icon: IconWorkloads },
//   { id: "profiling", page: "profiling", label: "Profiling", Icon: IconProfiling },
//   { id: "alerts", page: "alerts", label: "Alerts", Icon: IconAlerts },
//   { id: "events", page: "events", label: "Events", Icon: IconEvents },
// ];

const OBSERVE_NAV: NavItem[] = [
  { id: "overview", page: "overview", label: "Overview", Icon: IconOverview },
  { id: "network", page: "network", label: "Network", Icon: IconNetwork },
  { id: "workloads", page: "workloads", label: "Workloads", Icon: IconWorkloads },
  { id: "profiling", page: "profiling", label: "Profiling", Icon: IconProfiling },
];

const INVESTIGATE_NAV: NavItem[] = [
  { id: "alerts", page: "alerts", label: "Alerts", Icon: IconAlerts },
  { id: "events", page: "events", label: "Events", Icon: IconEvents },
];

// const SECONDARY_NAV: NavItem[] = [
//   { id: "settings", page: "settings", label: "Settings", Icon: IconSettings },
// ];

const SETTINGS_ITEM: NavItem = {
  id: "settings",
  page: "settings",
  label: "Settings",
  Icon: IconSettings,
};

function isEbpfActive(mode?: string, ebpfConnected?: boolean, agentConnected?: boolean): boolean {
  if (ebpfConnected) {
    return true;
  }
  if (!agentConnected || !mode) {
    return false;
  }
  return mode.toLowerCase().includes("ebpf");
}

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
  agentConnected,
  ebpfMode,
  programsAttached,
  flowsPerSecond,
  ebpfConnected,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const userInitial = user?.name.slice(0, 1).toUpperCase() ?? "?";
  const cloudItems = getCloudNav();
  const cloudNav = cloudItems.map(cloudNavToItem);

  const agentOk = agentConnected ?? connected;
  const ebpfOk = isEbpfActive(ebpfMode, ebpfConnected, agentOk);
  const programs = programsAttached ?? 0;
  const fps = flowsPerSecond ?? 0;
  const systemTip = agentOk
    ? `Agent connected · ${ebpfOk ? "eBPF active" : "eBPF inactive"} · ${programs} programs · ${fps} flows/s`
    : "Agent offline";

  // const toggleCollapsed = () => {
  //   setCollapsed((value) => {
  //     const next = !value;
  //     // After collapsing, ignore hover-expand until the pointer leaves the sidebar
  //     // (otherwise the click target keeps :hover and undoes the collapse).
  //     if (next) {
  //       setHoverExpandReady(false);
  //     }
  //     return next;
  //   });
  // };
  const toggleCollapsed = () => {
    setCollapsed((value) => !value);
  };

  useEffect(() => {
    if (!accountOpen) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  const handleLogout = () => {
    if (!onLogout) {
      return;
    }
    setAccountOpen(false);
    void onLogout().then(() => {
      window.location.href = "/login";
    });
  };

  const renderNavItem = (item: NavItem, accent?: "promo") => {
    const isActive = activeNav === item.id;
    const showBadge = item.id === "alerts" && alertCount > 0;
    // Network live dot removed — health stays in the SYSTEM panel only.
    // const showLive = item.id === "network" && ebpfOk;
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
        <span className="shell-nav-label">{item.label}</span>
        {showBadge ? <span className="shell-nav-badge">{alertCount}</span> : null}
        {showBadge ? <span className="shell-nav-badge-dot">{alertCount}</span> : null}
      </button>
    );
  };

  const renderNavGroup = (label: string, items: NavItem[]) => (
    <nav className="shell-nav" aria-label={label}>
      <div className="shell-nav-section">{label}</div>
      {items.map((item) => renderNavItem(item))}
    </nav>
  );

  return (
    <div className={`shell${collapsed ? " shell-collapsed" : ""}`}>
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <KernWordmark className="shell-wordmark" showText />
          <button
            type="button"
            className="shell-collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        <div className="shell-nav-scroll">
          {renderNavGroup("Observe", OBSERVE_NAV)}

          {cloudNav.length > 0 ? (
            <nav className="shell-nav shell-nav-cloud" aria-label="Kern K8s Runner">
              <div className="shell-nav-section">K8s Runner</div>
              {cloudItems.map((source) => {
                const item = cloudNav.find((entry) => entry.id === source.id);
                return item ? renderNavItem(item, source.accent) : null;
              })}
            </nav>
          ) : null}

          {renderNavGroup("Investigate", INVESTIGATE_NAV)}

          <div className="shell-sidebar-system" title={collapsed ? systemTip : undefined}>
            <div className="shell-nav-section">System</div>
            <div className="shell-system-row">
              <span className={`shell-status-dot ${agentOk ? "on" : ""}`} />
              <span>{agentOk ? "Agent Connected" : "Agent Offline"}</span>
            </div>
            <div className="shell-system-row">
              <span className={`shell-status-dot ${ebpfOk ? "on" : ""}`} />
              <span>{ebpfOk ? "eBPF Active" : "eBPF Inactive"}</span>
            </div>
            <div className="shell-system-meta">
              <span>{programs} Programs</span>
              <span>{fps} Flows/s</span>
            </div>
            <span className={`shell-status-dot shell-system-collapsed-dot ${agentOk && ebpfOk ? "on" : ""}`} />
          </div>
        </div>

        <div className="shell-sidebar-bottom">
          <div className="shell-sidebar-tools">
            <button
              type="button"
              className={`shell-tool-btn${activeNav === SETTINGS_ITEM.id ? " active" : ""}`}
              onClick={() => onNavigate(SETTINGS_ITEM.id, SETTINGS_ITEM.page)}
              title="Settings"
              aria-label="Settings"
            >
              <IconSettings className="shell-nav-svg" />
            </button>
          </div>

          <div className="shell-sidebar-foot">
            <div className="shell-account shell-account-compact" ref={accountRef}>
              <button
                type="button"
                className="shell-account-trigger"
                onClick={() => setAccountOpen((open) => !open)}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                title={user?.name ?? "Account"}
              >
                <span className="shell-user-avatar">{userInitial}</span>
                <span className="shell-account-trigger-meta">
                  <span className="shell-user-name">{user?.name ?? "Signed in"}</span>
                  <span className="shell-user-role">
                    {user?.username ? `${user.username}` : "Account"}
                  </span>
                </span>
              </button>

              {accountOpen ? (
                <div className="shell-account-popover" role="menu">
                  <div className="shell-account-popover-head">
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
                  <div className="shell-account-popover-actions">
                    {onSoundMutedChange ? (
                      <button
                        type="button"
                        className={`shell-account-menu-btn${soundMuted ? " muted" : ""}`}
                        onClick={() => onSoundMutedChange(!soundMuted)}
                        role="menuitem"
                      >
                        <IconSound className="shell-nav-svg" />
                        <span>{soundMuted ? "Unmute talk sounds" : "Mute talk sounds"}</span>
                      </button>
                    ) : null}
                    {onLogout ? (
                      <button
                        type="button"
                        className="shell-account-menu-btn"
                        onClick={handleLogout}
                        role="menuitem"
                      >
                        <IconLogout className="shell-nav-svg" />
                        <span>Sign out</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
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
