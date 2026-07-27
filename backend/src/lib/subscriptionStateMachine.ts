/**
 * BE-67 — Subscription lifecycle state machine.
 *
 * States and transitions:
 *
 *                  ┌─────────────────────────────────────────┐
 *                  │                                         │
 *   (subscribe) ───►  ACTIVE  ◄──(executed from OVERDUE)────┤
 *                  │    │                                    │
 *         (payment_transfer_failure)                         │
 *                  │    │                                    │
 *                  ▼    ▼                                    │
 *               OVERDUE ──────────────────────────────────── │
 *                  │
 *          (cancel from any state except CANCELLED/EXPIRED)
 *                  │
 *                  ▼
 *              CANCELLED
 *
 *   (ttl_expired) ──► EXPIRED  (from any non-terminal state)
 *
 * Rules:
 *  - CANCELLED and EXPIRED are terminal states.
 *  - On-chain is the authoritative source; invalid transitions are logged
 *    as warnings but never thrown (backend stays consistent with chain).
 *  - 'subscribe' event always resets to ACTIVE (handles re-subscribe after cancel).
 */

export type SubscriptionState = 'ACTIVE' | 'PAUSED' | 'OVERDUE' | 'CANCELLED' | 'EXPIRED';

export type SubscriptionEventType =
  | 'subscribe'
  | 'executed'
  | 'payment_transfer_failure'
  | 'cancel'
  | 'ttl_expired';

/** Terminal states cannot transition further. */
const TERMINAL_STATES: Set<SubscriptionState> = new Set(['CANCELLED', 'EXPIRED']);

/**
 * Transition table: [currentState][eventType] → nextState | null (invalid).
 * 'subscribe' is special: it always resets to ACTIVE from any state.
 */
const TRANSITIONS: Record<SubscriptionState, Partial<Record<SubscriptionEventType, SubscriptionState>>> = {
  ACTIVE: {
    subscribe: 'ACTIVE',
    payment_transfer_failure: 'OVERDUE',
    cancel: 'CANCELLED',
    ttl_expired: 'EXPIRED',
    // 'executed' from ACTIVE is a no-op (stays ACTIVE)
    executed: 'ACTIVE',
  },
  PAUSED: {
    subscribe: 'ACTIVE',
    cancel: 'CANCELLED',
    ttl_expired: 'EXPIRED',
    executed: 'ACTIVE',
    payment_transfer_failure: 'OVERDUE',
  },
  OVERDUE: {
    subscribe: 'ACTIVE',
    executed: 'ACTIVE',
    cancel: 'CANCELLED',
    ttl_expired: 'EXPIRED',
    payment_transfer_failure: 'OVERDUE',
  },
  CANCELLED: {
    // Terminal: only 'subscribe' can re-activate
    subscribe: 'ACTIVE',
  },
  EXPIRED: {
    // Terminal: only 'subscribe' can re-activate
    subscribe: 'ACTIVE',
  },
};

/**
 * Compute the next state given the current state and an incoming event.
 *
 * @returns nextState if the transition is valid, or null if invalid.
 *   An invalid transition is logged as a warning — the caller should
 *   NOT update the stored state when null is returned.
 */
export function transition(
  currentState: SubscriptionState,
  event: SubscriptionEventType,
): SubscriptionState | null {
  const stateMap = TRANSITIONS[currentState];
  const nextState = stateMap?.[event];

  if (!nextState) {
    console.warn(
      `[state-machine] Invalid transition: ${currentState} + ${event} → no target state defined`,
    );
    return null;
  }

  return nextState;
}

/**
 * Return true if the given state is terminal (CANCELLED or EXPIRED).
 */
export function isTerminal(state: SubscriptionState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Human-readable description of each state.
 */
export const STATE_DESCRIPTIONS: Record<SubscriptionState, string> = {
  ACTIVE: 'Subscription is active and payments are expected on schedule.',
  PAUSED: 'Subscription is temporarily paused by the subscriber.',
  OVERDUE: 'Last payment attempt failed due to insufficient balance.',
  CANCELLED: 'Subscription has been cancelled by the subscriber.',
  EXPIRED: 'Subscription entry expired (TTL exhausted on-chain).',
};
