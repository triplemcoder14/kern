/** UI + runtime namespace scope. "all" = cluster-wide (slower); otherwise a single namespace. */
export const ALL_NAMESPACES = "all";

export type MonitorNamespaceScope = typeof ALL_NAMESPACES | string;

export function resolveK8sNamespace(scope: MonitorNamespaceScope): string | undefined {
  return scope === ALL_NAMESPACES ? undefined : scope;
}

/** Slower refresh when listing the whole cluster; fast when scoped to one namespace. */
export function pollIntervalMs(scope: MonitorNamespaceScope, scopedMs: number, allMs: number): number {
  return scope === ALL_NAMESPACES ? allMs : scopedMs;
}
