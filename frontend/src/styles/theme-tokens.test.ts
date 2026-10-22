import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stylesheet = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');

function readTokens(selector: ':root' | '.dark'): Record<string, [number, number, number]> {
  const pattern = selector === ':root' ? /:root\s*\{([^}]*)\}/ : /\.dark\s*\{([^}]*)\}/;
  const block = stylesheet.match(pattern);
  if (!block) {
    throw new Error(`Missing theme token block: ${selector}`);
  }

  return Object.fromEntries(
    Array.from(block[1].matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g), (match) => [
      match[1],
      [Number(match[2]), Number(match[3]), Number(match[4])] as [number, number, number],
    ]),
  );
}

function luminance([red, green, blue]: [number, number, number]): number {
  const linearize = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function contrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function meetsContrast(actual: number, minimum: number): boolean {
  return actual >= minimum;
}

const modes: Array<[string, ':root' | '.dark']> = [
  ['light', ':root'],
  ['dark', '.dark'],
];

describe('semantic theme contrast tokens', () => {
  it.each(modes)('%s mode keeps normal text readable on its base surface', (_mode, selector) => {
    const tokens = readTokens(selector);
    const background = tokens['surface-base'];

    for (const token of ['content-primary', 'content-secondary', 'content-tertiary', 'content-disabled']) {
      expect(contrastRatio(tokens[token], background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ['success', 'success'],
    ['error', 'error'],
    ['warning', 'warning'],
    ['info', 'info'],
  ])('%s text meets AA against its status surface in both themes', (_label, status) => {
    for (const [, selector] of modes) {
      const tokens = readTokens(selector);
      expect(
        contrastRatio(tokens[`status-${status}-text`], tokens[`status-${status}-surface`]),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses focus and action colors with sufficient boundary and label contrast', () => {
    for (const [, selector] of modes) {
      const tokens = readTokens(selector);
      expect(contrastRatio(tokens['interactive-focus'], tokens['surface-base'])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio([255, 255, 255], tokens['interactive-primary'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio([255, 255, 255], tokens['interactive-destructive'])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('rejects failing contrast and accepts the WCAG thresholds', () => {
    expect(meetsContrast(contrastRatio([119, 119, 119], [255, 255, 255]), 4.5)).toBe(false);
    expect(meetsContrast(4.5, 4.5)).toBe(true);
    expect(meetsContrast(4.49, 4.5)).toBe(false);
    expect(meetsContrast(3, 3)).toBe(true);
    expect(meetsContrast(2.99, 3)).toBe(false);
  });

  it('keeps a readable palette available when switching between themes', () => {
    const lightTokens = readTokens(':root');
    const darkTokens = readTokens('.dark');

    expect(contrastRatio(lightTokens['content-primary'], lightTokens['surface-base'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkTokens['content-primary'], darkTokens['surface-base'])).toBeGreaterThanOrEqual(4.5);
    expect(lightTokens['content-primary']).not.toEqual(darkTokens['content-primary']);
  });
});