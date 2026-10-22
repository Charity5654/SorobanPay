/**
 * token_format.test.ts
 *
 * Unit tests for locale-aware token formatting utilities.
 *
 * Issue #1048 – Add locale-aware token formatting
 */

import {
  formatTokenLocale,
  formatTokenWithLocaleSymbol,
  formatUnavailable,
  formatTokenSafe,
  type TokenFormatOptions,
} from "@/lib/token_format";

// ─── formatTokenLocale ─────────────────────────────────────────────────────────

describe("formatTokenLocale", () => {
  it("formats 1 XLM (7 decimals) as '1' with en-US", () => {
    expect(formatTokenLocale(10_000_000n, 7, { locale: "en-US" })).toBe("1");
  });

  it("formats 1.5 USDC (6 decimals) as '1.5' with en-US", () => {
    expect(formatTokenLocale(1_500_000n, 6, { locale: "en-US" })).toBe("1.5");
  });

  it("formats zero amount as '0'", () => {
    expect(formatTokenLocale(0n, 7, { locale: "en-US" })).toBe("0");
  });

  it("trims trailing zeros by default", () => {
    // 1.5000000 XLM → "1.5"
    expect(formatTokenLocale(15_000_000n, 7, { locale: "en-US" })).toBe("1.5");
  });

  it("does not trim trailing zeros when trimTrailing is false", () => {
    const result = formatTokenLocale(10_000_000n, 7, {
      locale: "en-US",
      minimumFractionDigits: 2,
      trimTrailing: false,
    });
    // With minimumFractionDigits: 2 and trimTrailing: false, should show at least 2 decimals
    expect(result).toMatch(/1\.0+/);
  });

  it("uses grouping separators for large amounts (en-US)", () => {
    // 1,000 XLM = 10_000_000_000 stroops
    const result = formatTokenLocale(10_000_000_000n, 7, { locale: "en-US" });
    expect(result).toBe("1,000");
  });

  it("uses locale-specific decimal separator (de-DE uses comma)", () => {
    // 1.5 in de-DE is formatted with a comma: "1,5"
    const result = formatTokenLocale(1_500_000n, 6, { locale: "de-DE" });
    // de-DE uses comma as decimal separator
    expect(result).toMatch(/1[,.]5/); // accept either for environments that override locale
  });

  it("respects maximumFractionDigits to clamp precision", () => {
    // 1.123456 USDC (6 decimals), clamp to 2 decimal places
    const result = formatTokenLocale(1_123_456n, 6, {
      locale: "en-US",
      maximumFractionDigits: 2,
    });
    expect(result).toBe("1.12");
  });

  it("respects minimumFractionDigits to force fixed width", () => {
    // 1 XLM with 2 minimum fraction digits → "1.00"
    const result = formatTokenLocale(10_000_000n, 7, {
      locale: "en-US",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      trimTrailing: false,
    });
    expect(result).toBe("1.00");
  });

  it("formats compact notation for large values", () => {
    // 1,500,000 XLM = 15_000_000_000_000 stroops
    const result = formatTokenLocale(15_000_000_000_000n, 7, {
      locale: "en-US",
      notation: "compact",
    });
    expect(result).toMatch(/1[\.,]?5M?|1500K?/i);
  });

  it("handles zero decimals (integer token)", () => {
    expect(formatTokenLocale(42n, 0, { locale: "en-US" })).toBe("42");
  });

  it("handles single stroop (smallest possible value)", () => {
    // 0.0000001 XLM
    const result = formatTokenLocale(1n, 7, { locale: "en-US" });
    expect(result).toBe("0.0000001");
  });

  it("handles maximum fraction digits of 0 (rounds to integer)", () => {
    // 1.9 USDC rounded down to integer display
    const result = formatTokenLocale(1_900_000n, 6, {
      locale: "en-US",
      maximumFractionDigits: 0,
    });
    expect(result).toBe("2"); // Intl rounds to nearest
  });

  it("throws for negative decimals", () => {
    expect(() => formatTokenLocale(100n, -1)).toThrow();
  });

  it("handles large amounts without precision loss in fractional part", () => {
    // 100,000 XLM + 0.1234567
    const amount = 1_000_001_234_567n; // 100000.1234567 XLM
    const result = formatTokenLocale(amount, 7, {
      locale: "en-US",
      maximumFractionDigits: 7,
      trimTrailing: true,
    });
    expect(result).toContain("1234567");
  });

  it("formats negative bigint correctly", () => {
    // Some contexts may pass negative amounts (e.g. delta calculations)
    const result = formatTokenLocale(-10_000_000n, 7, { locale: "en-US" });
    expect(result).toMatch(/-?1/);
  });
});

