'use client';

/**
 * BottomNavBar.tsx
 *
 * Mobile-only bottom navigation bar (UX-114).
 * Visible on screens < md (768px). Hidden on desktop where a top header
 * or sidebar handles navigation.
 *
 * Touch targets are >= 44px per WCAG 2.5.5.
 * Positioned above the toast container (z-40).
 */

import { useEffect, useState } from 'react';
import { SECTION_IDS } from '@/hooks/useKeyboardShortcuts';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  sectionId: string;
  ariaKeyshortcut?: string;
}

function HomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
    </svg>
  );
}

function SubscribeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
    </svg>
  );
}

function MerchantIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
      <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: <HomeIcon />,
    sectionId: 'top',
    ariaKeyshortcut: undefined,
  },
  {
    id: 'subscribe',
    label: 'Subscribe',
    icon: <SubscribeIcon />,
    sectionId: SECTION_IDS.subscriptionForm,
    ariaKeyshortcut: 'n',
  },
  {
    id: 'history',
    label: 'History',
    icon: <HistoryIcon />,
    sectionId: SECTION_IDS.paymentHistory,
    ariaKeyshortcut: 'h',
  },
  {
    id: 'merchant',
    label: 'Merchant',
    icon: <MerchantIcon />,
    sectionId: SECTION_IDS.merchantPortal,
    ariaKeyshortcut: 'm',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <DashboardIcon />,
    sectionId: SECTION_IDS.dashboard,
    ariaKeyshortcut: 'd',
  },
];

export default function BottomNavBar() {
  const [active, setActive] = useState('home');

  // Track which section is in view via IntersectionObserver
  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    NAV_ITEMS.forEach((item) => {
      if (item.sectionId === 'top') return;
      const el = document.getElementById(item.sectionId);
      if (!el) return;

      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActive(item.id);
        },
        { rootMargin: '-40% 0px -40% 0px', threshold: 0 },
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  function handleNav(item: NavItem) {
    setActive(item.id);
    if (item.sectionId === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = document.getElementById(item.sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.focus({ preventScroll: true });
    }
  }

  return (
    <nav
      aria-label="Mobile navigation"
      className="
        fixed bottom-0 inset-x-0 z-40
        flex md:hidden
        bg-white/95 dark:bg-gray-900/95 backdrop-blur-md
        border-t border-gray-200/60 dark:border-gray-700/60
        safe-area-inset-bottom
      "
    >
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleNav(item)}
            aria-current={isActive ? 'page' : undefined}
            aria-keyshortcuts={item.ariaKeyshortcut}
            className={`
              flex-1 flex flex-col items-center justify-center gap-1
              py-2 px-1
              min-h-[56px] min-w-[44px]
              text-xs font-medium
              transition-colors duration-150
              focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400
              ${isActive
                ? 'text-blue-500 dark:text-blue-400'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 active:text-gray-900 dark:active:text-gray-200'}
            `}
          >
            <span className={`transition-transform duration-150 ${isActive ? 'scale-110' : ''}`}>
              {item.icon}
            </span>
            <span>{item.label}</span>
            {isActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 bg-blue-400 rounded-full" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
