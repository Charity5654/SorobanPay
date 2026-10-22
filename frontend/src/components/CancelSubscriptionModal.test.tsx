import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CancelSubscriptionModal } from "@/components/CancelSubscriptionModal";

const mockSubmitCancel = jest.fn();
const mockShowToast = jest.fn();

jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ publicKey: "Gsubscriber" }),
}));
jest.mock("@/components/Toast", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));
jest.mock("@/lib/runtime_config", () => ({
  getRuntimeConfig: () => ({
    contractId: "Ccontract",
    networkPassphrase: "Test Network",
    rpcUrl: "https://rpc.example.test",
  }),
}));
jest.mock("@/lib/transaction_builder", () => ({
  buildSignAndSubmitCancel: (...args: unknown[]) => mockSubmitCancel(...args),
}));

const baseProps = {
  merchantAddress: "Gmerchant",
  tokenAddress: "Ctoken",
  subscriberAddress: "Gsubscriber",
  isOpen: true,
  onClose: jest.fn(),
};

function startCancellation() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel Subscription" }));
}

describe("CancelSubscriptionModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("submits and reports success", async () => {
    mockSubmitCancel.mockResolvedValue({ txHash: "transaction-hash" });
    const onSuccess = jest.fn();
    render(<CancelSubscriptionModal {...baseProps} onSuccess={onSuccess} />);

    startCancellation();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("transaction-hash"));
    expect(mockSubmitCancel).toHaveBeenCalledWith(
      { subscriber: "Gsubscriber", merchant: "Gmerchant" },
      "Ccontract",
      "Gsubscriber",
      "Test Network",
      "https://rpc.example.test",
    );
  });

  it("announces pending state and prevents dismissal until submission settles", async () => {
    let resolveSubmission!: (value: { txHash: string }) => void;
    mockSubmitCancel.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmission = resolve;
      }),
    );
    const onClose = jest.fn();
    render(<CancelSubscriptionModal {...baseProps} onClose={onClose} />);

    startCancellation();

    expect(screen.getByRole("status")).toHaveTextContent(/cancellation pending/i);
    expect(screen.getByRole("alertdialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /keep subscription/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /close modal/i })).toBeDisabled();

    resolveSubmission({ txHash: "transaction-hash" });
    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveAttribute("aria-busy", "false"));
  });

  it("restores an active, retryable state and hides raw server details on rejection", async () => {
    const rawFailure = "RPC rejected request with private-key-material";
    mockSubmitCancel.mockRejectedValue(new Error(rawFailure));
    render(<CancelSubscriptionModal {...baseProps} />);

    startCancellation();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/subscription is still active/i);
    expect(alert).not.toHaveTextContent(rawFailure);
    expect(screen.getByRole("button", { name: "Cancel Subscription" })).toBeEnabled();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("does not submit from a wallet that differs from the subscriber", () => {
    render(
      <CancelSubscriptionModal
        {...baseProps}
        subscriberAddress="Gdifferent-subscriber"
      />,
    );

    startCancellation();

    expect(mockSubmitCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/does not match this subscription/i);
  });

  it("closes without submitting when the user keeps the subscription", () => {
    const onClose = jest.fn();
    render(<CancelSubscriptionModal {...baseProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /keep subscription/i }));

    expect(onClose).toHaveBeenCalled();
    expect(mockSubmitCancel).not.toHaveBeenCalled();
  });
});