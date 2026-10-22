import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/tests/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Some transitive dependencies of @stellar/stellar-sdk ship as pure ESM
  // (e.g. @noble/hashes, @noble/curves, @scure/*).  ts-jest needs to
  // transform them so they work in the CommonJS Jest runtime.
  transformIgnorePatterns: [
    'node_modules/(?!(@noble|@scure|@stellar/stellar-base)/)',
  ],
};

export default config;
