import { fireEvent, render, screen, within } from "@testing-library/react";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { KnownToken } from "@/constants/known-tokens";

const TOKENS: KnownToken[] = [
  {
    symbol: "AUSD",
    name: "Anchor Dollar",
    contract: "C" + "A".repeat(55),
    issuer: "G" + "A".repeat(55),
    decimals: 7,
    description: "Dollar token",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    contract: "C" + "B".repeat(55),
    issuer: "G" + "B".repeat(55),
    decimals: 7,
    description: "Circle token",
  },
];

function renderCombobox(value = "", onChange = jest.fn()) {
  render(
    <TokenCombobox
      id="token-contract"
      value={value}
      onChange={onChange}
      tokens={TOKENS}
    />,
  );
  return {
    input: screen.getByRole("combobox"),
    onChange,
  };
}

describe("TokenCombobox search", () => {
  it("ranks ticker prefixes ahead of weaker substring matches", () => {
    const { input } = renderCombobox();
    fireEvent.change(input, { target: { value: "usd" } });

    const options = screen.getAllByRole("option");
    expect(within(options[0]).getByText("USDC")).toBeInTheDocument();
    expect(within(options[1]).getByText("AUSD")).toBeInTheDocument();
  });

  it("matches descriptions and contract prefixes without case sensitivity", () => {
    const { input } = renderCombobox();

    fireEvent.change(input, { target: { value: "CIRCLE" } });
    expect(screen.getByRole("option", { name: /USDC/ })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "cbbbb" } });
    expect(screen.getByRole("option", { name: /USDC/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /AUSD/ })).not.toBeInTheDocument();
  });

  it("selects a match by keyboard and recovers from an empty result", () => {
    const onChange = jest.fn();
    const { input } = renderCombobox("", onChange);
    fireEvent.change(input, { target: { value: "not-a-token" } });

    expect(screen.getByRole("status")).toHaveTextContent(/No known tokens match/i);
    expect(screen.getByRole("option", { name: /Custom address/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "usdc" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenLastCalledWith(TOKENS[1].contract);
    expect(input).toHaveValue(TOKENS[1].contract);
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});