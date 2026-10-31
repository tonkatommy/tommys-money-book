// Building blocks for the guide: the step list, the example frame and the
// previous/next bar.
//
// Every control is a link to `/guide?step=…`, so stepping through works with
// JavaScript off and each step is bookmarkable, the same reasoning as the
// book toggle. The step list renders twice, as a column from 1100px and a
// <details> below that, the way the nav renders as sidebar and tab bar.

import Link from "next/link";
import type { ReactNode } from "react";
import type { Book } from "@/generated/prisma/client";
import { withBook } from "@/components/ui/nav";
import { groupedSteps, GUIDE_STEPS, type GuideStep } from "@/lib/guide/steps";

export function stepHref(step: GuideStep, book: Book): string {
  return withBook(`/guide?step=${step.slug}`, book);
}

/** Numbered step list, grouped. Earlier steps show a tick, not a number. */
export function StepList({
  current,
  book,
}: {
  current: number;
  book: Book;
}) {
  return (
    <ol className="mb-guide-list">
      {groupedSteps().map(({ group, steps }) => (
        <li key={group}>
          <div className="mb-guide-group">{group}</div>
          <ol>
            {steps.map(({ step, index }) => {
              const state =
                index === current ? "current" : index < current ? "done" : "todo";
              return (
                <li key={step.slug}>
                  <Link
                    href={stepHref(step, book)}
                    className="mb-guide-item"
                    data-state={state}
                    aria-current={state === "current" ? "step" : undefined}
                  >
                    <span className="mb-guide-num" aria-hidden="true">
                      {state === "done" ? "✓" : index + 1}
                    </span>
                    <span>{step.title}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

/**
 * A square ‹ or › for the narrow top bar. At either end it stays in place,
 * dimmed, so the drawer between them doesn't jump sideways.
 */
export function StepArrow({
  to,
  book,
  direction,
}: {
  to: GuideStep | null;
  book: Book;
  direction: "prev" | "next";
}) {
  const label = direction === "prev" ? "Previous step" : "Next step";
  const glyph = direction === "prev" ? "‹" : "›";
  const className = `mb-guide-arrow${direction === "next" ? " mb-guide-arrow-next" : ""}`;
  if (!to) {
    return (
      <span className={className} aria-disabled="true" aria-label={label}>
        {glyph}
      </span>
    );
  }
  return (
    <Link
      href={stepHref(to, book)}
      className={className}
      aria-label={`${label}: ${to.title}`}
      rel={direction}
    >
      {glyph}
    </Link>
  );
}

/** Thin progress bar. Step 1 of N shows a sliver, not an empty track. */
export function Progress({ current }: { current: number }) {
  const pct = ((current + 1) / GUIDE_STEPS.length) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={GUIDE_STEPS.length}
      aria-valuenow={current + 1}
      aria-label="Guide progress"
      style={{
        height: 4,
        borderRadius: "var(--radius-full)",
        background: "var(--surface-inset)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: "var(--accent-gradient)",
          borderRadius: "var(--radius-full)",
          transition: "width var(--duration-base) var(--ease-standard)",
        }}
      />
    </div>
  );
}

/**
 * A mock of part of a real screen, built from the real components.
 *
 * Every figure inside is invented, and the frame says so in words and with a
 * dashed border. This app's worst failure is a number believed when it
 * shouldn't be, so an example figure must never be mistakable for one of
 * yours.
 */
export function Example({
  caption,
  children,
}: {
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="mb-guide-example">
      <div className="mb-guide-example-tag">Example · made-up figures</div>
      <div>{children}</div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/** Small sub-heading inside a step body. */
export function StepHeading({ children }: { children: ReactNode }) {
  return (
    <h3
      style={{
        margin: "var(--space-2) 0 0",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-semibold)",
        color: "var(--text-primary)",
      }}
    >
      {children}
    </h3>
  );
}

/** A term and its plain-English meaning, for the jargon each step introduces. */
export function Term({ word, children }: { word: string; children: ReactNode }) {
  return (
    <div className="mb-guide-term">
      <dt>{word}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** One fake row of a list screen: label left, figure right, extras under. */
export function MockRow({
  left,
  sub,
  right,
  rightTone,
}: {
  left: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  rightTone?: string;
}) {
  return (
    <div className="mb-guide-row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
          {left}
        </div>
        {sub && (
          <div
            style={{
              marginTop: 4,
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              alignItems: "center",
              fontSize: "var(--text-xs)",
              color: "var(--text-tertiary)",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {right && (
        <div
          className="mb-num"
          style={{
            fontSize: "var(--text-sm)",
            color: rightTone ?? "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
}
