import type { Meta, StoryObj } from "@storybook/react";
import SubscriptionForm from "./SubscriptionForm";

/**
 * Stories for SubscriptionForm — covers the main UI states for Chromatic
 * visual regression testing (TEST-104).
 *
 * Chromatic will snapshot each story at viewports: 375, 768, 1280 px.
 */
const meta: Meta<typeof SubscriptionForm> = {
  title: "Components/SubscriptionForm",
  component: SubscriptionForm,
  parameters: {
    // Disable Next.js router mock noise in snapshots
    nextjs: {
      appDirectory: true,
    },
    // Per-story Chromatic settings (merged with global preview.ts)
    chromatic: {
      viewports: [375, 768, 1280],
      delay: 300,
    },
    layout: "fullscreen",
  },
  // Wallet context is provided via mocked modules — stories render
  // the form in its disconnected state by default.
};

export default meta;
type Story = StoryObj<typeof SubscriptionForm>;

// ─── Default / disconnected state ────────────────────────────────────────────

/** Form rendered with no wallet connected. */
export const Default: Story = {
  name: "Default (wallet disconnected)",
};

// ─── Connected state (mock) ──────────────────────────────────────────────────

/** Form rendered with a wallet connected and ready to submit. */
export const WalletConnected: Story = {
  name: "Wallet connected",
  parameters: {
    // Override the wallet hook to simulate a connected wallet
    mockData: [
      {
        mock: "@/hooks/useWallet",
        data: {
          isConnected: true,
          publicKey:
            "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          connectWallet: () => Promise.resolve(),
          disconnectWallet: () => {},
        },
      },
    ],
  },
};

// ─── Mobile viewport ─────────────────────────────────────────────────────────

/** Explicit mobile viewport story for targeted Chromatic snapshot. */
export const Mobile: Story = {
  name: "Mobile (375 px)",
  parameters: {
    viewport: { defaultViewport: "mobile" },
    chromatic: { viewports: [375] },
  },
};

// ─── Tablet viewport ─────────────────────────────────────────────────────────

/** Explicit tablet viewport story. */
export const Tablet: Story = {
  name: "Tablet (768 px)",
  parameters: {
    viewport: { defaultViewport: "tablet" },
    chromatic: { viewports: [768] },
  },
};

// ─── Desktop viewport ────────────────────────────────────────────────────────

/** Explicit desktop viewport story. */
export const Desktop: Story = {
  name: "Desktop (1280 px)",
  parameters: {
    viewport: { defaultViewport: "desktop" },
    chromatic: { viewports: [1280] },
  },
};
