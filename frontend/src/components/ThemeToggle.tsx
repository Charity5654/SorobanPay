import React from 'react';
import { IconButton, Tooltip, useTheme } from '@mui/material';
import { Brightness4, Brightness7 } from '@mui/icons-material';
import { useTheme as useThemeContext } from '../context/ThemeContext';

export const ThemeToggle: React.FC = () => {
    const theme = useTheme();
    const { mode, toggleTheme } = useThemeContext();

    return (
        <Tooltip title={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`}>
            <IconButton
                onClick={toggleTheme}
                color="inherit"
                aria-label="toggle theme"
                sx={{
                    transition: 'all 0.3s ease',
                    '&:hover': {
                        transform: 'rotate(20deg)',
                    },
                }}
            >
                {mode === 'light' ? <Brightness4 /> : <Brightness7 />}
            </IconButton>
        </Tooltip>
    );
};
