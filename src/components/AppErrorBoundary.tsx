import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  errorMessage: string;
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    errorMessage: '',
    hasError: false,
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : 'Unexpected application error',
      hasError: true,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('Web Xiangqi render error', error, info.componentStack);
    }
  }

  private reloadApp = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main
        className="app-error-fallback"
        role="alert"
        aria-labelledby="app-error-title"
        aria-describedby="app-error-message"
      >
        <div className="app-error-mark" aria-hidden="true">XQ</div>
        <p className="app-error-brand">Web Xiangqi</p>
        <h1 id="app-error-title">Something interrupted the board</h1>
        <p id="app-error-message">
          Reload the app to recover the analysis board.
        </p>
        <button type="button" onClick={this.reloadApp}>
          Reload App
        </button>
        {import.meta.env.DEV && this.state.errorMessage ? (
          <code>{this.state.errorMessage}</code>
        ) : null}
      </main>
    );
  }
}
