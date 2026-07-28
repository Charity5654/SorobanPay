#!/usr/bin/env ts-node
/**
 * Gas Estimation Test Harness — TEST-100
 *
 * Simulates every entry point of the SubscriptionProtocol contract and captures:
 *   - CPU instructions
 *   - Read bytes
 *   - Write bytes
 *   - Minimum resource fee (in stroops)
 *
 * Compares measurements against the committed baseline in docs/performance-baseline.json.
 * Fails (exit code 1) if any metric exceeds baseline by more than REGRESSION_THRESHOLD.
 *
 * Outputs a Markdown table with current vs. baseline values.
 *
 * Usage:
 *   # Run regression check (default)
 *   npx ts-node scripts/gas-estimation-test.ts
 *
 *   # Update baseline
 *   npm run update-baseline
 *
 * Required environment variables:
 *   RPC_URL          - Soroban RPC endpoint (e.g. https://soroban-testnet.stellar.org)
 *   CONTRACT_ID      - Deployed contract address (C...)
 *   SUBSCRIBER_KEY   - Subscriber secret key (S...)
 *   MERCHANT_KEY     - Merchant secret key (S...)
 *   TOKEN_ADDRESS    - SEP-41 token contract address (C...)
 *   NETWORK_PASSPHRASE - Stellar network passphrase
 *
 * Performance docs: SC-23 / README.md §Transaction fees and execution budgets
 */

import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  nativeToScVal,
  Address,
  BASE_FEE,
  xdr,
} from "@stellar/stellar-sdk";
import * as fs from "fs";
import * as path from "path";

// ─── Configuration ────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID || "";
const SUBSCRIBER_KEY = process.env.SUBSCRIBER_KEY || "";
const MERCHANT_KEY = process.env.MERCHANT_KEY || "";
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

/** Fail the test if any metric exceeds baseline by more than this fraction. */
const REGRESSION_THRESHOLD = 0.20; // 20%

/** Path to the committed baseline file. */
const BASELINE_PATH = path.resolve(__dirname, "../docs/performance-baseline.json");

/** Whether to update the baseline instead of checking against it. */
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

// ─── Types ────────────────────────────────────────────────────────────────────

interface EntryPointMetrics {
  /** Number of CPU instructions consumed. */
  instructions: number;
  /** Number of bytes read from ledger. */
  readBytes: number;
  /** Number of bytes written to ledger. */
  writeBytes: number;
  /** Minimum resource fee in stroops. */
  minResourceFee: number;
}

interface PerformanceBaseline {
  /** ISO timestamp of when the baseline was captured. */
  capturedAt: string;
  /** Git commit SHA at capture time (if available). */
  gitCommit?: string;
  /** Metrics per entry point. */
  entryPoints: {
    subscribe: EntryPointMetrics;
    execute_payment: EntryPointMetrics;
    cancel: EntryPointMetrics;
  };
}

interface RegressionResult {
  entryPoint: string;
  metric: keyof EntryPointMetrics;
  baseline: number;
  current: number;
  /** Ratio: current / baseline. 1.20 means 20% over baseline. */
  ratio: number;
  passed: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return val;
}

async function loadAccount(
  server: SorobanRpc.Server,
  keypair: Keypair
): Promise<ReturnType<typeof server.getAccount>> {
  return server.getAccount(keypair.publicKey());
}

/**
 * Build a transaction, simulate it, and return the resource usage metrics.
 */
async function simulateOperation(
  server: SorobanRpc.Server,
  account: Awaited<ReturnType<typeof loadAccount>>,
  keypair: Keypair,
  operations: xdr.Operation[],
  networkPassphrase: string
): Promise<EntryPointMetrics> {
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .setTimeout(300);

  for (const op of operations) {
    tx.addOperation(op);
  }

  const builtTx = tx.build();

  const simResult = await server.simulateTransaction(builtTx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(
      `Simulation failed: ${simResult.error}\nEvents: ${JSON.stringify(simResult.events)}`
    );
  }

  if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
    throw new Error(`Unexpected simulation result: ${JSON.stringify(simResult)}`);
  }

  const resources = simResult.transactionData.resources();
  return {
    instructions: resources.instructions(),
    readBytes: resources.readBytes(),
    writeBytes: resources.writeBytes(),
    minResourceFee: parseInt(simResult.minResourceFee, 10),
  };
}

