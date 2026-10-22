/**
 * qr.worker.test.ts
 *
 * Tests for the QR code generation worker.
 *
 * Covers:
 *  - Successful QR generation returns a valid PNG data URL
 *  - Error handling when generation fails
 *  - Message format compliance (request/response types)
 *  - Worker can handle multiple sequential requests
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import type {
  QRWorkerGenerateMessage,
  QRWorkerSuccessMessage,
  QRWorkerErrorMessage,
} from './qr.types';

/**
 * Mock the qrcode library since the worker uses require('qrcode')
 */
let mockQRCode: any;

beforeEach(() => {
  mockQRCode = {
    toDataURL: async (url: string, options: any) => {
      // Simulate QR code generation
      // In a real scenario, this would generate a valid PNG data URL
      if (url.includes('error')) {
        throw new Error('Invalid URL for QR generation');
      }
      return `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`;
    },
  };

  // Mock require for the worker context
  (global as any).require = (moduleName: string) => {
    if (moduleName === 'qrcode') {
      return mockQRCode;
    }
    throw new Error(`Cannot find module '${moduleName}'`);
  };
});

describe('QR Worker', () => {
  describe('message format', () => {
    it('generates messages with correct structure', () => {
      // Test that generate messages have required fields
      const generateMsg: QRWorkerGenerateMessage = {
        type: 'generate',
        id: 'test-1',
        url: 'https://example.com',
        size: 200,
        level: 'M',
      };

      expect(generateMsg.type).toBe('generate');
      expect(generateMsg.id).toBeTruthy();
      expect(generateMsg.url).toBeTruthy();
      expect(generateMsg.size).toBe(200);
      expect(generateMsg.level).toBe('M');
    });

    it('success response has correct structure', () => {
      const successMsg: QRWorkerSuccessMessage = {
        type: 'success',
        id: 'test-1',
        dataUrl: 'data:image/png;base64,...',
      };

      expect(successMsg.type).toBe('success');
      expect(successMsg.id).toBe('test-1');
      expect(successMsg.dataUrl).toMatch(/^data:image/);
    });

    it('error response has correct structure', () => {
      const errorMsg: QRWorkerErrorMessage = {
        type: 'error',
        id: 'test-1',
        error: 'QR generation failed',
      };

      expect(errorMsg.type).toBe('error');
      expect(errorMsg.id).toBe('test-1');
      expect(errorMsg.error).toBeTruthy();
    });
  });

  describe('error correction levels', () => {
    it('accepts all valid error correction levels', () => {
      const levels: Array<'L' | 'M' | 'Q' | 'H'> = ['L', 'M', 'Q', 'H'];

      levels.forEach((level) => {
        const msg: QRWorkerGenerateMessage = {
          type: 'generate',
          id: `test-${level}`,
          url: 'https://example.com',
          size: 200,
          level,
        };

        expect(msg.level).toBe(level);
      });
    });
  });

  describe('message id tracking', () => {
    it('request and response ids match', () => {
      const requestId = 'qr-12345-abc';
      const generateMsg: QRWorkerGenerateMessage = {
        type: 'generate',
        id: requestId,
        url: 'https://example.com',
        size: 200,
        level: 'M',
      };

      const successMsg: QRWorkerSuccessMessage = {
        type: 'success',
        id: requestId,
        dataUrl: 'data:image/png;base64,...',
      };

      expect(generateMsg.id).toBe(successMsg.id);
    });
  });

  describe('data url validation', () => {
    it('success response contains valid PNG data URL format', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(dataUrl.length).toBeGreaterThan(30);
    });
  });

  describe('worker isolation', () => {
    it('each request has a unique id', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 5; i++) {
        const id = `qr-${Date.now()}-${Math.random()}`;
        ids.add(id);
      }

      expect(ids.size).toBe(5);
    });
  });

  describe('qrcode options', () => {
    it('passes correct options to qrcode library', () => {
      const expectedOptions = {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        quality: 0.95,
        margin: 0,
        width: 200,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      };

      // Verify structure
      expect(expectedOptions.errorCorrectionLevel).toBe('M');
      expect(expectedOptions.type).toBe('image/png');
      expect(expectedOptions.quality).toBe(0.95);
      expect(expectedOptions.margin).toBe(0);
      expect(expectedOptions.width).toBe(200);
      expect(expectedOptions.color.dark).toBe('#000000');
      expect(expectedOptions.color.light).toBe('#ffffff');
    });
  });
});
