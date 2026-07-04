import type { ReactNode } from "react";

export type NavPage = "events" | "network" | "settings" | "simulation";

interface AppShellProps {
  active: NavPage;
  onNavigate: (page: NavPage) => void;
  connected: boolean;
  alertCount: number;
  children: ReactNode;
  footer?: ReactNode;
}

const NAV_ITEMS: Array<{ id: NavPage; label: string; icon: string }> = [
  { id: "events", label: "Events", icon: "◉" },
  { id: "network", label: "Network", icon: "◎" },
  { id: "simulation", label: "YAML", icon: "▣" },
];

export function AppShell({
  active,
  onNavigate,
  connected,
  alertCount,
  children,
  footer,
}: AppShellProps) {
  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <span className="shell-logo">◆</span>
          <div>
            <div className="shell-title">PORT-OF-K8S</div>
            <div className="shell-beta">BETA</div>
          </div>
        </div>

        <nav className="shell-nav">
          <div className="shell-nav-group">MONITOR</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`shell-nav-item ${active === item.id ? "active" : ""}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="shell-nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="shell-nav">
          <div className="shell-nav-group">SYSTEM</div>
          <button
            type="button"
            className={`shell-nav-item ${active === "settings" ? "active" : ""}`}
            onClick={() => onNavigate("settings")}
          >
            <span className="shell-nav-icon">⚙</span>
            Settings
          </button>
        </div>

        <div className="shell-status">
          <div className={`shell-status-dot ${connected ? "on" : ""}`} />
          <span>{connected ? "CONNECTED" : "OFFLINE"}</span>
          {alertCount > 0 ? <span className="shell-badge">{alertCount}</span> : null}
        </div>
      </aside>

      <div className="shell-main">
        <div className="shell-content">{children}</div>
        {footer ? <div className="shell-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
