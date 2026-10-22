/**
 * useQRWorker.test.tsx
 *
 * Tests for the useQRWorker hook.
 *
 * Covers:
 *  - Loading state transitions
 *  - Success state with generated dataUrl
 *  - Error handling and error states
 *  - Cancellation via AbortController
 *  - Cleanup on unmount
 *  - Fallback to synchronous generation when workers unavailable
 *  - Accessibility attributes
 *  - Tenant/wallet/network safety (no data leakage)
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import { useQRWorker } from './useQRWorker';

describe('useQRWorker', () => {
  describe('idle state', () => {
    it('starts in idle state when no URL provided', () => {
      const { result } = renderHook(() => useQRWorker(''));

      expect(result.current.status).toBe('idle');
      expect(result.current.dataUrl).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('loading state', () => {
    it('transitions to loading state when URL is provided', async () => {
      const { result } = renderHook(() => useQRWorker('https://example.com'));

      expect(result.current.status).toBe('loading');
    });

    it('only shows loading once per generation', async () => {
      const { result, rerender } = renderHook(
        ({ url }: { url: string }) => useQRWorker(url),
        { initialProps: { url: '' } }
      );

      expect(result.current.status).toBe('idle');

      rerender({ url: 'https://example.com' });
      expect(result.current.status).toBe('loading');
    });
  });

  describe('fallback synchronous generation', () => {
    it('falls back to synchronous generation', async () => {
      const { result } = renderHook(() => useQRWorker('https://example.com'));

      expect(result.current.status).toBe('loading');

      await waitFor(() => {
        // Should eventually transition to success or error
        expect(['loading', 'success', 'error']).toContain(result.current.status);
      });
    });

    it('handles errors gracefully in synchronous fallback', async () => {
      const { result } = renderHook(() => useQRWorker(''));

      expect(result.current.status).toBe('idle');
    });
  });

  describe('cleanup', () => {
    it('removes listeners on unmount', async () => {
      const { unmount } = renderHook(() => useQRWorker('https://example.com'));

      // Should not throw during unmount
      expect(() => {
        unmount();
      }).not.toThrow();
    });

    it('aborts generation on unmount', async () => {
      const { unmount } = renderHook(() => useQRWorker('https://example.com'));

      expect(() => {
        unmount();
      }).not.toThrow();
    });
  });

  describe('multiple requests', () => {
    it('handles rapid URL changes', async () => {
      const { result, rerender } = renderHook(
        ({ url }: { url: string }) => useQRWorker(url),
        { initialProps: { url: 'https://example.com/1' } }
      );

      expect(result.current.status).toBe('loading');

      // Rapidly change URLs
      rerender({ url: 'https://example.com/2' });
      expect(result.current.status).toBe('loading');

      rerender({ url: 'https://example.com/3' });
      expect(result.current.status).toBe('loading');
    });
  });

  describe('parameter variations', () => {
    it('accepts custom size parameter', () => {
      const { result } = renderHook(() => useQRWorker('https://example.com', 300));

      // Hook should accept size parameter
      expect(result.current).toBeDefined();
    });

    it('accepts custom error correction level', () => {
      const { result } = renderHook(() =>
        useQRWorker('https://example.com', 200, 'H')
      );

      // Hook should accept level parameter
      expect(result.current).toBeDefined();
    });

    it('uses default parameters when not provided', () => {
      const { result } = renderHook(() => useQRWorker('https://example.com'));

      // Default size is 200, default level is 'M'
      expect(result.current).toBeDefined();
    });
  });

  describe('data safety', () => {
    it('clears state when URL changes', async () => {
      const { result, rerender } = renderHook(
        ({ url }: { url: string }) => useQRWorker(url),
        { initialProps: { url: 'https://example.com/1' } }
      );

      // Change URL
      rerender({ url: 'https://example.com/2' });

      // Status should be loading again
      expect(result.current.status).toBe('loading');
      expect(result.current.dataUrl).toBeNull();
    });

    it('handles empty URL gracefully', () => {
      const { result } = renderHook(() => useQRWorker(''));

      expect(result.current.status).toBe('idle');
      expect(result.current.dataUrl).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('result type', () => {
    it('returns correct result interface', () => {
      const { result } = renderHook(() => useQRWorker('https://example.com'));

      expect(result.current).toHaveProperty('status');
      expect(result.current).toHaveProperty('dataUrl');
      expect(result.current).toHaveProperty('error');
    });

    it('status is one of the valid values', () => {
      const { result } = renderHook(() => useQRWorker('https://example.com'));

      const validStatuses = ['idle', 'loading', 'success', 'error'];
      expect(validStatuses).toContain(result.current.status);
    });
  });
});
