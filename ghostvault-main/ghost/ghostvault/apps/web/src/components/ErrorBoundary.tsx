import { Component, ErrorInfo, ReactNode, memo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundaryClass extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Update state with error info
    this.setState({ errorInfo });
  }

  override render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex items-center justify-center min-h-screen bg-void p-4">
            <div className="text-center max-w-2xl">
              <h1 className="font-display text-2xl text-danger mb-4">Er is een fout opgetreden</h1>
              <p className="font-mono text-sm text-ghost-500 mb-4">
                Er is een onverwachte fout opgetreden. Probeer de pagina te herladen.
              </p>
              <div className="flex gap-4 justify-center mb-6">
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-neon-cyan text-void font-mono rounded hover:opacity-80 transition"
                >
                  Herlaad Pagina
                </button>
                <button
                  onClick={() => this.setState({ hasError: false, error: undefined, errorInfo: undefined })}
                  className="px-4 py-2 bg-panel border border-panel-border text-ghost-300 font-mono rounded hover:border-neon-cyan transition"
                >
                  Probeer Opnieuw
                </button>
              </div>
              {this.state.error && (
                <details className="mt-4 text-left">
                  <summary className="cursor-pointer font-mono text-xs text-ghost-600">
                    Foutdetails
                  </summary>
                  <div className="mt-2 p-4 bg-ghost-800 rounded font-mono text-xs text-ghost-400 overflow-auto max-h-96 max-w-md mx-auto">
                    <pre className="whitespace-pre-wrap break-all">
                      {this.state.error.toString()}
                    </pre>
                    {this.state.errorInfo && (
                      <div className="mt-4 pt-4 border-t border-ghost-700">
                        <p className="text-ghost-500 mb-2">Component Stack:</p>
                        <pre className="whitespace-pre-wrap break-all text-ghost-600">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

const ErrorBoundary = memo(ErrorBoundaryClass);
export default ErrorBoundary;
