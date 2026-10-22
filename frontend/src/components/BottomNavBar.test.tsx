import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BottomNavBar from './BottomNavBar';
import { SECTION_IDS } from '@/hooks/useKeyboardShortcuts';

const STORAGE_KEY = 'sorobanpay-mobile-nav-active';

class MockIntersectionObserver {
  observe = jest.fn();
  disconnect = jest.fn();
  unobserve = jest.fn();
  takeRecords = jest.fn(() => []);

  constructor(_callback: IntersectionObserverCallback) {}
}

function addNavigationSections() {
  Object.values(SECTION_IDS).forEach((id) => {
    const section = document.createElement('section');
    section.id = id;
    section.tabIndex = -1;
    section.scrollIntoView = jest.fn();
    document.body.append(section);
  });
}

describe('BottomNavBar', () => {
  const originalIntersectionObserver = global.IntersectionObserver;

  beforeEach(() => {
    window.sessionStorage.clear();
    global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
    addNavigationSections();
    window.scrollTo = jest.fn();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    document.querySelectorAll('section[id]').forEach((section) => section.remove());
    global.IntersectionObserver = originalIntersectionObserver;
    jest.restoreAllMocks();
  });

  it('persists the selected section and restores it after remount', async () => {
    const firstRender = render(<BottomNavBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe('subscribe');
    firstRender.unmount();

    render(<BottomNavBar />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Subscribe' })).toHaveAttribute('aria-current', 'page');
    });
  });

  it('falls back to Home for an invalid saved item and remains keyboard operable', async () => {
    window.sessionStorage.setItem(STORAGE_KEY, 'not-a-navigation-item');
    const user = userEvent.setup();
    render(<BottomNavBar />);

    const nav = screen.getByRole('navigation', { name: /mobile navigation/i });
    expect(nav).toHaveClass('flex', 'md:hidden');
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe('home');
  });

  it('uses non-animated scrolling when reduced motion is preferred', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: true }),
    });
    render(<BottomNavBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));

    expect(document.getElementById(SECTION_IDS.subscriptionForm)?.scrollIntoView)
      .toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('keeps selection responsive if a target section is missing', () => {
    document.getElementById(SECTION_IDS.dashboard)?.remove();
    render(<BottomNavBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));

    expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe('dashboard');
  });
});