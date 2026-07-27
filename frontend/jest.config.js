/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/lib'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', target: 'ES2020' } }],
  },

  // Coverage settings (Issue #433 — >80% for frontend code)
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/test-utils/**',
    '!src/app/layout.tsx',
    '!src/app/globals.css',
    '!**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',

  // Component tests (TSX files) require a browser-like DOM environment
  projects: [
    {
      displayName: 'components',
      testEnvironment: 'jsdom',
      testMatch: ['**/*.test.tsx'],
      preset: 'ts-jest',
      roots: ['<rootDir>/src'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', target: 'ES2020' } }],
      },
    },
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['**/*.test.ts'],
      preset: 'ts-jest',
      roots: ['<rootDir>/src', '<rootDir>/lib'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', target: 'ES2020' } }],
      },
    },
  ],
};

module.exports = config;
