import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[velo] Unhandled UI error:", error);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-4">
          <h2 className="font-serif-display text-2xl text-chalk">
            Something went wrong
          </h2>
          <p className="text-sm text-chalk/70">
            The interface hit an unexpected error. Try again, or reload the page.
          </p>
          <pre className="text-[10px] text-destructive/80 font-mono whitespace-pre-wrap text-left max-h-40 overflow-auto">
            {this.state.error.message}
          </pre>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={this.reset}
              className="px-4 py-2 bg-amber hover:bg-amber-soft text-ink font-semibold rounded-sm text-sm"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 border border-border text-chalk/80 hover:bg-border rounded-sm text-sm"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
