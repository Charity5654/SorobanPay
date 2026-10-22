import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Paper, Container } from '@mui/material';
import { styled } from '@mui/material/styles';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

const StyledPaper = styled(Paper)(({ theme }) => ({
    padding: theme.spacing(4),
    maxWidth: 500,
    margin: '0 auto',
    marginTop: theme.spacing(10),
    textAlign: 'center',
    borderRadius: 16,
}));

const ErrorIcon = styled(Box)({
    fontSize: 64,
    marginBottom: 16,
});

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return {
            hasError: true,
            error,
        };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // Update state with error info
        this.setState({
            errorInfo,
        });

        // Log error to console
        console.error('ErrorBoundary caught an error:', error, errorInfo);

        // Call onError prop if provided
        if (this.props.onError) {
            this.props.onError(error, errorInfo);
        }

        // Send to Sentry or other error tracking service
        if (typeof window !== 'undefined' && (window as any).Sentry) {
            (window as any).Sentry.captureException(error, {
                contexts: {
                    react: {
                        componentStack: errorInfo.componentStack,
                    },
                },
            });
        }
    }

    handleReset = (): void => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
        });
        window.location.href = '/';
    };

    handleReload = (): void => {
        window.location.reload();
    };

    render(): ReactNode {
        if (this.state.hasError) {
            // Use custom fallback if provided
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default fallback UI
            return (
                <Container maxWidth="sm">
                    <StyledPaper elevation={3}>
                        <ErrorIcon>😅</ErrorIcon>
                        <Typography variant="h5" gutterBottom>
                            Something went wrong
                        </Typography>
                        <Typography variant="body1" color="text.secondary" paragraph>
                            We're sorry, but something unexpected happened. Please try reloading the page.
                        </Typography>
                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <Box
                                sx={{
                                    mt: 2,
                                    mb: 2,
                                    p: 2,
                                    bgcolor: '#f5f5f5',
                                    borderRadius: 1,
                                    textAlign: 'left',
                                    overflow: 'auto',
                                    maxHeight: 200,
                                }}
                            >
                                <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap' }}>
                                    {this.state.error.toString()}
                                    {this.state.errorInfo && (
                                        <>
                                            {'\n\n'}
                                            {this.state.errorInfo.componentStack}
                                        </>
                                    )}
                                </Typography>
                            </Box>
                        )}
                        <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'center' }}>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={this.handleReload}
                            >
                                Reload Page
                            </Button>
                            <Button
                                variant="outlined"
                                color="secondary"
                                onClick={this.handleReset}
                            >
                                Go Home
                            </Button>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
                            If this issue persists, please contact support.
                        </Typography>
                    </StyledPaper>
                </Container>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