// ─── Simulation: subscribe ────────────────────────────────────────────────────

async function simulateSubscribe(
  server: SorobanRpc.Server,
  contract: Contract,
  subscriberKeypair: Keypair,
  merchantAddress: string,
  tokenAddress: string,
  networkPassphrase: string
): Promise<EntryPointMetrics> {
  const account = await loadAccount(server, subscriberKeypair);

  const op = contract.call(
    "subscribe",
    new Address(subscriberKeypair.publicKey()).toScVal(),
    new Address(merchantAddress).toScVal(),
    new Address(tokenAddress).toScVal(),
    nativeToScVal(1_000_000n, { type: "i128" }),     // 1 USDC (6 decimals)
    nativeToScVal(2_592_000n, { type: "u64" })        // 30 days in seconds
  );

  return simulateOperation(
    server,
    account,
    subscriberKeypair,
    [op],
    networkPassphrase
  );
}

// ─── Simulation: execute_payment ─────────────────────────────────────────────

async function simulateExecutePayment(
  server: SorobanRpc.Server,
  contract: Contract,
  merchantKeypair: Keypair,
  subscriberAddress: string,
  networkPassphrase: string
): Promise<EntryPointMetrics> {
  const account = await loadAccount(server, merchantKeypair);

  const op = contract.call(
    "execute_payment",
    new Address(subscriberAddress).toScVal(),
    new Address(merchantKeypair.publicKey()).toScVal()
  );

  return simulateOperation(
    server,
    account,
    merchantKeypair,
    [op],
    networkPassphrase
  );
}

// ─── Simulation: cancel ───────────────────────────────────────────────────────

async function simulateCancel(
  server: SorobanRpc.Server,
  contract: Contract,
  subscriberKeypair: Keypair,
  merchantAddress: string,
  networkPassphrase: string
): Promise<EntryPointMetrics> {
  const account = await loadAccount(server, subscriberKeypair);

  const op = contract.call(
    "cancel",
    new Address(subscriberKeypair.publicKey()).toScVal(),
    new Address(merchantAddress).toScVal()
  );

  return simulateOperation(
    server,
    account,
    subscriberKeypair,
    [op],
    networkPassphrase
  );
}

// ─── Baseline management ─────────────────────────────────────────────────────

function loadBaseline(): PerformanceBaseline | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as PerformanceBaseline;
  } catch {
    return null;
  }
}

function saveBaseline(metrics: Record<string, EntryPointMetrics>): void {
  const gitCommit = (() => {
    try {
      return require("child_process")
        .execSync("git rev-parse --short HEAD", { encoding: "utf8" })
        .trim() as string;
    } catch {
      return undefined;
    }
  })();

  const baseline: PerformanceBaseline = {
    capturedAt: new Date().toISOString(),
    gitCommit,
    entryPoints: {
      subscribe: metrics["subscribe"],
      execute_payment: metrics["execute_payment"],
      cancel: metrics["cancel"],
    },
  };

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  console.log(`✅  Baseline saved to ${BASELINE_PATH}`);
}

// ─── Regression check ─────────────────────────────────────────────────────────

