// The in-app guide's table of contents: which steps exist, in what order, and
// where each one's "try it" link goes.
//
// Kept apart from the step content (app/(app)/guide/content.tsx) so the
// ordering and the `?step=` parsing are plain data a unit test can hold to,
// and so adding a step is one line here plus one entry there.
//
// Steps are addressed by slug rather than by number. A number in a bookmark
// silently points at a different step the day one is inserted above it; a
// slug either still resolves or falls back to the start, which is honest.

export type GuideGroup =
  | "The basics"
  | "Every day"
  | "Each pay period"
  | "Tax and health"
  | "Wrapping up";

export type GuideStep = {
  slug: string;
  title: string;
  group: GuideGroup;
  /** The real screen this step teaches, if it teaches one. */
  screen?: { href: string; label: string; personalOnly?: boolean };
};

export const GUIDE_STEPS: GuideStep[] = [
  { slug: "welcome", title: "Welcome", group: "The basics" },
  { slug: "getting-around", title: "Finding your way around", group: "The basics" },
  { slug: "two-books", title: "Two sets of books", group: "The basics" },
  {
    slug: "budget",
    title: "The daily check",
    group: "Every day",
    screen: { href: "/budget", label: "Open Budget" },
  },
  {
    slug: "warnings",
    title: "Read the warnings first",
    group: "Every day",
    screen: { href: "/budget", label: "Check Budget for warnings" },
  },
  {
    slug: "transactions",
    title: "Transactions and categories",
    group: "Every day",
    screen: { href: "/transactions", label: "Open Transactions" },
  },
  {
    slug: "cash",
    title: "Cash the bank never saw",
    group: "Every day",
    screen: { href: "/transactions/new", label: "Add a cash entry" },
  },
  {
    slug: "transfers",
    title: "Transfers to confirm",
    group: "Every day",
    screen: { href: "/transfers", label: "Open Transfers" },
  },
  {
    slug: "set-budget",
    title: "Setting the budget",
    group: "Each pay period",
    screen: { href: "/budget/setup", label: "Open Set budget" },
  },
  {
    slug: "month-end",
    title: "Closing the period",
    group: "Each pay period",
    screen: { href: "/budget/review", label: "Open Month end" },
  },
  {
    slug: "history-goals",
    title: "Looking back, saving ahead",
    group: "Each pay period",
    screen: { href: "/budget/history", label: "Open How past periods went" },
  },
  {
    slug: "reports",
    title: "Reports and the IR3",
    group: "Tax and health",
    screen: { href: "/reports", label: "Open Reports" },
  },
  {
    slug: "sync",
    title: "Is the feed still arriving?",
    group: "Tax and health",
    screen: { href: "/sync", label: "Open Sync status" },
  },
  { slug: "routine", title: "Your routine", group: "Wrapping up" },
];

export type ResolvedStep = {
  step: GuideStep;
  /** 0-based position in GUIDE_STEPS. */
  index: number;
  prev: GuideStep | null;
  next: GuideStep | null;
};

/**
 * Parse `?step=`. Anything unrecognised, including no parameter at all, is
 * the first step: a stale bookmark should land somewhere sensible, not 404.
 */
export function resolveStep(slug?: string): ResolvedStep {
  const found = GUIDE_STEPS.findIndex((s) => s.slug === slug);
  const index = found === -1 ? 0 : found;
  return {
    step: GUIDE_STEPS[index],
    index,
    prev: index > 0 ? GUIDE_STEPS[index - 1] : null,
    next: index < GUIDE_STEPS.length - 1 ? GUIDE_STEPS[index + 1] : null,
  };
}

/** Steps in order, grouped for the step list, groups in first-seen order. */
export function groupedSteps(): { group: GuideGroup; steps: { step: GuideStep; index: number }[] }[] {
  const groups: { group: GuideGroup; steps: { step: GuideStep; index: number }[] }[] = [];
  GUIDE_STEPS.forEach((step, index) => {
    const last = groups[groups.length - 1];
    if (last && last.group === step.group) last.steps.push({ step, index });
    else groups.push({ group: step.group, steps: [{ step, index }] });
  });
  return groups;
}
