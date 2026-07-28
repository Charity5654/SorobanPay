import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SorobanPay — Decentralized Recurring Payments on Stellar',
  description:
    'Non-custodial, permissionless subscription and recurring payment protocol built on Stellar Soroban. SEP-41 compatible. No custodians, no pre-signed arrays.',
};

// ─── Shared class helpers ──────────────────────────────────────────────────────
const SECTION = 'py-20 px-4 sm:px-8';
const CONTAINER = 'mx-auto max-w-6xl';

// ─── Navigation ───────────────────────────────────────────────────────────────
function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-800/60 bg-gray-950/90 backdrop-blur-md">
      <nav
        className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-8"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
        >
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-black"
            aria-hidden="true"
          >
            S
          </span>
          SorobanPay
        </Link>

        {/* Desktop links */}
        <ul className="hidden items-center gap-6 text-sm font-medium text-gray-400 sm:flex" role="list">
          <li>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How it works
            </a>
          </li>
          <li>
            <a href="#features" className="hover:text-white transition-colors">
              Features
            </a>
          </li>
          <li>
            <a href="#use-cases" className="hover:text-white transition-colors">
              Use cases
            </a>
          </li>
          <li>
            <a href="#developer" className="hover:text-white transition-colors">
              Developer
            </a>
          </li>
        </ul>

        {/* CTA */}
        <Link
          href="/app"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Launch App →
        </Link>
      </nav>
    </header>
  );
}

// ─── Section 1: Hero ──────────────────────────────────────────────────────────
function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden bg-gray-950 px-4 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28"
    >
      {/* Background gradient blobs */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-indigo-600/10 blur-3xl"
        aria-hidden="true"
      />

      <div className={`${CONTAINER} relative text-center`}>
        {/* Badge */}
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-blue-300">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />
          Built on Stellar Soroban
        </span>

        {/* Headline */}
        <h1
          id="hero-heading"
          className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl"
        >
          Recurring payments on Stellar —{' '}
          <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            non-custodial, on-chain.
          </span>
        </h1>

        {/* Subheadline */}
        <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-400 leading-relaxed">
          SorobanPay enables SaaS billing, creator subscriptions, and recurring donations
          directly on Stellar. No custodial wallets, no pre-authorized transaction arrays —
          just smart contracts and SEP-41 tokens.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/app"
            className="w-full rounded-xl bg-blue-600 px-8 py-4 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:w-auto"
          >
            Get Started — Free
          </Link>
          <a
            href="https://github.com/Chrisland58/SorobanPay"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-xl border border-gray-700 px-8 py-4 text-sm font-bold text-gray-300 hover:border-gray-500 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:w-auto"
          >
            View on GitHub ↗
          </a>
        </div>

        {/* Trust badges */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-xs text-gray-600">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">🔒</span> Non-custodial
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">⚡</span> Permissionless
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">📖</span> Open source · MIT
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">🔗</span> SEP-41 compatible
          </span>
        </div>
      </div>
    </section>
  );
}

