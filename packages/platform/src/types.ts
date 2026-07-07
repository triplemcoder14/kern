import type { ComponentType, ReactNode, SVGProps } from "react";

export type CloudNavId = string;
export type CloudPageId = string;

export interface CloudNavItem {
  id: CloudNavId;
  page: CloudPageId;
  label: string;
  /** Sidebar group label — items with the same section render together */
  section: "runner" | "account";
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Promo items get accent styling in the sidebar */
  accent?: "promo";
}

export interface CloudPageProps {
  user?: {
    name: string;
    email?: string;
    provider?: string;
  } | null;
  onNavigate?: (page: CloudPageId) => void;
}

export interface CloudExtensions {
  isCloudEnabled: () => boolean;
  getCloudNav: () => CloudNavItem[];
  renderCloudPage: (page: CloudPageId, props: CloudPageProps) => ReactNode | null;
}
