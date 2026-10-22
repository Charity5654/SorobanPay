import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onRetry?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
    isLoading: boolean;
}

export class AsyncErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            isLoading: false,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return {
            hasError: true,
            error,
        };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error('AsyncErrorBoundary caught an error:', error, errorInfo);
    }

    handleRetry = async (): Promise<void> => {
        this.setState({ isLoading: true });
        try {
            if (this.props.onRetry) {
                await this.props.onRetry();
            }
            this.setState({
                hasError: false,
                error: null,
                isLoading: false,
            });
        } catch (error) {
            this.setState({
                hasError: true,
                error: error as Error,
                isLoading: false,
            });
        }
    };

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <Box
                    sx={{
                        p: 4,
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                    }}
                >
                    <Typography variant="h6" color="error">
                        ⚠️ Failed to load content
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </Typography>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={this.handleRetry}
                        disabled={this.state.isLoading}
                        startIcon={this.state.isLoading ? <CircularProgress size={20} /> : null}
                    >
                        {this.state.isLoading ? 'Retrying...' : 'Retry'}
                    </Button>
                </Box>
            );
        }

        return this.props.children;
    }
}

export default AsyncErrorBoundary;
