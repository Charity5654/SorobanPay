/**
 * qr.worker.ts
 *
 * Web Worker for generating QR codes off the main thread.
 *
 * Receives messages with URL and QR code parameters, generates a PNG data URL
 * using canvas-based QR code rendering, and sends the result back to the main thread.
 *
 * Uses the qrcode library (as a dependency of qrcode.react) for core QR generation
 * logic with canvas output, avoiding main thread blocking during complex computations.
 */

import type {
  QRWorkerGenerateMessage,
  QRWorkerSuccessMessage,
  QRWorkerErrorMessage,
} from './qr.types';

/**
 * Generates a QR code from the given URL and sends it back to main thread.
 * Dynamically imports and uses the qrcode library to generate a PNG data URL.
 *
 * This runs in a separate thread, so expensive QR generation doesn't block the UI.
 */
async function generateQR(message: QRWorkerGenerateMessage): Promise<void> {
  try {
    const { id, url, size, level } = message;

    // Dynamically import the qrcode library
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const qrcode = require('qrcode');

    // Generate QR code as data URL with specified parameters
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

    // Send success message back to main thread
    const successMsg: QRWorkerSuccessMessage = {
      type: 'success',
      id,
      dataUrl,
    };
    self.postMessage(successMsg);
  } catch (error) {
    // Send error message back to main thread
    const errorMsg: QRWorkerErrorMessage = {
      type: 'error',
      id: message.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    self.postMessage(errorMsg);
  }
}

/**
 * Worker message handler.
 * Receives generate requests and dispatches QR code generation.
 */
self.onmessage = async (event: MessageEvent<QRWorkerGenerateMessage>) => {
  const message = event.data;

  if (message.type === 'generate') {
    await generateQR(message);
  }
};

// Explicitly tell TypeScript this is a worker script
export {};
