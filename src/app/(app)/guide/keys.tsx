"use client";

// Arrow-key stepping for the guide. An enhancement only: the pager links do
// the same job with JavaScript off, which is also why the hint is rendered
// from here rather than by the page. Without JS it would advertise keys that
// do nothing.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function GuideKeys({
  prevHref,
  nextHref,
}: {
  prevHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      // Leave arrows alone wherever they already mean something.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;

      const href =
        event.key === "ArrowRight" ? nextHref : event.key === "ArrowLeft" ? prevHref : null;
      if (!href) return;
      event.preventDefault();
      router.push(href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, prevHref, nextHref]);

  return (
    <span className="mb-wide-only" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
      Tip: <kbd className="mb-guide-kbd">←</kbd> <kbd className="mb-guide-kbd">→</kbd> keys
      step through
    </span>
  );
}
