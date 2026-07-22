import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

/** Keeps AppShell visible when a page throws — solid black was an uncaught render crash. */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(this.props.fallbackTitle ?? "Page error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page-error-boundary panel">
          <h2>{this.props.fallbackTitle ?? "Something went wrong"}</h2>
          <p className="page-error-boundary-message">{this.state.error.message}</p>
          <button
            type="button"
            className="page-error-boundary-retry"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
