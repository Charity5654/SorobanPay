/**
 * useFormPersist.test.ts
 *
 * Unit tests for the useFormPersist hook and its helper functions:
 *   getPersistedFormData, persistFormData, clearPersistedFormData, useFormPersist
 *
 * Issue #433 – Frontend unit tests with Jest and RTL
 */
import { renderHook, act } from '@testing-library/react';
import {
  getPersistedFormData,
  persistFormData,
  clearPersistedFormData,
  useFormPersist,
} from '@/hooks/useFormPersist';

// ── sessionStorage mock ──────────────────────────────────────────────────────

const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(global, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
});

const DEFAULT_INTERVAL = '2592000';

describe('getPersistedFormData', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    jest.clearAllMocks();
  });

  it('returns defaults when sessionStorage is empty', () => {
    const data = getPersistedFormData(DEFAULT_INTERVAL);
    expect(data).toEqual({
      merchantAddress: '',
      tokenAddress: '',
      amount: '',
      interval: DEFAULT_INTERVAL,
    });
  });

  it('returns stored values when they exist', () => {
    sessionStorageMock.setItem(
      'sorobanpay_form_data',
      JSON.stringify({
        merchantAddress: 'G' + 'A'.repeat(55),
        tokenAddress: 'C' + 'A'.repeat(55),
        amount: '200',
        interval: '86400',
      }),
    );

    const data = getPersistedFormData(DEFAULT_INTERVAL);
    expect(data.merchantAddress).toBe('G' + 'A'.repeat(55));
    expect(data.tokenAddress).toBe('C' + 'A'.repeat(55));
    expect(data.amount).toBe('200');
    expect(data.interval).toBe('86400');
  });

  it('falls back to default interval when stored interval is missing', () => {
    sessionStorageMock.setItem(
      'sorobanpay_form_data',
      JSON.stringify({ merchantAddress: 'G' + 'A'.repeat(55) }),
    );
    const data = getPersistedFormData(DEFAULT_INTERVAL);
    expect(data.interval).toBe(DEFAULT_INTERVAL);
  });

  it('returns defaults when JSON is malformed', () => {
    sessionStorageMock.setItem('sorobanpay_form_data', '{bad json}}}');
    const data = getPersistedFormData(DEFAULT_INTERVAL);
    expect(data).toEqual({
      merchantAddress: '',
      tokenAddress: '',
      amount: '',
      interval: DEFAULT_INTERVAL,
    });
  });

  it('returns defaults when running on the server (window undefined)', () => {
    const original = global.window;
    // @ts-expect-error intentionally removing window
    delete global.window;
    const data = getPersistedFormData(DEFAULT_INTERVAL);
    expect(data.merchantAddress).toBe('');
    expect(data.interval).toBe(DEFAULT_INTERVAL);
    global.window = original;
  });
});

describe('persistFormData', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    jest.clearAllMocks();
  });

  it('writes form data to sessionStorage as JSON', () => {
    const formData = {
      merchantAddress: 'G' + 'A'.repeat(55),
      tokenAddress: 'C' + 'A'.repeat(55),
      amount: '100',
      interval: '2592000',
    };
    persistFormData(formData);
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'sorobanpay_form_data',
      JSON.stringify(formData),
    );
  });

  it('does not throw when sessionStorage.setItem throws', () => {
    sessionStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('Storage quota exceeded');
    });
    expect(() =>
      persistFormData({ merchantAddress: '', tokenAddress: '', amount: '', interval: '' }),
    ).not.toThrow();
  });
});

describe('clearPersistedFormData', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    jest.clearAllMocks();
  });

  it('removes the stored key from sessionStorage', () => {
    sessionStorageMock.setItem('sorobanpay_form_data', '{}');
    clearPersistedFormData();
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('sorobanpay_form_data');
  });

  it('does not throw when storage is already empty', () => {
    expect(() => clearPersistedFormData()).not.toThrow();
  });
});

describe('useFormPersist hook', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists form data after the debounce delay', () => {
    const formData = {
      merchantAddress: 'G' + 'A'.repeat(55),
      tokenAddress: 'C' + 'A'.repeat(55),
      amount: '100',
      interval: '2592000',
    };

    renderHook(() => useFormPersist(formData, 500));

    // Before debounce fires
    expect(sessionStorageMock.setItem).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'sorobanpay_form_data',
      JSON.stringify(formData),
    );
  });

  it('debounces — only persists once for rapid changes', () => {
    const { rerender } = renderHook(
      ({ data }) => useFormPersist(data, 500),
      {
        initialProps: {
          data: { merchantAddress: 'G1', tokenAddress: '', amount: '', interval: '' },
        },
      },
    );

    rerender({
      data: { merchantAddress: 'G2', tokenAddress: '', amount: '', interval: '' },
    });
    rerender({
      data: { merchantAddress: 'G3', tokenAddress: '', amount: '', interval: '' },
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Only one call — the last debounced one
    expect(sessionStorageMock.setItem).toHaveBeenCalledTimes(1);
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'sorobanpay_form_data',
      expect.stringContaining('G3'),
    );
  });

  it('clears the debounce timer on unmount (no call after unmount)', () => {
    const formData = {
      merchantAddress: 'G' + 'A'.repeat(55),
      tokenAddress: '',
      amount: '',
      interval: '',
    };

    const { unmount } = renderHook(() => useFormPersist(formData, 500));
    unmount();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(sessionStorageMock.setItem).not.toHaveBeenCalled();
  });
});
