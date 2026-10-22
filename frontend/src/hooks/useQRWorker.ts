/**
 * useQRWorker.ts
 *
 * Custom hook for generating QR codes using a Web Worker with proper:
 * - Typed message passing
 * - AbortController-based cancellation
 * - Automatic cleanup
 * - Synchronous fallback for unsupported browsers
 * - Memoized worker instance
 *
 * Issue: FE-1056
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type {
  QRWorkerGenerateMessage,
  QRWorkerMessage,
} from '@/workers/qr.types';

/**
 * Result state for QR generation.
 */
export interface QRGenerationResult {
  status: 'idle' | 'loading' | 'success' | 'error';
  dataUrl: string | null;
  error: Error | null;
}

/**
 * Fallback synchronous QR generation using qrcode.react canvas.
 * Used when Web Workers are not supported.
 */
async function generateQRSynchronous(
  url: string,
  size: number,
  level: 'L' | 'M' | 'Q' | 'H'
): Promise<string> {
  // Dynamically import qrcode to keep bundle small
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const qrcode = require('qrcode');

  const dataUrl = await qrcode.toDataURL(url, {
    errorCorrectionLevel: level,
    type: 'image/png',
    quality: 0.95,
    margin: 0,
    width: size,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });

  return dataUrl;
}

/**
 * Initialize a Web Worker, with fallback if not supported.
 * Memoized per component instance to avoid multiple worker instances.
 */
function initializeWorker(): Worker | null {
  // Check if Web Workers are supported
  if (typeof Worker === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  try {
    // Create worker from static worker path
    // Next.js and webpack will handle this automatically at build time
    // This path pattern works with Next.js worker support
    const workerUrl = '/workers/qr.worker.ts';
    return new Worker(workerUrl, { type: 'module' });
  } catch {
    // Worker creation failed, fall back to synchronous
    return null;
  }
}

/**
 * Hook for generating QR codes with worker support and proper cleanup.
 *
 * Usage:
 * ```tsx
 * const { status, dataUrl, error } = useQRWorker(url, size, level);
 *
 * useEffect(() => {
 *   if (status === 'success') {
 *     handleQRGenerated(dataUrl);
 *   }
 * }, [status, dataUrl]);
 * ```
 */
export function useQRWorker(
  url: string,
  size: number = 200,
  level: 'L' | 'M' | 'Q' | 'H' = 'M'
): QRGenerationResult {
  const [result, setResult] = useState<QRGenerationResult>({
    status: 'idle',
    dataUrl: null,
    error: null,
  });

  const workerRef = useRef<Worker | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string>('');
  const messageHandlerRef = useRef<((event: MessageEvent<QRWorkerMessage>) => void) | null>(null);

  // Initialize worker once
  useEffect(() => {
    workerRef.current = initializeWorker();
    return () => {
      // Cleanup worker on unmount
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Generate QR code
  const generate = useCallback(async () => {
    // Cancel any previous generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this generation
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Generate unique request ID
    requestIdRef.current = `qr-${Date.now()}-${Math.random()}`;

    setResult({
      status: 'loading',
      dataUrl: null,
      error: null,
    });

    try {
      // Determine which path to use
      const useWorker = workerRef.current !== null;

      if (useWorker && workerRef.current) {
        // Use worker for heavy lifting
        const worker = workerRef.current;

        // Create message handler
        const handleMessage = (event: MessageEvent<QRWorkerMessage>) => {
          const message = event.data;

          // Ignore messages for other requests
          if (message.id !== requestIdRef.current) {
            return;
          }

          // Clean up message handler
          if (messageHandlerRef.current) {
            worker.removeEventListener('message', messageHandlerRef.current);
            messageHandlerRef.current = null;
          }

          // Handle abort
          if (signal.aborted) {
            return;
          }

          if (message.type === 'success') {
            setResult({
              status: 'success',
              dataUrl: message.dataUrl,
              error: null,
            });
          } else if (message.type === 'error') {
            setResult({
              status: 'error',
              dataUrl: null,
              error: new Error(message.error),
            });
          }
        };

        messageHandlerRef.current = handleMessage;
        worker.addEventListener('message', handleMessage);

        // Send generate request
        const generateMsg: QRWorkerGenerateMessage = {
          type: 'generate',
          id: requestIdRef.current,
          url,
          size,
          level,
        };
        worker.postMessage(generateMsg);
      } else {
        // Fall back to synchronous generation
        const dataUrl = await generateQRSynchronous(url, size, level);

        if (signal.aborted) {
          return;
        }

        setResult({
          status: 'success',
          dataUrl,
          error: null,
        });
      }
    } catch (err) {
      if (!signal.aborted) {
        setResult({
          status: 'error',
          dataUrl: null,
          error: err instanceof Error ? err : new Error('Unknown error'),
        });
      }
    }
  }, [url, size, level]);

  // Trigger generation when URL changes
  useEffect(() => {
    if (!url) {
      setResult({
        status: 'idle',
        dataUrl: null,
        error: null,
      });
      return;
    }

    generate();

    // Cleanup on unmount or when dependencies change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (messageHandlerRef.current && workerRef.current) {
        workerRef.current.removeEventListener('message', messageHandlerRef.current);
        messageHandlerRef.current = null;
      }
    };
  }, [url, size, level, generate]);

  return result;
}
