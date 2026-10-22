"use client";

/**
 * HelpPanel — slide-out documentation panel.
 *
 * A full-height side panel with:
 * - Searchable help articles
 * - Article detail view with optional video embed
 * - User feedback form (thumbs up/down)
 * - View tracking (most-viewed articles)
 *
 * Issue #745: slide-out documentation panel, searchable articles,
 * video embeds, feedback, analytics.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  helpArticles,
  searchArticles,
  getArticle,
  getArticlesForPage,
  HELP_CONTENT_VERSION,
  type HelpArticle,
} from "@/lib/helpArticles";

// ─── Local storage helpers ────────────────────────────────────────────────────

const VIEW_COUNTS_KEY = "sorobanpay:help:viewCounts";
const FEEDBACK_KEY = "sorobanpay:help:feedback";

function getViewCounts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VIEW_COUNTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function incrementViewCount(articleId: string) {
  const counts = getViewCounts();
  counts[articleId] = (counts[articleId] ?? 0) + 1;
  try {
    localStorage.setItem(VIEW_COUNTS_KEY, JSON.stringify(counts));
  } catch {
    // storage quota exceeded — ignore
  }
}

function getFeedback(): Record<string, "up" | "down"> {
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveFeedback(articleId: string, value: "up" | "down") {
  const all = getFeedback();
  all[articleId] = value;
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HelpPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-selected article to open */
  initialArticleId?: string;
  /** Current page — filters the article list */
  currentPage?: HelpArticle["page"];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HelpPanel({
  isOpen,
  onClose,
  initialArticleId,
  currentPage = "global",
}: HelpPanelProps) {
  const [query, setQuery] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);
  const [feedbackState, setFeedbackState] = useState<Record<string, "up" | "down">>({});
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Results: search or page-filtered list
  const results =
    query.trim().length > 0
      ? searchArticles(query)
      : getArticlesForPage(currentPage);

  // Sort by view count (descending) when not searching
  const viewCounts = typeof window !== "undefined" ? getViewCounts() : {};
  const sortedResults =
    query.trim().length === 0
      ? [...results].sort(
          (a, b) => (viewCounts[b.id] ?? 0) - (viewCounts[a.id] ?? 0)
        )
      : results;

  // Open initial article when provided
  useEffect(() => {
    if (initialArticleId && isOpen) {
      const article = getArticle(initialArticleId);
      if (article) {
        setSelectedArticle(article);
        incrementViewCount(article.id);
      }
    }
  }, [initialArticleId, isOpen]);

  // Focus search on open
  useEffect(() => {
    if (isOpen && !selectedArticle) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [isOpen, selectedArticle]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (selectedArticle) setSelectedArticle(null);
        else onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, selectedArticle, onClose]);

  // Load saved feedback
  useEffect(() => {
    setFeedbackState(getFeedback());
  }, []);

  const openArticle = useCallback((article: HelpArticle) => {
    setSelectedArticle(article);
    incrementViewCount(article.id);
  }, []);

  const handleFeedback = useCallback(
    (articleId: string, value: "up" | "down") => {
      saveFeedback(articleId, value);
      setFeedbackState((prev) => ({ ...prev, [articleId]: value }));
      setFeedbackSubmitted(articleId);
      setTimeout(() => setFeedbackSubmitted(null), 3000);
    },
    []
  );

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Help and documentation"
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-md transform bg-slate-900 shadow-2xl transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xl">📖</span>
            <div>
              <h2 className="text-base font-semibold text-white">Help & Docs</h2>
              <p className="text-xs text-gray-500">v{HELP_CONTENT_VERSION}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help panel"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            ✕
          </button>
        </div>

        {selectedArticle ? (
          /* ── Article detail view ─────────────────────────── */
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Back button */}
            <div className="px-5 pt-4 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedArticle(null)}
                className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                ← Back to articles
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Title */}
              <h3 className="text-lg font-bold text-white leading-snug">
                {selectedArticle.title}
              </h3>

              {/* Video embed */}
              {selectedArticle.videoUrl && (
                <div className="rounded-xl overflow-hidden border border-gray-700 bg-black">
                  <iframe
                    src={selectedArticle.videoUrl}
                    title={`Video: ${selectedArticle.title}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full aspect-video"
                  />
                </div>
              )}

              {/* Content */}
              <div className="prose prose-sm prose-invert max-w-none text-gray-300 leading-relaxed whitespace-pre-wrap">
                {selectedArticle.content}
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {selectedArticle.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      setQuery(tag);
                      setSelectedArticle(null);
                    }}
                    className="rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
                  >
                    #{tag}
                  </button>
                ))}
              </div>

              {/* Feedback */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                <p className="text-sm font-medium text-gray-300 mb-3">
                  Was this article helpful?
                </p>
                {feedbackSubmitted === selectedArticle.id ? (
                  <p className="text-sm text-green-400">
                    ✓ Thanks for your feedback!
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleFeedback(selectedArticle.id, "up")}
                      aria-pressed={feedbackState[selectedArticle.id] === "up"}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                        feedbackState[selectedArticle.id] === "up"
                          ? "bg-green-600/20 text-green-400 border border-green-600/40"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700"
                      }`}
                    >
                      👍 Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback(selectedArticle.id, "down")}
                      aria-pressed={feedbackState[selectedArticle.id] === "down"}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                        feedbackState[selectedArticle.id] === "down"
                          ? "bg-red-600/20 text-red-400 border border-red-600/40"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700"
                      }`}
                    >
                      👎 No
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ── Article list / search view ─────────────────── */
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Search */}
            <div className="px-5 py-4 shrink-0">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                  🔍
                </span>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search help articles…"
                  aria-label="Search help articles"
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 py-2.5 pl-9 pr-4 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    ✕
                  </button>
                )}
              </div>
              {query && (
                <p className="mt-1.5 text-xs text-gray-500">
                  {sortedResults.length} result{sortedResults.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
                </p>
              )}
            </div>

            {/* Article list */}
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2">
              {sortedResults.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-4xl mb-3">🔍</p>
                  <p className="text-sm text-gray-400">No articles match &ldquo;{query}&rdquo;</p>
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="mt-3 text-sm text-blue-400 hover:text-blue-300 underline"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                sortedResults.map((article) => (
                  <button
                    key={article.id}
                    type="button"
                    onClick={() => openArticle(article)}
                    className="w-full text-left rounded-xl border border-gray-800 bg-gray-900/60 p-4 hover:border-blue-600/50 hover:bg-gray-800/80 transition-colors group focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white group-hover:text-blue-200 transition-colors truncate">
                          {article.title}
                        </p>
                        <p className="mt-1 text-xs text-gray-400 leading-relaxed line-clamp-2">
                          {article.summary}
                        </p>
                      </div>
                      {article.videoUrl && (
                        <span
                          title="Has video"
                          className="shrink-0 text-xs bg-purple-900/40 text-purple-300 rounded px-1.5 py-0.5 border border-purple-700/30"
                        >
                          ▶ Video
                        </span>
                      )}
                    </div>
                    {viewCounts[article.id] > 0 && (
                      <p className="mt-2 text-xs text-gray-600">
                        Viewed {viewCounts[article.id]}×
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-800 px-5 py-3 shrink-0">
          <p className="text-xs text-gray-600 text-center">
            Help content version {HELP_CONTENT_VERSION} · SorobanPay
          </p>
        </div>
      </div>
    </>
  );
}
