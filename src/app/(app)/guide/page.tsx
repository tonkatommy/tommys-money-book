// /guide: a step-by-step tour of the app, one screen per step.
//
// Steps are `?step=<slug>` links, so the whole tour is server-rendered, works
// with JavaScript off, and each step can be bookmarked. The book rides along
// in `?book=` like everywhere else, so the toggle demonstrated in step two is
// the real one and each "open the screen" link lands in the book you were in.
//
// Reads nothing but the pay period for the header. Every figure in the steps
// is an invented example (see `Example` in ./parts.tsx).

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ButtonLink, Card } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { GUIDE_STEPS, resolveStep } from "@/lib/guide/steps";
import { stepContent } from "./content";
import { GuideKeys } from "./keys";
import { Progress, StepArrow, StepList, stepHref } from "./parts";

export const dynamic = "force-dynamic";

export default async function GuidePage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; step?: string }>;
}) {
  const params = await searchParams;
  const book = parseBook(params.book);
  const { period, settings } = await resolvePeriod();
  const { step, index, prev, next } = resolveStep(params.step);
  const content = stepContent(step.slug, book);

  const screenHref = step.screen
    ? step.screen.personalOnly
      ? step.screen.href
      : withBook(step.screen.href, book)
    : null;

  return (
    <AppShell
      active="guide"
      book={book}
      period={period}
      basePath="/guide"
      // The step means the same thing in either book, so keep it.
      preserveQuery={`step=${step.slug}`}
      splitFortnightly={settings.splitFortnightly}
    >
      <div className="mb-guide">
        <aside className="mb-guide-aside">
          <div className="mb-guide-aside-head">How to use Money Book</div>
          <StepList current={index} book={book} />
        </aside>

        <div className="mb-stack" style={{ minWidth: 0 }}>
          {/* Under 1100px: the step list folds into a <details>, so it costs one
              line until it's wanted and still needs no JavaScript, with
              previous/next either side of it. */}
          <div className="mb-guide-topbar">
            <StepArrow to={prev} book={book} direction="prev" />
            <details className="mb-guide-drawer">
              <summary>
                <span>All steps</span>
                <span className="mb-num" style={{ color: "var(--text-muted)" }}>
                  {index + 1}/{GUIDE_STEPS.length}
                </span>
              </summary>
              <StepList current={index} book={book} />
            </details>
            <StepArrow to={next} book={book} direction="next" />
          </div>

          <Card>
            <article className="mb-guide-step" aria-labelledby="guide-step-title">
              <div className="mb-stack-sm">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "var(--space-3)",
                    flexWrap: "wrap",
                  }}
                >
                  <div className="mb-guide-eyebrow">
                    Step {index + 1} of {GUIDE_STEPS.length} · {step.group}
                  </div>
                  <GuideKeys
                    prevHref={prev ? stepHref(prev, book) : null}
                    nextHref={next ? stepHref(next, book) : null}
                  />
                </div>
                <Progress current={index} />
              </div>

              <header>
                <h2 id="guide-step-title" className="mb-guide-title">
                  {step.title}
                </h2>
                <p className="mb-guide-lede">{content.lede}</p>
              </header>

              <div className={content.example ? "mb-guide-split" : undefined}>
                <div className="mb-guide-prose">{content.body}</div>
                {content.example}
              </div>

              {content.why && (
                <details className="mb-guide-why">
                  <summary>Why it works this way</summary>
                  <div className="mb-guide-prose">{content.why}</div>
                </details>
              )}

              {screenHref && step.screen && (
                <div className="mb-guide-try">
                  <span>See it with your own figures:</span>
                  <ButtonLink href={screenHref} variant="secondary" size="sm">
                    {step.screen.label} →
                  </ButtonLink>
                </div>
              )}

              <nav className="mb-guide-pager" aria-label="Guide steps">
                {prev ? (
                  <Link href={stepHref(prev, book)} className="mb-guide-pager-link" rel="prev">
                    <span className="mb-guide-pager-dir">← Previous</span>
                    <span className="mb-truncate">{prev.title}</span>
                  </Link>
                ) : (
                  <span />
                )}
                {next ? (
                  <Link
                    href={stepHref(next, book)}
                    className="mb-guide-pager-link mb-guide-pager-next"
                    rel="next"
                  >
                    <span className="mb-guide-pager-dir">Next →</span>
                    <span className="mb-truncate">{next.title}</span>
                  </Link>
                ) : (
                  <ButtonLink href={withBook("/budget", book)} variant="primary">
                    Finish: go to Budget
                  </ButtonLink>
                )}
              </nav>
            </article>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
