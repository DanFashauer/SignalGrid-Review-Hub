import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * App-wide error boundary. A render error (e.g. an unexpected API response
 * shape) shows a calm, on-brand message instead of a blank white screen, so the
 * control plane degrades gracefully rather than crashing.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("SignalGrid UI error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <div className="text-sm font-mono uppercase tracking-wide text-primary mb-3">
              SignalGrid
            </div>
            <h1 className="text-xl font-semibold mb-2">This view couldn&apos;t load</h1>
            <p className="text-sm text-muted-foreground mb-6">
              The console hit an unexpected error — often a backend that isn&apos;t
              reachable. Your data is safe; try again once the API is available.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