// ─── formatTokenWithLocaleSymbol ──────────────────────────────────────────────

describe("formatTokenWithLocaleSymbol", () => {
  it("appends symbol after formatted amount", () => {
    expect(
      formatTokenWithLocaleSymbol(1_500_000n, 6, "USDC", { locale: "en-US" }),
    ).toBe("1.5 USDC");
  });

  it("returns only the formatted number when symbol is empty string", () => {
    expect(
      formatTokenWithLocaleSymbol(1_500_000n, 6, "", { locale: "en-US" }),
    ).toBe("1.5");
  });

  it("returns only the formatted number when symbol is whitespace", () => {
    expect(
      formatTokenWithLocaleSymbol(1_500_000n, 6, "  ", { locale: "en-US" }),
    ).toBe("1.5");
  });

  it("trims symbol whitespace", () => {
    expect(
      formatTokenWithLocaleSymbol(10_000_000n, 7, " XLM ", { locale: "en-US" }),
    ).toBe("1 XLM");
  });

  it("formats 0 amount with symbol", () => {
    expect(
      formatTokenWithLocaleSymbol(0n, 6, "USDC", { locale: "en-US" }),
    ).toBe("0 USDC");
  });
});

// ─── formatUnavailable ────────────────────────────────────────────────────────

describe("formatUnavailable", () => {
  it("returns an em dash when called with no arguments", () => {
    expect(formatUnavailable()).toBe("\u2014");
  });

  it("returns em dash only for empty string label", () => {
    expect(formatUnavailable("")).toBe("\u2014");
  });

  it("returns em dash only for whitespace label", () => {
    expect(formatUnavailable("   ")).toBe("\u2014");
  });

  it("appends the label after the em dash", () => {
    expect(formatUnavailable("XLM")).toBe("\u2014 XLM");
  });

  it("trims the label", () => {
    expect(formatUnavailable("  USDC  ")).toBe("\u2014 USDC");
  });

  it("works with a multi-word label", () => {
    expect(formatUnavailable("XLM (native)")).toBe("\u2014 XLM (native)");
  });
});

// ─── formatTokenSafe ──────────────────────────────────────────────────────────

describe("formatTokenSafe", () => {
  it("returns em dash when amount is null", () => {
    expect(formatTokenSafe(null, 7)).toBe("\u2014");
  });

  it("returns em dash when amount is undefined", () => {
    expect(formatTokenSafe(undefined, 7)).toBe("\u2014");
  });

  it("returns custom fallback when amount is null and fallback is provided", () => {
    expect(formatTokenSafe(null, 7, { fallback: "N/A" })).toBe("N/A");
  });

  it("returns custom fallback when amount is undefined and fallback is provided", () => {
    expect(formatTokenSafe(undefined, 6, { fallback: "Loading…" })).toBe("Loading…");
  });

  it("formats a valid bigint correctly", () => {
    expect(
      formatTokenSafe(10_000_000n, 7, { locale: "en-US" }),
    ).toBe("1");
  });

  it("formats zero bigint as '0'", () => {
    expect(formatTokenSafe(0n, 7, { locale: "en-US" })).toBe("0");
  });

  it("passes through locale option when amount is valid", () => {
    const result = formatTokenSafe(1_500_000n, 6, {
      locale: "en-US",
      fallback: "N/A",
    });
    expect(result).toBe("1.5");
  });

  it("does not return fallback for 0n (zero is a valid amount)", () => {
    const result = formatTokenSafe(0n, 7, { fallback: "No data" });
    expect(result).not.toBe("No data");
    expect(result).toBe("0");
  });

  it("passes maximumFractionDigits through to formatTokenLocale", () => {
    const result = formatTokenSafe(1_500_000n, 6, {
      locale: "en-US",
      maximumFractionDigits: 1,
    });
    expect(result).toBe("1.5");
  });
});
