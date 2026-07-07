import type { CloudExtensions, CloudNavItem, CloudPageId, CloudPageProps } from "./types";

/** OSS default — no cloud extensions in the open-source console. */
export function isCloudEnabled(): boolean {
  return false;
}

export function getCloudNav(): CloudNavItem[] {
  return [];
}

export function renderCloudPage(_page: CloudPageId, _props: CloudPageProps) {
  return null;
}

export const cloudExtensions: CloudExtensions = {
  isCloudEnabled,
  getCloudNav,
  renderCloudPage,
};
