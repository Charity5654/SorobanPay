/**
 * qr.types.ts
 *
 * Typed message contracts for QR code generation worker.
 * Defines the communication protocol between main thread and worker.
 */

/**
 * Message sent from main thread to worker requesting QR code generation.
 */
export interface QRWorkerGenerateMessage {
  type: 'generate';
  id: string;
  url: string;
  size: number;
  level: 'L' | 'M' | 'Q' | 'H';
}

/**
 * Message sent from worker to main thread on success.
 * Contains the generated QR code as a PNG data URL.
 */
export interface QRWorkerSuccessMessage {
  type: 'success';
  id: string;
  dataUrl: string;
}

/**
 * Message sent from worker to main thread on error.
 */
export interface QRWorkerErrorMessage {
  type: 'error';
  id: string;
  error: string;
}

/**
 * All possible messages sent from worker to main thread.
 */
export type QRWorkerMessage = QRWorkerSuccessMessage | QRWorkerErrorMessage;

/**
 * All possible messages sent to worker from main thread.
 */
export type QRWorkerInMessage = QRWorkerGenerateMessage;
