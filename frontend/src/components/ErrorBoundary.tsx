import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportBug } from '../lib/bugReporter';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

// React's error boundary lifecycle is class-component only; this is the one
// place in the app where we still need a class.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message || 'Something went wrong.' };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    void reportBug({
      exception_type: err.name || 'ReactError',
      message: err.message || 'React error boundary',
      // componentStack pinpoints the offending tree path; append it to the
      // raw JS stack so the backend fingerprint can use either.
      stack: [err.stack, info.componentStack].filter(Boolean).join('\n'),
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="error-boundary">
        <h2>Something broke.</h2>
        <p>{this.state.message}</p>
        <p className="hint">The error has been reported. Reloading usually clears it.</p>
        <button type="button" className="btn" onClick={this.handleReload}>
          Reload
        </button>
      </div>
    );
  }
}
