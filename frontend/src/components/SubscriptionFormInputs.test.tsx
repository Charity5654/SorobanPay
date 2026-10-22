import React from "react";
import { render, screen } from "@testing-library/react";
import { SubscriptionFormInputs } from "@/components/SubscriptionFormInputs";

jest.mock("@/components/HelpTooltip", () => ({ HelpTooltip: () => null }));
jest.mock("@/components/TokenCombobox", () => ({
  TokenCombobox: ({ id }: { id: string }) => <input id={id} />,
}));

const baseProps = {
  merchantAddress: "",
  tokenAddress: "",
  amount: "",
  interval: "",
  fieldErrors: {},
  isDisabled: false,
  onMerchantChange: jest.fn(),
  onTokenChange: jest.fn(),
  onAmountChange: jest.fn(),
  onIntervalChange: jest.fn(),
};

describe("SubscriptionFormInputs error summary", () => {
  it("links announced errors to their fields and retains inline descriptions", () => {
    render(
      <SubscriptionFormInputs
        {...baseProps}
        fieldErrors={{
          merchantAddress: "Enter a valid merchant address.",
          amount: "Amount must be greater than zero.",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("There is a problem");
    expect(screen.getByRole("link", { name: /merchant address/i })).toHaveAttribute(
      "href",
      "#merchantAddress",
    );
    expect(screen.getByRole("link", { name: /amount/i })).toHaveAttribute(
      "href",
      "#amount",
    );
    expect(screen.getByLabelText(/merchant address/i)).toHaveAttribute(
      "aria-describedby",
      "help-merchant err-merchant",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("focuses the summary only when the owning form requests it", () => {
    const { rerender } = render(
      <SubscriptionFormInputs
        {...baseProps}
        fieldErrors={{ amount: "Amount must be greater than zero." }}
      />,
    );
    expect(screen.getByRole("alert")).not.toHaveFocus();

    rerender(
      <SubscriptionFormInputs
        {...baseProps}
        fieldErrors={{ amount: "Amount must be greater than zero." }}
        focusErrorSummaryRequest={1}
      />,
    );
    expect(screen.getByRole("alert")).toHaveFocus();
  });
});