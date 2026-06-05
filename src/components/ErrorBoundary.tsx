import { Component, ReactNode } from 'react';
import { createLogger } from '../utils/logger';

const logger = createLogger('ErrorBoundary');

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error boundary component to catch and handle React errors gracefully.
 * Prevents single component errors from crashing the entire application.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        logger.error('Caught an error:', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="error-boundary">
                    <div className="error-boundary-content">
                        <h2>界面出错了</h2>
                        <p>可以重试一次；如果仍然失败，请重新打开当前书籍。</p>
                        {this.state.error && (
                            <details className="error-details">
                                <summary>错误详情</summary>
                                <pre>{this.state.error.message}</pre>
                            </details>
                        )}
                        <button className="btn btn-primary" onClick={this.handleReset}>
                            重试
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
