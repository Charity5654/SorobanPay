"use client";

/**
 * HelpTooltip — inline contextual help tooltip.
 *
 * Renders a small "?" icon that shows a tooltip popover on hover/focus.
 * Used on key form fields and UI elements for quick inline guidance.
 *
 * Issue #745: contextual help and documentation overlay.
 */

import { useState, useRef, useEffect } from "react";

export interface HelpTooltipProps {
  content: string;
  /** Optional link to open the full docs panel */
  articleId?: string;
  onOpenArticle?: (articleId: string) => void;
  position?: "top" | "bottom" | "left" | "right";
}

export function HelpTooltip({
  content,
  articleId,
  onOpenArticle,
  position = "top",
}: HelpTooltipProps) {
  const [visible, setVisible] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!visible) return;
    function handleClick(e: MouseEvent) {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !tooltipRef.current?.contains(e.target as Node)
      ) {
        setVisible(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [visible]);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setVisible(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [visible]);

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={btnRef}
        type="button"
        aria-label="Show help"
        aria-expanded={visible}
        aria-haspopup="dialog"
        onClick={() => setVisible((v) => !v)}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 hover:bg-blue-500/40 hover:text-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:ring-offset-slate-900 transition-colors text-[10px] font-bold cursor-help"
      >
        ?
      </button>

      {visible && (
        <div
          ref={tooltipRef}
          role="dialog"
          aria-label="Help tooltip"
          className={`absolute z-50 w-64 rounded-xl border border-gray-700 bg-slate-800 p-3 shadow-2xl text-xs text-gray-200 ${positionClasses[position]}`}
        >
          <p className="leading-relaxed whitespace-pre-line">{content}</p>
          {articleId && onOpenArticle && (
            <button
              type="button"
              onClick={() => {
                onOpenArticle(articleId);
                setVisible(false);
              }}
              className="mt-2 text-blue-400 hover:text-blue-300 underline underline-offset-2 text-xs"
            >
              Read full article →
            </button>
          )}
        </div>
      )}
    </span>
  );
}
