import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App';
import './index.css';

const theme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: '#1976D2',
        },
        secondary: {
            main: '#DC004E',
        },
    },
});

const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);

root.render(
    <React.StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </ThemeProvider>
    </React.StrictMode>
);
