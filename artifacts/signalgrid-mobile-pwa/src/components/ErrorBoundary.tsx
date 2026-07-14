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
 * mobile surface degrades gracefully rather than crashing on a shared device.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("SignalGrid mobile error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-[100dvh] w-full bg-background text-foreground p-8 text-center">
          <div className="text-xs font-mono uppercase tracking-wide text-primary mb-3">
            SignalGrid
          </div>
          <h1 className="text-lg font-semibold mb-2">This view couldn&apos;t load</h1>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs">
            The app hit an unexpected error — often a backend that isn&apos;t
            reachable. Your data is safe; try again once the connection returns.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium active:scale-95 transition-transform"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
