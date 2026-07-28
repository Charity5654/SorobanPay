/**
 * Jest mock for @react-pdf/renderer.
 *
 * @react-pdf/renderer ships as ESM and cannot be transformed by Jest in a
 * CommonJS test environment. This lightweight mock replaces the module so
 * tests that import SubscriptionReceipt (or any component that imports it)
 * don't fail with "SyntaxError: Cannot use import statement outside a module".
 *
 * The mock stubs out only the symbols used by SubscriptionReceipt.tsx.
 */

import React from 'react';

// Primitive components — render nothing in tests
export const Document = ({ children }: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);
export const Page = ({ children }: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);
export const View = ({ children }: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);
export const Text = ({ children }: { children?: React.ReactNode }) =>
  React.createElement('span', null, children);
export const Link = ({ children }: { children?: React.ReactNode }) =>
  React.createElement('a', null, children);
export const Image = () => null;

// StyleSheet.create is a pass-through in tests
export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
};

// pdf().toBlob() returns a minimal Blob
export const pdf = () => ({
  toBlob: async () => new Blob(['mock-pdf'], { type: 'application/pdf' }),
  toString: async () => 'mock-pdf-string',
  toBuffer: async () => Buffer.from('mock-pdf'),
  updateContainer: () => {},
});
