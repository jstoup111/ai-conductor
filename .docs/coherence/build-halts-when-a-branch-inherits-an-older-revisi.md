# Coherence Check: Inherited-revision tolerance in the protected-artifact seal (#1315)

**Date:** 2026-08-05
**Tier:** M
**Track:** Technical
**Plan stem:** `build-halts-when-a-branch-inherits-an-older-revisi`
**Result:** COVERED — zero gaps

No `fr` rows are required: this is a technical-track spec with no PRD, so acceptance criteria live
directly in the stories. Outcome ids are 1-based in the order the bullets appear under the
**Desired outcome** heading of jstoup111/ai-conductor#1315.

Every `covered` verdict below was confirmed by reading the counterpart id in its own artifact file,
not inferred from a phrase match.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | "An unmodified, legitimately-inherited revision does not halt, even when the base amended it since the merge-base." Story 1 tags DO-1; its happy path is exactly that fixture, and Task 2's RED is required to fail with the issue's own `Protected artifact changed` symptom. |
| outcome | outcome-2 | story-2 | covered | "A branch that actually modified an artifact it does not own still halts, and tolerance never becomes a laundering path." Story 2 tags DO-2 with three adversarial negatives — committed edit, uncommitted edit, revert-to-historical-revision. |
| outcome | outcome-3 | story-3 | covered | "The halt message distinguishes modified-what-it-does-not-own from behind-the-base, and names the recovery." Story 3 tags DO-3. Note the shape: after this fix the behind-the-base case no longer refuses at all, so the distinction is realised as named causes across the refusals that remain, plus Story 1's assertion that the inherited case produces no halt text. |
| outcome | outcome-4 | story-4 | covered | "If a stale or unresolvable base makes an inherited artifact look modified, the refusal says so and a rebase is identifiable from the halt text alone." Story 4 tags DO-4; its absent-merge-base criterion requires the rebase recovery by name. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5, task-15 | covered | Fixture that makes the case reachable (1), the probe and union (2), the `added` branch (3), the C-1 union guard (4), the laziness guard (5), end-to-end acceptance (15). |
| story | story-2 | task-6, task-7, task-8, task-9 | covered | Committed modification (6), uncommitted edit (7), revert-to-historical (8), deletion and self-amendment left untouched (9). |
| story | story-3 | task-10, task-11 | covered | Cause type, recovery text, and first-line contract (10); halt-class pin across the wording change (11). |
| story | story-4 | task-12, task-13, task-14 | covered | Unresolvable base ref (12), absent merge-base with the rebase recovery (13), any other probe failure failing closed (14). |
| task | task-1 | story-1 | covered | Test infrastructure; without it base tip and HEAD are always the same commit and Story 1's RED cannot exist. Review condition C-2. |
| task | task-2 | story-1 | covered | Happy path — the core widening; RED pinned to #1315's exact symptom. |
| task | task-3 | story-1 | covered | Happy path — the `added` refusal branch reaches the same predicate. |
| task | task-4 | story-1 | covered | Negative-of-the-fix — pins that base-tip acceptance survives, satisfying C-1. |
| task | task-5 | story-1 | covered | Happy path — clean workspace still makes zero git invocations. |
| task | task-6 | story-2 | covered | Negative path — committed modification while behind still refuses. |
| task | task-7 | story-2 | covered | Negative path — uncommitted worktree edit refuses. |
| task | task-8 | story-2 | covered | Negative path — revert to a historical base revision refuses. |
| task | task-9 | story-2 | covered | Negative path — `deleted` branch unreachable by the predicate; self-amendment assertions unmodified. |
| task | task-10 | story-3 | covered | Happy path — cause and recovery rendered, classification first. Also migrates the existing text assertions in two test files. |
| task | task-11 | story-3 | covered | Negative path — the machine-readable discriminator `HALT.class` is unchanged by the wording change. |
| task | task-12 | story-4 | covered | Happy path — the interactive no-`baseBranch` shape reports undeterminable rather than a bare classification. |
| task | task-13 | story-4 | covered | Happy path — absent merge-base names rebasing as the recovery, satisfying outcome-4's "without reading engine source". |
| task | task-14 | story-4 | covered | Negative path — every probe failure fails closed; undeterminable wording not used for a real modification. C-4. |
| task | task-15 | story-1 | covered | Acceptance — the #1315 shape at the conductor seam, plus its tampering counterpart. |

## Review conditions

- **C-1 union, not replacement** — task-4 pins it as a test; the plan's Technical Approach states it.
- **C-2 fixture before behavior** — task-1, sequenced first in the dependency graph.
- **C-3 classification on line 1** — story-3's third happy-path criterion, task-10, task-11.
- **C-4 probe failure denies tolerance** — story-4's first negative criterion, task-12 through task-14.
- **C-5 documentation** — not a plan task by repository convention; routed through the
  `maintain-documentation` custom step and recorded in the plan's Prerequisites.

## Notes on shape

The one place where the issue's wording and the delivered design do not map one-to-one is
outcome-3. The issue asks the refusal to distinguish "behind the base" from "modified what it does
not own" — written before it was settled that "behind the base" would stop being a refusal at all.
The spec covers the intent rather than the literal phrasing: the inherited case produces no halt
(story-1), and the refusals that remain each name their own cause and recovery (story-3, story-4).
This is recorded here rather than silently reinterpreted.
