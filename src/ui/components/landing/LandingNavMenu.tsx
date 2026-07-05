import { createContext, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

export interface LandingNavItem {
  label: string;
  href: string;
}

interface NavMenuContextValue {
  openLabel: string | null;
  setOpenLabel: (label: string | null) => void;
}

const NavMenuContext = createContext<NavMenuContextValue | null>(null);

export function LandingNavMenuGroup({ children }: { children: ReactNode }) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);

  return (
    <NavMenuContext.Provider value={{ openLabel, setOpenLabel }}>{children}</NavMenuContext.Provider>
  );
}

export function LandingNavMenu({ label, items }: { label: string; items: readonly LandingNavItem[] }) {
  const menu = useContext(NavMenuContext);
  const isOpen = menu?.openLabel === label;

  const open = () => menu?.setOpenLabel(label);
  const close = () => {
    if (menu?.openLabel === label) {
      menu.setOpenLabel(null);
    }
  };

  const toggle = () => menu?.setOpenLabel(isOpen ? null : label);

  return (
    <div
      className={`landing-nav-menu${isOpen ? " is-open" : ""}`}
      onMouseEnter={open}
      onMouseLeave={close}
    >
      <button
        type="button"
        className="landing-nav-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        {label}
        <svg viewBox="0 0 12 12" aria-hidden className="landing-nav-menu-chevron">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <div className="landing-nav-menu-panel" role="menu">
        {items.map((item) =>
          item.href.startsWith("/") ? (
            <Link key={item.label} to={item.href} className="landing-nav-menu-link" role="menuitem">
              {item.label}
            </Link>
          ) : (
            <a
              key={item.label}
              href={item.href}
              className="landing-nav-menu-link"
              role="menuitem"
              {...(item.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              {item.label}
            </a>
          ),
        )}
      </div>
    </div>
  );
}