function checkRegressions(
  current: Record<string, EntryPointMetrics>,
  baseline: PerformanceBaseline
): RegressionResult[] {
  const results: RegressionResult[] = [];
  const entryPoints = ["subscribe", "execute_payment", "cancel"] as const;
  const metricKeys: (keyof EntryPointMetrics)[] = [
    "instructions",
    "readBytes",
    "writeBytes",
    "minResourceFee",
  ];

  for (const ep of entryPoints) {
    for (const metric of metricKeys) {
      const baselineVal = baseline.entryPoints[ep][metric];
      const currentVal = current[ep][metric];
      const ratio = baselineVal === 0 ? 1 : currentVal / baselineVal;
      results.push({
        entryPoint: ep,
        metric,
        baseline: baselineVal,
        current: currentVal,
        ratio,
        passed: ratio <= 1 + REGRESSION_THRESHOLD,
      });
    }
  }
  return results;
}

// ─── Markdown table ───────────────────────────────────────────────────────────

function renderMarkdownTable(
  current: Record<string, EntryPointMetrics>,
  baseline: PerformanceBaseline | null,
  regressions: RegressionResult[]
): string {
  const regressionMap = new Map<string, RegressionResult>();
  for (const r of regressions) {
    regressionMap.set(`${r.entryPoint}:${r.metric}`, r);
  }

  const rows: string[] = [];
  rows.push(
    "| Entry Point | Instructions | Read Bytes | Write Bytes | Min Fee (stroops) |"
  );
  rows.push("|-------------|-------------|-----------|------------|------------------|");

  const entryPoints = ["subscribe", "execute_payment", "cancel"] as const;

  for (const ep of entryPoints) {
    const c = current[ep];
    const b = baseline?.entryPoints[ep];

    function fmt(
      metric: keyof EntryPointMetrics,
      val: number,
      baseVal?: number
    ): string {
      const r = regressionMap.get(`${ep}:${metric}`);
      const pct = baseVal ? ` (${((val / baseVal - 1) * 100).toFixed(1)}%)` : "";
      const flag = r && !r.passed ? " ⚠️" : "";
      return `${val.toLocaleString()}${pct}${flag}`;
    }

    rows.push(
      `| \`${ep}\` ` +
        `| ${fmt("instructions", c.instructions, b?.instructions)} ` +
        `| ${fmt("readBytes", c.readBytes, b?.readBytes)} ` +
        `| ${fmt("writeBytes", c.writeBytes, b?.writeBytes)} ` +
        `| ${fmt("minResourceFee", c.minResourceFee, b?.minResourceFee)} |`
    );

    if (b) {
      rows.push(
        `| *(baseline)* ` +
          `| ${b.instructions.toLocaleString()} ` +
          `| ${b.readBytes.toLocaleString()} ` +
          `| ${b.writeBytes.toLocaleString()} ` +
          `| ${b.minResourceFee.toLocaleString()} |`
      );
    }
  }

  return rows.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate required env vars when actually connecting to a real network
  if (!UPDATE_BASELINE || process.env.CI) {
    if (!CONTRACT_ID) {
      throw new Error("CONTRACT_ID environment variable is required.");
    }
    if (!SUBSCRIBER_KEY) {
      throw new Error("SUBSCRIBER_KEY environment variable is required.");
    }
    if (!MERCHANT_KEY) {
      throw new Error("MERCHANT_KEY environment variable is required.");
    }
    if (!TOKEN_ADDRESS) {
      throw new Error("TOKEN_ADDRESS environment variable is required.");
    }
  }

  const server = new SorobanRpc.Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);
  const subscriberKeypair = Keypair.fromSecret(SUBSCRIBER_KEY);
  const merchantKeypair = Keypair.fromSecret(MERCHANT_KEY);

  console.log("🔬  SorobanPay Gas Estimation Harness — TEST-100");
  console.log(`    RPC:      ${RPC_URL}`);
  console.log(`    Contract: ${CONTRACT_ID}`);
  console.log(`    Network:  ${NETWORK_PASSPHRASE}`);
  console.log("");

  // ── Run simulations ────────────────────────────────────────────────────────

  console.log("⏳  Simulating subscribe ...");
  const subscribeMetrics = await simulateSubscribe(
    server,
    contract,
    subscriberKeypair,
    merchantKeypair.publicKey(),
    TOKEN_ADDRESS,
    NETWORK_PASSPHRASE
  );

  console.log("⏳  Simulating execute_payment ...");
  const executePaymentMetrics = await simulateExecutePayment(
    server,
    contract,
    merchantKeypair,
    subscriberKeypair.publicKey(),
    NETWORK_PASSPHRASE
  );

  console.log("⏳  Simulating cancel ...");
  const cancelMetrics = await simulateCancel(
    server,
    contract,
    subscriberKeypair,
    merchantKeypair.publicKey(),
    NETWORK_PASSPHRASE
  );

  const current: Record<string, EntryPointMetrics> = {
    subscribe: subscribeMetrics,
    execute_payment: executePaymentMetrics,
    cancel: cancelMetrics,
  };

  // ── Update baseline mode ───────────────────────────────────────────────────

  if (UPDATE_BASELINE) {
    saveBaseline(current);
    const table = renderMarkdownTable(current, null, []);
    console.log("\n## Current Metrics\n");
    console.log(table);
    return;
  }

  // ── Regression check mode ──────────────────────────────────────────────────

  const baseline = loadBaseline();
  if (!baseline) {
    console.warn(
      "⚠️   No baseline found at docs/performance-baseline.json.\n" +
        "    Run `npm run update-baseline` to create an initial baseline.\n" +
        "    Skipping regression check."
    );
    const table = renderMarkdownTable(current, null, []);
    console.log("\n## Current Metrics (no baseline)\n");
    console.log(table);
    return;
  }

  const regressions = checkRegressions(current, baseline);
  const failures = regressions.filter((r) => !r.passed);

  // ── Render Markdown table ──────────────────────────────────────────────────

  const table = renderMarkdownTable(current, baseline, regressions);

  // Write to file for CI artifact upload
  const reportPath = path.resolve(__dirname, "../gas-estimation-report.md");
  const reportContent =
    `# Gas Estimation Report — TEST-100\n\n` +
    `Generated: ${new Date().toISOString()}\n` +
    `Baseline captured: ${baseline.capturedAt}${
      baseline.gitCommit ? ` @ ${baseline.gitCommit}` : ""
    }\n` +
    `Regression threshold: ${(REGRESSION_THRESHOLD * 100).toFixed(0)}%\n\n` +
    `## Results\n\n` +
    `> ⚠️  = exceeded ${(REGRESSION_THRESHOLD * 100).toFixed(0)}% regression threshold\n\n` +
    table +
    "\n\n" +
    (failures.length === 0
      ? "✅  All metrics within acceptable range.\n"
      : `❌  ${failures.length} regression(s) detected:\n\n` +
        failures
          .map(
            (f) =>
              `- \`${f.entryPoint}\` / \`${f.metric}\`: ` +
              `${f.current.toLocaleString()} vs baseline ${f.baseline.toLocaleString()} ` +
              `(+${((f.ratio - 1) * 100).toFixed(1)}%)`
          )
          .join("\n") +
        "\n");

  fs.writeFileSync(reportPath, reportContent);
  console.log(`📄  Report written to ${reportPath}`);
  console.log("\n## Gas Estimation Results\n");
  console.log(table);
  console.log("");

  if (failures.length > 0) {
    console.error(`\n❌  ${failures.length} regression(s) detected (>${(REGRESSION_THRESHOLD * 100).toFixed(0)}% over baseline):`);
    for (const f of failures) {
      console.error(
        `   ${f.entryPoint} / ${f.metric}: ` +
          `${f.current.toLocaleString()} vs baseline ${f.baseline.toLocaleString()} ` +
          `(+${((f.ratio - 1) * 100).toFixed(1)}%)`
      );
    }
    process.exit(1);
  }

  console.log(`✅  All metrics within ${(REGRESSION_THRESHOLD * 100).toFixed(0)}% of baseline.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
