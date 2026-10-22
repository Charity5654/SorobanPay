/**
 * Notification types for the in-app notification center (UX-119 / #454).
 */

export type NotificationType =
  | 'payment_collected'  // ✅ Merchant: payment received from subscriber
  | 'payment_failed'     // ❌ Subscriber: payment to merchant failed (low balance)
  | 'payment_due'        // 🔔 Upcoming payment reminder
  | 'ttl_warning';       // ⚠️  Subscription storage entry expiring soon

export interface Notification {
  /** Unique ID (e.g., crypto.randomUUID() or Date.now() string) */
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  read: boolean;
  /** Optional: Stellar public key of the subscriber */
  subscriber?: string;
  /** Optional: Stellar public key of the merchant */
  merchant?: string;
  /** Optional: transaction hash for payment_collected / payment_failed */
  txHash?: string;
}
