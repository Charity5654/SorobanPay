/**
 * SubscriptionReceipt.tsx
 *
 * Client-side PDF receipt generator for SorobanPay subscriptions.
 * Rendered entirely in the browser via @react-pdf/renderer — no data
 * is sent to any external server.
 *
 * Issue #379 — PDF receipt download after successful subscription.
 *
 * Usage:
 *   import { downloadReceipt } from '@/components/SubscriptionReceipt';
 *   await downloadReceipt(receiptData);
 *
 * The file is saved as:  sorobanpay-receipt-{txHash}.pdf
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import React from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReceiptData {
  /** Full transaction hash from Stellar ledger */
  txHash: string;
  /** Stellar public key of the merchant */
  merchant: string;
  /** Stellar public key of the subscriber */
  subscriber: string;
  /** SEP-41 token contract address */
  token: string;
  /** Payment amount as a string (token units) */
  amount: string;
  /** Interval in seconds as a string */
  interval: string;
  /** ISO 8601 date string of when the subscription was created */
  issuedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert seconds to a human-readable string, e.g. "30 days". */
function formatInterval(seconds: string): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return `${seconds} s`;
  const days = s / 86400;
  if (Number.isInteger(days)) {
    return days === 1 ? "1 day" : `${days} days`;
  }
  return `${s.toLocaleString()} seconds`;
}

/** Compute the next payment date from the creation date and interval. */
function nextPaymentDate(issuedAt: string, interval: string): string {
  try {
    const d = new Date(issuedAt);
    d.setSeconds(d.getSeconds() + Number(interval));
    return d.toUTCString();
  } catch {
    return "—";
  }
}

/** Truncate a long address for display with ellipsis in the middle. */
function truncateAddress(addr: string, keepChars = 12): string {
  if (addr.length <= keepChars * 2 + 3) return addr;
  return `${addr.slice(0, keepChars)}…${addr.slice(-keepChars)}`;
}

/** Build the Stellar Expert explorer URL for a given network. */
function explorerUrl(txHash: string): string {
  // Detect testnet via the global env variable available at build/runtime.
  const passphrase =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "")
      : "";
  const network = passphrase.includes("Test SDF") ? "testnet" : "public";
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

// ─── Stylesheet ───────────────────────────────────────────────────────────────

const BRAND_GREEN = "#22c55e";
const BRAND_DARK = "#111827";
const TEXT_PRIMARY = "#f9fafb";
const TEXT_SECONDARY = "#9ca3af";
const BORDER_COLOR = "#374151";
const CELL_BG = "#1f2937";

