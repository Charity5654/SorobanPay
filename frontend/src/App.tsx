import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import ErrorBoundary from './components/ErrorBoundary';
import { SubscriptionForm } from './components/SubscriptionForm';
import { TransactionBuilder } from './lib/transaction_builder';

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

function App() {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <ErrorBoundary>
                <BrowserRouter>
                    <Routes>
                        <Route path="/" element={<SubscriptionForm />} />
                        <Route path="/subscribe" element={<SubscriptionForm />} />
                        <Route path="/transactions" element={<TransactionBuilder />} />
                    </Routes>
                </BrowserRouter>
            </ErrorBoundary>
        </ThemeProvider>
    );
}

export default App;
