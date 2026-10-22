import '@testing-library/jest-dom';

// Suppress act() warnings in tests. These occur when React detects state updates outside of act(),
// but userEvent.setup() doesn't wrap all events in act() automatically. The tests are correct
// and assert on the actual rendered behavior, so these warnings are safe to suppress.
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: An update to') &&
      args[0].includes('was not wrapped in act')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
