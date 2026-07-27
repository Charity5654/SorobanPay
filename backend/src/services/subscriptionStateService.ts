/**
 * BE-67 — Subscription state service.
 *
 * Persists subscription state transitions to the database.
 * Wraps the pure state machine with DB read/write logic.
 */

import prisma from '../lib/prisma';
import { transition, SubscriptionState, SubscriptionEventType } from '../lib/subscriptionStateMachine';

export interface EventData {
  amount?: string;
  token?: string;
}

/**
 * Apply an on-chain event to the subscription's persisted state.
 *
 * - If no Subscription row exists, creates one (defaulting to ACTIVE for 'subscribe').
 * - If the transition is invalid, logs a warning and leaves the DB unchanged.
 * - Returns the resulting state.
 */
export async function applyEvent(
  subscriber: string,
  merchant: string,
  eventType: SubscriptionEventType,
  data: EventData = {},
): Promise<SubscriptionState> {
  const existing = await prisma.subscription.findUnique({
    where: { subscriber_merchant: { subscriber, merchant } },
  });

  const currentState: SubscriptionState = (existing?.status as SubscriptionState) ?? 'ACTIVE';

  const nextState = transition(currentState, eventType);

  if (nextState === null) {
    // Invalid transition — on-chain is authoritative, don't update DB
    console.warn(
      `[subscription-state] Skipping invalid transition for ${subscriber}/${merchant}: ` +
        `${currentState} + ${eventType}`,
    );
    return currentState;
  }

  // Upsert the subscription row with the new state
  await prisma.subscription.upsert({
    where: { subscriber_merchant: { subscriber, merchant } },
    create: {
      subscriber,
      merchant,
      token: data.token ?? '',
      amount: data.amount ?? '0',
      status: nextState,
    },
    update: {
      status: nextState,
      ...(data.amount ? { amount: data.amount } : {}),
      ...(data.token ? { token: data.token } : {}),
    },
  });

  console.log(
    `[subscription-state] ${subscriber}/${merchant}: ${currentState} → ${nextState} (${eventType})`,
  );

  return nextState;
}

/**
 * Retrieve the current status of a subscription.
 * Returns null if no record exists yet.
 */
export async function getSubscriptionStatus(
  subscriber: string,
  merchant: string,
): Promise<SubscriptionState | null> {
  const record = await prisma.subscription.findUnique({
    where: { subscriber_merchant: { subscriber, merchant } },
  });

  return (record?.status as SubscriptionState) ?? null;
}