const styles = StyleSheet.create({
  page: {
    backgroundColor: BRAND_DARK,
    color: TEXT_PRIMARY,
    fontFamily: "Helvetica",
    padding: 40,
    fontSize: 10,
  },

  // ── Header ──
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: BRAND_GREEN,
  },
  brandBlock: {
    flexDirection: "column",
  },
  brandName: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: BRAND_GREEN,
    letterSpacing: 0.5,
  },
  brandTagline: {
    fontSize: 8,
    color: TEXT_SECONDARY,
    marginTop: 2,
  },
  receiptLabel: {
    fontSize: 9,
    color: TEXT_SECONDARY,
    textAlign: "right",
  },
  receiptDate: {
    fontSize: 9,
    color: TEXT_PRIMARY,
    textAlign: "right",
    marginTop: 2,
  },

  // ── Section title ──
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: BRAND_GREEN,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 16,
  },

  // ── Row / grid ──
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: BORDER_COLOR,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  rowEven: {
    backgroundColor: CELL_BG,
  },
  rowLabel: {
    width: "35%",
    color: TEXT_SECONDARY,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  rowValue: {
    width: "65%",
    color: TEXT_PRIMARY,
    fontSize: 9,
    fontFamily: "Helvetica",
    wordBreak: "break-all",
  },

  // ── TX hash block ──
  hashBlock: {
    backgroundColor: CELL_BG,
    borderWidth: 1,
    borderColor: BRAND_GREEN,
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
  },
  hashLabel: {
    fontSize: 8,
    color: TEXT_SECONDARY,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  hashValue: {
    fontSize: 8,
    color: BRAND_GREEN,
    fontFamily: "Helvetica",
    wordBreak: "break-all",
    letterSpacing: 0.3,
  },

  // ── Amount highlight ──
  amountBox: {
    backgroundColor: "#052e16",
    borderWidth: 1,
    borderColor: BRAND_GREEN,
    borderRadius: 4,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  amountLabel: {
    fontSize: 9,
    color: TEXT_SECONDARY,
    fontFamily: "Helvetica-Bold",
  },
  amountValue: {
    fontSize: 16,
    color: BRAND_GREEN,
    fontFamily: "Helvetica-Bold",
  },
  amountUnit: {
    fontSize: 9,
    color: TEXT_SECONDARY,
  },

  // ── Explorer link ──
  explorerSection: {
    marginTop: 8,
    padding: 8,
    backgroundColor: CELL_BG,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
  },
  explorerLabel: {
    fontSize: 8,
    color: TEXT_SECONDARY,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  explorerUrl: {
    fontSize: 8,
    color: "#60a5fa",
    wordBreak: "break-all",
  },

  // ── Footer ──
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: BORDER_COLOR,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: TEXT_SECONDARY,
  },

  // ── Disclaimer ──
  disclaimer: {
    marginTop: 20,
    padding: 8,
    backgroundColor: "#1c1917",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#44403c",
  },
  disclaimerText: {
    fontSize: 7,
    color: "#78716c",
    lineHeight: 1.5,
  },
});

// ─── PDF Document component ───────────────────────────────────────────────────

function ReceiptDocument({ data }: { data: ReceiptData }) {
  const days = formatInterval(data.interval);
  const issuedFormatted = (() => {
    try {
      return new Date(data.issuedAt).toUTCString();
    } catch {
      return data.issuedAt;
    }
  })();
  const nextPayment = nextPaymentDate(data.issuedAt, data.interval);
  const url = explorerUrl(data.txHash);

  const partyRows: Array<{ label: string; value: string }> = [
    { label: "Subscriber", value: data.subscriber },
    { label: "Merchant", value: data.merchant },
    { label: "Token Contract", value: data.token },
  ];

  const paymentRows: Array<{ label: string; value: string }> = [
    { label: "Interval", value: days },
    { label: "Issued (UTC)", value: issuedFormatted },
    { label: "Next Payment (UTC)", value: nextPayment },
  ];

  return (
    <Document
      title={`SorobanPay Receipt — ${truncateAddress(data.txHash)}`}
      author="SorobanPay"
      subject="Subscription Receipt"
      keywords="sorobanpay, stellar, subscription, receipt"
      creator="SorobanPay"
      producer="@react-pdf/renderer"
    >
      <Page size="A4" style={styles.page}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>SorobanPay</Text>
            <Text style={styles.brandTagline}>
              Decentralized Recurring Payments · Stellar / Soroban
            </Text>
          </View>
          <View>
            <Text style={styles.receiptLabel}>SUBSCRIPTION RECEIPT</Text>
            <Text style={styles.receiptDate}>{issuedFormatted}</Text>
          </View>
        </View>

        {/* ── Transaction hash ── */}
        <View style={styles.hashBlock}>
          <Text style={styles.hashLabel}>Transaction Hash</Text>
          <Text style={styles.hashValue}>{data.txHash}</Text>
        </View>

        {/* ── Amount highlight ── */}
        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Amount per cycle</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
            <Text style={styles.amountValue}>{data.amount}</Text>
            <Text style={styles.amountUnit}>tokens / {days}</Text>
          </View>
        </View>

        {/* ── Party details ── */}
        <Text style={styles.sectionTitle}>Parties</Text>
        {partyRows.map(({ label, value }, i) => (
          <View key={label} style={[styles.row, i % 2 === 0 ? styles.rowEven : {}]}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue}>{value}</Text>
          </View>
        ))}

        {/* ── Payment schedule ── */}
        <Text style={styles.sectionTitle}>Payment Schedule</Text>
        {paymentRows.map(({ label, value }, i) => (
          <View key={label} style={[styles.row, i % 2 === 0 ? styles.rowEven : {}]}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue}>{value}</Text>
          </View>
        ))}

        {/* ── Stellar Expert explorer link ── */}
        <Text style={styles.sectionTitle}>Verify On-Chain</Text>
        <View style={styles.explorerSection}>
          <Text style={styles.explorerLabel}>Stellar Expert Transaction Explorer</Text>
          <Text style={styles.explorerUrl}>{url}</Text>
        </View>

        {/* ── Disclaimer ── */}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            This receipt is a client-side record of your on-chain subscription
            transaction. It does not constitute a legally binding invoice. No
            personal data or financial information was transmitted to any external
            server to generate this document. The authoritative record is the
            Stellar blockchain transaction referenced above. To cancel this
            subscription, call cancel(subscriber, merchant) on the SorobanPay
            contract or revoke the SEP-41 token allowance via your wallet.
          </Text>
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            sorobanpay · stellar.org · Generated {issuedFormatted}
          </Text>
          <Text style={styles.footerText}>
            {truncateAddress(data.txHash, 8)}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

// ─── Public download function ─────────────────────────────────────────────────

/**
 * Generate and immediately trigger a browser download of the receipt PDF.
 *
 * @param data  Receipt data populated from the transaction result.
 * @returns     Promise that resolves when the download has been triggered.
 */
export async function downloadReceipt(data: ReceiptData): Promise<void> {
  // Dynamically render the PDF to a Blob — all work is done in the browser.
  const blob = await pdf(<ReceiptDocument data={data} />).toBlob();

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sorobanpay-receipt-${data.txHash}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Release the object URL after a short delay to allow the browser to initiate
  // the download before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
