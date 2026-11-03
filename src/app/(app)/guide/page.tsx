// /guide: a step-by-step tour of the app, one screen per step.
//
// Steps are `?step=<slug>` links, so the whole tour is server-rendered, works
// with JavaScript off, and each step can be bookmarked. The book rides along
// in `?book=` like everywhere else, so the toggle demonstrated in step two is
// the real one and each "open the screen" link lands in the book you were in.
//
// Reads nothing but the pay period for the header. Every figure in the steps
// is an invented example (see `Example` in ./parts.tsx).
//
// Layout follows the Money Book canvas (Tour.dc.html): the step in a card,
// the step list beside it on a desktop, folded into a <details> on a phone.

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/ui/primitives";
import { withBook } from "@/components/ui/nav";
import { parseBook, resolvePeriod } from "@/lib/budget/query";
import { GUIDE_STEPS, resolveStep } from "@/lib/guide/steps";
import { stepContent } from "./content";
import { GuideKeys } from "./keys";
import { Progress, StepList, stepHref } from "./parts";

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
      <div className="page-h">
        <div className="grow stack" style={{ gap: 6 }}>
          <h1 className="t-xl">How to use this app</h1>
          <span className="range">
            /guide?step={step.slug} · each step has its own address, so you can
            bookmark it or come back
          </span>
        </div>
        <Link className="btn ghost" href={withBook("/budget", book)}>
          Exit tour
        </Link>
      </div>

      {/* Under 768px the step list folds into a <details>: one line until
          it's wanted, and still no JavaScript. */}
      <details className="card ph-only" style={{ padding: "4px 8px" }}>
        <summary className="row between" style={{ minHeight: 44, padding: "0 8px" }}>
          <span className="semi">All steps</span>
          <span className="num t-s ink3">
            {index + 1}/{GUIDE_STEPS.length}
          </span>
        </summary>
        <StepList current={index} book={book} />
      </details>

      <div className="grid cols-side" style={{ gap: 24, alignItems: "start" }}>
        <article className="card pad-l stack" style={{ gap: 18, minWidth: 0 }} aria-labelledby="guide-step-title">
          <div className="row between wrap">
            <span className="lbl">
              Step {index + 1} of {GUIDE_STEPS.length} · {step.group}
            </span>
            <div className="row" style={{ gap: 12 }}>
              <Progress current={index} />
              <GuideKeys
                prevHref={prev ? stepHref(prev, book) : null}
                nextHref={next ? stepHref(next, book) : null}
              />
            </div>
          </div>

          <header className="stack" style={{ gap: 8 }}>
            <h2 id="guide-step-title" className="t-xl">
              {step.title}
            </h2>
            <p className="t-b ink2" style={{ maxWidth: 640 }}>
              {content.lede}
            </p>
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
            <div className="row wrap">
              <span className="t-s ink2">See it with your own figures:</span>
              <Link className="btn sm" href={screenHref}>
                {step.screen.label}
                <Icon name="chev" size="sm" />
              </Link>
            </div>
          )}

          <nav className="row between wrap" style={{ gap: 10 }} aria-label="Guide steps">
            {prev ? (
              <Link className="btn quiet" href={stepHref(prev, book)} rel="prev">
                <Icon name="back" size="sm" />
                Step {index} · {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link className="btn primary" href={stepHref(next, book)} rel="next">
                Step {index + 2} · {next.title}
                <Icon name="chev" size="sm" />
              </Link>
            ) : (
              <Link className="btn primary" href={withBook("/budget", book)}>
                Finish: go to Budget
              </Link>
            )}
          </nav>
        </article>

        <nav className="card dt-only" style={{ padding: 8 }} aria-label="Tour steps">
          <StepList current={index} book={book} />
        </nav>
      </div>
    </AppShell>
  );
}
