"use client";

/**
 * HelpButton — floating help trigger button.
 *
 * A persistent "?" button that opens the HelpPanel slide-out.
 * Placed in the page layout so it appears on all major pages.
 *
 * Issue #745.
 */

import { useState } from "react";
import { HelpPanel } from "@/components/help/HelpPanel";
import type { HelpArticle } from "@/lib/helpArticles";

export interface HelpButtonProps {
  currentPage?: HelpArticle["page"];
  initialArticleId?: string;
}

export function HelpButton({
  currentPage = "global",
  initialArticleId,
}: HelpButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open help and documentation"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="Help & Docs"
        className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-slate-950 transition-all hover:scale-105 active:scale-95"
      >
        <span className="text-xl font-bold">?</span>
      </button>

      <HelpPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        currentPage={currentPage}
        initialArticleId={initialArticleId}
      />
    </>
  );
}
