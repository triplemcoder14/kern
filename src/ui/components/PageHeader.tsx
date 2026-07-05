import { type ReactNode } from "react";
import { PageContextBar } from "./PageContextBar";

interface PageHeaderProps {
  title: string;
  subtitle: string;
  clusterName: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (value: string) => void;
  connected: boolean;
  showWindow?: boolean;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  clusterName,
  namespace,
  namespaces,
  onNamespaceChange,
  connected,
  showWindow = false,
  actions,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <h1 className="events-title">{title}</h1>
        <p className="events-sub">{subtitle}</p>
      </div>
      <div className="page-header-side">
        <PageContextBar
          clusterName={clusterName}
          namespace={namespace}
          namespaces={namespaces}
          onNamespaceChange={onNamespaceChange}
          connected={connected}
          showWindow={showWindow}
        />
        {actions ? <div className="events-toolbar">{actions}</div> : null}
      </div>
    </header>
  );
}