// ─── Section 2: How it works ──────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    {
      number: '01',
      emoji: '✍️',
      title: 'Subscribe',
      description:
        'Set your merchant address, token contract, amount, and interval. Sign once with Freighter — the contract does the rest.',
    },
    {
      number: '02',
      emoji: '⚡',
      title: 'Payments run automatically',
      description:
        'Merchants collect payments on-chain when the interval elapses. Tokens transfer directly subscriber → merchant. No custodians.',
    },
    {
      number: '03',
      emoji: '🔓',
      title: 'Cancel anytime',
      description:
        'Remove your subscription instantly with a single on-chain transaction. You stay in full control — always.',
    },
  ];

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      className={`${SECTION} bg-gray-900/50`}
    >
      <div className={CONTAINER}>
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-blue-400 font-semibold mb-3">
            How it works
          </p>
          <h2
            id="how-heading"
            className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl"
          >
            Recurring payments in 3 steps
          </h2>
          <p className="mt-4 text-gray-400 max-w-xl mx-auto">
            From wallet connection to on-chain subscription in under a minute.
          </p>
        </div>

        <div className="relative grid gap-6 sm:grid-cols-3">
          {/* Connector line — desktop only */}
          <div
            className="pointer-events-none absolute top-14 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] hidden h-px bg-gradient-to-r from-blue-600/40 via-blue-400/40 to-blue-600/40 sm:block"
            aria-hidden="true"
          />

          {steps.map((step, i) => (
            <div
              key={i}
              className="relative rounded-2xl border border-gray-800 bg-gray-900 p-6 text-center shadow-lg"
            >
              <div className="mb-4 flex items-center justify-center gap-3">
                <span className="text-3xl" aria-hidden="true">{step.emoji}</span>
                <span className="text-xs font-bold text-blue-500 tracking-widest">{step.number}</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section 3: Features ──────────────────────────────────────────────────────
function Features() {
  const features = [
    {
      icon: '🔒',
      title: 'Non-custodial',
      description:
        'No wallets held, no balances stored. Token transfers go directly subscriber → merchant via SEP-41. The contract never holds funds.',
    },
    {
      icon: '⚡',
      title: 'Permissionless',
      description:
        'Deploy to Soroban testnet in minutes. No gatekeepers, no approvals, no KYC. Open to any wallet with a Stellar address.',
    },
    {
      icon: '🔗',
      title: 'SEP-41 Compatible',
      description:
        'Works with any SEP-41 token: USDC, XLM, or custom tokens. Token allowances give subscribers fine-grained control.',
    },
    {
      icon: '📖',
      title: 'Open Source',
      description:
        'Fully auditable Rust smart contract with 95%+ test coverage. MIT licensed. Fork it, audit it, build on it.',
    },
  ];

  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className={`${SECTION} bg-gray-950`}
    >
      <div className={CONTAINER}>
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-blue-400 font-semibold mb-3">
            Features
          </p>
          <h2
            id="features-heading"
            className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl"
          >
            Built for the on-chain era
          </h2>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => (
            <div
              key={i}
              className="rounded-2xl border border-gray-800 bg-gray-900 p-6 hover:border-blue-800/60 transition-colors"
            >
              <div className="mb-4 text-3xl" aria-hidden="true">{f.icon}</div>
              <h3 className="text-base font-bold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section 4: Use cases ─────────────────────────────────────────────────────
function UseCases() {
  const cases = [
    {
      icon: '💼',
      title: 'SaaS billing',
      description:
        'Automate recurring SaaS subscriptions directly on-chain. Charge monthly or annually in any SEP-41 token.',
    },
    {
      icon: '🎨',
      title: 'Creator subscriptions',
      description:
        'Enable fans to support creators with automatic monthly payments. No payment processor fees, no intermediaries.',
    },
    {
      icon: '❤️',
      title: 'Recurring donations',
      description:
        'Set up monthly giving to nonprofits with full on-chain transparency. Every transfer is publicly verifiable.',
    },
  ];

  return (
    <section
      id="use-cases"
      aria-labelledby="usecases-heading"
      className={`${SECTION} bg-gray-900/40`}
    >
      <div className={CONTAINER}>
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-blue-400 font-semibold mb-3">
            Use cases
          </p>
          <h2
            id="usecases-heading"
            className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl"
          >
            What you can build
          </h2>
          <p className="mt-4 text-gray-400 max-w-xl mx-auto">
            Any recurring payment relationship — from $5/month to enterprise billing.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
          {cases.map((c, i) => (
            <div
              key={i}
              className="rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center hover:border-blue-800/60 transition-colors"
            >
              <div className="mb-4 text-4xl" aria-hidden="true">{c.icon}</div>
              <h3 className="text-lg font-bold text-white mb-3">{c.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{c.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section 5: Developer quickstart ─────────────────────────────────────────
function DeveloperQuickstart() {
  const snippet = `// Subscribe: 100 tokens every 30 days
import { Contract, nativeToScVal, Address } from "@stellar/stellar-sdk";

const op = contract.call(
  "subscribe",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
  new Address(tokenAddress).toScVal(),
  nativeToScVal(100n, { type: "i128" }),
  nativeToScVal(2592000n, { type: "u64" }),
);
// Expected: subscription stored on-chain, first payment
// collectable immediately, cancel anytime.`;

  return (
    <section
      id="developer"
      aria-labelledby="dev-heading"
      className={`${SECTION} bg-gray-950`}
    >
      <div className={CONTAINER}>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          {/* Text */}
          <div>
            <p className="text-xs uppercase tracking-widest text-blue-400 font-semibold mb-3">
              Developer
            </p>
            <h2
              id="dev-heading"
              className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl"
            >
              Integrate in minutes
            </h2>
            <p className="mt-4 text-gray-400 leading-relaxed">
              Deploy the Soroban contract to testnet, configure your frontend environment
              variables, and call <code className="rounded bg-gray-800 px-1.5 py-0.5 text-blue-300 text-sm">subscribe</code>{' '}
              from the TypeScript SDK. That&apos;s all.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-gray-400" role="list">
              {[
                'Rust/Soroban smart contract with 95%+ test coverage',
                'TypeScript SDK examples for all 3 entry points',
                'Full event schema for off-chain indexing',
                'Docker Compose local dev stack included',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 text-blue-400 flex-shrink-0" aria-hidden="true">✓</span>
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="https://github.com/Chrisland58/SorobanPay#quick-start-testnet-demo--5-minutes"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                Read the Docs ↗
              </a>
              <a
                href="https://github.com/Chrisland58/SorobanPay"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:border-gray-500 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                GitHub ↗
              </a>
            </div>
          </div>

          {/* Code snippet */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden shadow-xl">
            <div className="flex items-center gap-1.5 border-b border-gray-800 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-red-500/70" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/70" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-green-500/70" aria-hidden="true" />
              <span className="ml-2 text-xs text-gray-500">subscribe.ts</span>
            </div>
            <pre
              className="overflow-x-auto p-6 text-xs leading-relaxed text-gray-300 sm:text-sm"
              aria-label="TypeScript code example: subscribe call"
            >
              <code>{snippet}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section 6: CTA banner ────────────────────────────────────────────────────
function CTABanner() {
  return (
    <section
      aria-label="Get started call to action"
      className="relative overflow-hidden bg-blue-600 px-4 py-16 sm:px-8"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Start building today
        </h2>
        <p className="mt-4 text-blue-100 leading-relaxed">
          Deploy to Stellar testnet in under 5 minutes. Free, open source, and non-custodial.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/app"
            className="w-full rounded-xl bg-white px-8 py-4 text-sm font-bold text-blue-700 shadow-lg hover:bg-blue-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-auto"
          >
            Launch App →
          </Link>
          <a
            href="https://github.com/Chrisland58/SorobanPay"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-xl border border-white/40 px-8 py-4 text-sm font-bold text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-auto"
          >
            View Source ↗
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Section 6: Footer ────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-gray-950 px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 text-sm text-gray-500 sm:flex-row">
        <Link
          href="/"
          className="flex items-center gap-2 font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
        >
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white"
            aria-hidden="true"
          >
            S
          </span>
          SorobanPay
        </Link>

        <nav aria-label="Footer navigation">
          <ul className="flex flex-wrap items-center justify-center gap-6" role="list">
            <li>
              <a
                href="https://github.com/Chrisland58/SorobanPay"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                GitHub
              </a>
            </li>
            <li>
              <a
                href="https://github.com/Chrisland58/SorobanPay#quick-start-testnet-demo--5-minutes"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                Docs
              </a>
            </li>
            <li>
              <a
                href="https://github.com/Chrisland58/SorobanPay/blob/main/CHANGELOG.md"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                Changelog
              </a>
            </li>
            <li>
              <Link href="/app" className="hover:text-white transition-colors">
                Launch App
              </Link>
            </li>
          </ul>
        </nav>

        <p className="text-xs">© 2024 SorobanPay. MIT License.</p>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <UseCases />
        <DeveloperQuickstart />
        <CTABanner />
      </main>
      <Footer />
    </>
  );
}
