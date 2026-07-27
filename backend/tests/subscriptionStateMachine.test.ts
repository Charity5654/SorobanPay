/**
 * BE-67 — Subscription lifecycle state machine tests.
 */

import { transition, isTerminal, SubscriptionState, SubscriptionEventType } from '../src/lib/subscriptionStateMachine';

describe('transition()', () => {
  // Valid transitions
  describe('valid transitions', () => {
    it('subscribe → ACTIVE from any state', () => {
      const states: SubscriptionState[] = ['ACTIVE', 'PAUSED', 'OVERDUE', 'CANCELLED', 'EXPIRED'];
      for (const state of states) {
        expect(transition(state, 'subscribe')).toBe('ACTIVE');
      }
    });

    it('ACTIVE + payment_transfer_failure → OVERDUE', () => {
      expect(transition('ACTIVE', 'payment_transfer_failure')).toBe('OVERDUE');
    });

    it('OVERDUE + executed → ACTIVE', () => {
      expect(transition('OVERDUE', 'executed')).toBe('ACTIVE');
    });

    it('ACTIVE + executed → ACTIVE (no-op)', () => {
      expect(transition('ACTIVE', 'executed')).toBe('ACTIVE');
    });

    it('ACTIVE + cancel → CANCELLED', () => {
      expect(transition('ACTIVE', 'cancel')).toBe('CANCELLED');
    });

    it('OVERDUE + cancel → CANCELLED', () => {
      expect(transition('OVERDUE', 'cancel')).toBe('CANCELLED');
    });

    it('PAUSED + cancel → CANCELLED', () => {
      expect(transition('PAUSED', 'cancel')).toBe('CANCELLED');
    });

    it('ACTIVE + ttl_expired → EXPIRED', () => {
      expect(transition('ACTIVE', 'ttl_expired')).toBe('EXPIRED');
    });

    it('OVERDUE + ttl_expired → EXPIRED', () => {
      expect(transition('OVERDUE', 'ttl_expired')).toBe('EXPIRED');
    });
  });

  // Invalid transitions
  describe('invalid transitions — returns null and warns', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('CANCELLED + payment_transfer_failure → null (warning logged)', () => {
      const result = transition('CANCELLED', 'payment_transfer_failure');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid transition'),
      );
    });

    it('EXPIRED + cancel → null (warning logged)', () => {
      const result = transition('EXPIRED', 'cancel');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid transition'),
      );
    });

    it('EXPIRED + ttl_expired → null (warning logged)', () => {
      // Already expired — no further transition
      const result = transition('EXPIRED', 'ttl_expired');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  // Full lifecycle sequence
  describe('full event sequence', () => {
    it('subscribe → failure → recovery → cancel', () => {
      let state: SubscriptionState = 'ACTIVE';

      // First subscription
      state = transition(state, 'subscribe')!;
      expect(state).toBe('ACTIVE');

      // Payment fails
      state = transition(state, 'payment_transfer_failure')!;
      expect(state).toBe('OVERDUE');

      // Retry succeeds
      state = transition(state, 'executed')!;
      expect(state).toBe('ACTIVE');

      // Subscriber cancels
      state = transition(state, 'cancel')!;
      expect(state).toBe('CANCELLED');
    });

    it('subscribe → TTL expiry → re-subscribe restores ACTIVE', () => {
      let state: SubscriptionState = 'ACTIVE';

      state = transition(state, 'ttl_expired')!;
      expect(state).toBe('EXPIRED');

      // Re-subscribe resets even from terminal states
      state = transition(state, 'subscribe')!;
      expect(state).toBe('ACTIVE');
    });
  });
});

describe('isTerminal()', () => {
  it('returns true for CANCELLED', () => {
    expect(isTerminal('CANCELLED')).toBe(true);
  });

  it('returns true for EXPIRED', () => {
    expect(isTerminal('EXPIRED')).toBe(true);
  });

  it('returns false for ACTIVE', () => {
    expect(isTerminal('ACTIVE')).toBe(false);
  });

  it('returns false for OVERDUE', () => {
    expect(isTerminal('OVERDUE')).toBe(false);
  });

  it('returns false for PAUSED', () => {
    expect(isTerminal('PAUSED')).toBe(false);
  });
});
