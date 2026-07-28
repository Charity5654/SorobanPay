/** @type {import('jest').Config} */

// @react-pdf/renderer and its dependencies ship as ESM. Jest's CommonJS
// transformer skips node_modules by default, so we need to allow ts-jest
// to transform those packages. List every ESM-only package that ts-jest
// must process.
const ESM_PACKAGES = [
  '@react-pdf/renderer',
  '@react-pdf/primitives',
  '@react-pdf/font',
  '@react-pdf/image',
  '@react-pdf/layout',
  '@react-pdf/pdfkit',
  '@react-pdf/stylesheet',
  '@react-pdf/types',
  '@react-pdf/fns',
  '@react-pdf/textkit',
  'yoga-wasm-web',
].join('|');

// transformIgnorePatterns: ignore everything in node_modules EXCEPT the
// packages listed in ESM_PACKAGES.
const transformIgnorePatterns = [
  `[/\\\\]node_modules[/\\\\](?!(${ESM_PACKAGES})[/\\\\]).+\\.js$`,
];

const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/lib'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Mock @react-pdf/renderer for tests — the PDF renderer is not meaningful
    // in a jsdom/node environment; all PDF generation is tested end-to-end in
    // the browser. Mocking prevents ESM transform errors in the test runner.
    '@react-pdf/renderer': '<rootDir>/src/__mocks__/@react-pdf/renderer.tsx',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', target: 'ES2020' } }],
  },
  transformIgnorePatterns,

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
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '@react-pdf/renderer': '<rootDir>/src/__mocks__/@react-pdf/renderer.tsx',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', target: 'ES2020' } }],
      },
      transformIgnorePatterns,
    },
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['**/*.test.ts'],
      preset: 'ts-jest',
      roots: ['<rootDir>/src', '<rootDir>/lib'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '@react-pdf/renderer': '<rootDir>/src/__mocks__/@react-pdf/renderer.tsx',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', target: 'ES2020' } }],
      },
      transformIgnorePatterns,
    },
  ],
};

module.exports = config;
