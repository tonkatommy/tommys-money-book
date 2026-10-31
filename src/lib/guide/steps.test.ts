// The guide is addressed by `?step=` slugs, so the failures worth guarding
// are a bookmark that resolves to nothing, a duplicate slug that makes one
// step unreachable, and a group split in two so the step list shows the same
// heading twice.

import { describe, expect, it } from "vitest";
import { GUIDE_STEPS, groupedSteps, resolveStep } from "./steps";

describe("resolveStep", () => {
  it("falls back to the first step for a missing or unknown slug", () => {
    expect(resolveStep().index).toBe(0);
    expect(resolveStep("no-such-step").index).toBe(0);
    expect(resolveStep("").step.slug).toBe(GUIDE_STEPS[0].slug);
  });

  it("has no previous step at the start and no next step at the end", () => {
    const first = resolveStep(GUIDE_STEPS[0].slug);
    expect(first.prev).toBeNull();
    expect(first.next?.slug).toBe(GUIDE_STEPS[1].slug);

    const last = resolveStep(GUIDE_STEPS[GUIDE_STEPS.length - 1].slug);
    expect(last.next).toBeNull();
    expect(last.prev?.slug).toBe(GUIDE_STEPS[GUIDE_STEPS.length - 2].slug);
  });

  it("resolves every step to itself", () => {
    GUIDE_STEPS.forEach((step, index) => {
      expect(resolveStep(step.slug).index).toBe(index);
    });
  });
});

describe("GUIDE_STEPS", () => {
  it("has unique slugs", () => {
    const slugs = GUIDE_STEPS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("keeps each group contiguous", () => {
    const groups = groupedSteps().map((g) => g.group);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("loses no step when grouped", () => {
    const flattened = groupedSteps().flatMap((g) => g.steps.map((s) => s.index));
    expect(flattened).toEqual(GUIDE_STEPS.map((_, i) => i));
  });
});
