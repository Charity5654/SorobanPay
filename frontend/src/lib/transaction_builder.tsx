import React, { useState } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Button,
    TextField,
    Alert,
    CircularProgress,
    Paper,
} from '@mui/material';
import AsyncErrorBoundary from '../components/AsyncErrorBoundary';

export const TransactionBuilder: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [txHash, setTxHash] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        recipient: '',
        amount: '',
        asset: 'XLM',
    });

    const handleBuild = async () => {
        setLoading(true);
        setError(null);
        setSuccess(false);
        setTxHash(null);

        try {
            // Simulate building a transaction
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Simulate transaction hash
            const hash = '0x' + Array.from({ length: 64 }, () =>
                Math.floor(Math.random() * 16).toString(16)
            ).join('');

            setTxHash(hash);
            setSuccess(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to build transaction');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            // Simulate submitting a transaction
            await new Promise((resolve, reject) => {
                setTimeout(() => {
                    if (Math.random() < 0.1) {
                        reject(new Error('Transaction failed'));
                    } else {
                        resolve({});
                    }
                }, 2000);
            });

            setSuccess(true);
            setFormData({ recipient: '', amount: '', asset: 'XLM' });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Transaction failed');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field: keyof typeof formData) => (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        setFormData({ ...formData, [field]: e.target.value });
    };

    return (
        <AsyncErrorBoundary>
            <Box sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}>
                <Card>
                    <CardContent>
                        <Typography variant="h5" gutterBottom>
                            Build Transaction
                        </Typography>

                        {error && (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                {error}
                            </Alert>
                        )}

                        {success && txHash && (
                            <Alert severity="success" sx={{ mb: 2 }}>
                                Transaction built: {txHash}
                            </Alert>
                        )}

                        <TextField
                            label="Recipient Address"
                            fullWidth
                            required
                            value={formData.recipient}
                            onChange={handleChange('recipient')}
                            sx={{ mb: 2 }}
                            disabled={loading}
                            placeholder="G..."
                        />

                        <TextField
                            label="Amount"
                            type="number"
                            fullWidth
                            required
                            value={formData.amount}
                            onChange={handleChange('amount')}
                            sx={{ mb: 2 }}
                            disabled={loading}
                        />

                        <TextField
                            label="Asset"
                            fullWidth
                            required
                            value={formData.asset}
                            onChange={handleChange('asset')}
                            sx={{ mb: 2 }}
                            disabled={loading}
                        />

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={handleBuild}
                                disabled={loading}
                                startIcon={loading ? <CircularProgress size={20} /> : null}
                            >
                                {loading ? 'Building...' : 'Build'}
                            </Button>
                            <Button
                                variant="contained"
                                color="success"
                                onClick={handleSubmit}
                                disabled={loading || !success}
                                startIcon={loading ? <CircularProgress size={20} /> : null}
                            >
                                Submit
                            </Button>
                        </Box>
                    </CardContent>
                </Card>
            </Box>
        </AsyncErrorBoundary>
    );
};
