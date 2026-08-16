# Conflict Report: Verify-Only-Anchored Tautology Exception (#1579)

**Date:** 2026-08-15
**Corpus:** change-set ADRs (`adr-2026-08-15-verify-only-anchored-tautology-exemption.md`) plus the
argument-named precedents (`adr-2026-08-12-removal-anchored-tautology-exemption.md`,
`adr-2026-07-07-build-review-judgement-gate.md`) and all `.docs/stories/` files touching
build_review, tautology, or verify-only machinery.
**Result after resolution:** clean — zero blocking conflicts remain.

## Conflict 1: Fourth exception contradicts the "exactly three" shipped-count assertions

**Stories involved:** Story 2 (this feature) vs fixture-relocation acceptance criterion; also the
two-entry Done-When in the removal-exemption stories
**Files:** `.docs/stories/tautology-fails-are-unfixable-when-planned-behavio.md` vs
`.docs/stories/tautology-rubric-grades-diff-required-fixture-relo.md` and
`.docs/stories/repeated-build-review-semantic-failures-can-churn-.md`
**Type:** contradiction
**Severity:** blocking
**Story opposing sentence (verbatim):** "the Tautology exceptions section enumerates exactly three
closed-list entries and the third is fixture relocation […]"
**This feature's opposing sentence (verbatim):** "then it enumerates four exceptions and states the
three-condition per-test verify-only-maintenance predicate […]"

**Description:** Prior accepted stories pin the shipped closed-list entry count (three, and
earlier two); this feature grows the list to four. Both cannot hold. Confidence 100% — verbatim
text both sides.

**Resolution (applied, Option 1):** additive `> Amended 2026-08-15 by #1579` notes on both prior
stories recording the new count while preserving the closed-list property and their own
predicates. The plan must also update the existing count-sensitive prompt test
(`src/conductor/test/engine/build-review-prompt.test.ts:399` region).

## Conflict 2: Story 4's task-status write contends with #677's Evidence-trailer skipped channel

**Stories involved:** Story 4 (this feature) vs #677 Story 5 (`Evidence: skipped` commit form)
**Files:** `.docs/stories/tautology-fails-are-unfixable-when-planned-behavio.md` vs
`.docs/stories/verify-only-prove-closed-task-evidence.md`
**Type:** resource-contention
**Severity:** degrading
**Description:** Story 4 originally instructed a direct `.pipeline/task-status.json` `skipped`
write; #677's shipped mechanism derives `status:'skipped'` from an empty commit carrying
`Task: <id>` + `Evidence: skipped <reason>`. Two channels for one concern; the direct write is
also non-durable (`.pipeline/` is lost on worktree recreation).

**Resolution (applied, Option 2 — meet on the existing channel):** Story 4 and ADR D5 (additive
amendment note) reworded to route the discovered-case closure through the `Evidence: skipped`
empty-commit mechanism. No-operator/no-plan-edit property preserved.

## Re-check

Both directions tested on every pair sharing the tautology exception list, the verify-only
markers, or the skipped-closure channel; no oscillation found (the exception growth and the prior
closed-list stories are compatible once the count amendments land; the closure channel is now
single). Clean pass.
