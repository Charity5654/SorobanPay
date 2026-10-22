import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { lightTheme, darkTheme } from '../styles/theme';
import CssBaseline from '@mui/material/CssBaseline';

interface ThemeContextType {
    mode: 'light' | 'dark';
    toggleTheme: () => void;
    setMode: (mode: 'light' | 'dark') => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = (): ThemeContextType => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};

interface ThemeProviderProps {
    children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
    const [mode, setMode] = useState<'light' | 'dark'>(() => {
        // Check localStorage for saved preference
        const saved = localStorage.getItem('theme-mode');
        if (saved === 'light' || saved === 'dark') {
            return saved;
        }
        // Check system preference
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    });

    useEffect(() => {
        localStorage.setItem('theme-mode', mode);
        document.documentElement.setAttribute('data-theme', mode);
    }, [mode]);

    const toggleTheme = (): void => {
        setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
    };

    const theme = mode === 'light' ? lightTheme : darkTheme;

    return (
        <ThemeContext.Provider value={{ mode, toggleTheme, setMode }}>
            <MuiThemeProvider theme={theme}>
                <CssBaseline enableColorScheme />
                {children}
            </MuiThemeProvider>
        </ThemeContext.Provider>
    );
};
