# Coherence Mapping: One branch, one PR, one halt state (#1415)

**Date:** 2026-08-09
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD); intake outcomes carry the
requirement layer directly.
**Source-Ref:** jstoup111/ai-conductor#1415
**Artifacts:** `.docs/stories/auto-opened-needs-remediation-pr-occupies-the-bran.md` (Stories 1–6),
`.docs/plans/auto-opened-needs-remediation-pr-occupies-the-bran.md` (Tasks 1–15),
`.pipeline/intake-outcomes.md` (5 desired-outcome bullets)

Every `covered` verdict below was confirmed by reading the counterpart id in its own artifact
file. The §4d consistency pass was run over every covered row in both directions; findings are in
the Notes column.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-5 | covered | "either by adopting that PR or by having a slot it can still use" — the spec takes the adoption branch. story-1 repairs the PR at every retained-PR resolution; story-5 covers the already-placeholdered branch. Cross-layer check vs task-6/task-9: both deliver adoption, neither claims a new slot. |
| outcome | outcome-2 | story-1, story-2, story-5 | covered | story-2 makes escalation a decorator so a second refused shape is never born; story-1 repairs any that already exists. Residual honestly stated in the ADR: a HALT before any PR exists still creates the placeholder — the *retry* then adopts it, which is what outcome-1 asks for. |
| outcome | outcome-3 | story-6 | covered | Scope stated explicitly, not papered over. Label-based suppression (`ci-fix.ts:264`, `mergeable-sweep.ts:431`) is genuinely lifted; draft-based suppression is not, and must not be — between resume and finish the PR is still skipped by `mergeable-sweep.ts:423,509` because it is a draft, which is what the draft gate exists to do. Accepted degrading conflict, recorded as Conflict 3 in `.docs/conflicts/2026-08-09-halt-pr-occupies-retained-slot-1415.md`. Outcome-3 is met in the sense that matters: nothing is left *permanently* disabled by a sticky label, and story-6 asserts both halves (happy-path 3 and negative-path 2) rather than leaving the distinction to be discovered. |
| outcome | outcome-4 | story-2 | covered | story-2 happy-path 3 asserts the label alone distinguishes a halted branch without reading title or body. Cross-layer check vs task-10: the task asserts the `feat:` title survives decoration, so the two signals agree rather than competing. |
| outcome | outcome-5 | story-3, story-4 | covered | story-3 clears marker + label at the dispatch boundary; story-4 holds the reconciliation sweep from re-healing it. Both are required — story-3 alone would be undone on the next daemon tick, which is the oscillation §4d exists to catch and which was resolved in design rather than left to BUILD. |
| story | story-1 | task-6, task-7, task-8 | covered | task-6 adds the repair inside `resolveRetainedShipDraftPrUrl`; task-7 holds the never-halted path to one read and zero writes; task-8 keeps closed/merged PRs unadoptable. All three cite `**Story:** 1`. |
| story | story-2 | task-10, task-11 | covered | task-10 proves adoption leaves title and body prose unchanged; task-11 proves the zero-commit and failed-push guards. |
| story | story-3 | task-1, task-2, task-3, task-4, task-5, task-9 | covered | task-1 the primitive, task-2 draft preservation, task-3 the `partial` semantics, task-4 degradation, task-5 the superseding comment, task-9 the once-per-run boundary call. |
| story | story-4 | task-12, task-13 | covered | task-12 asserts zero mutating sweep calls after a clear; task-13 asserts a partial clear converges across dispatches instead of oscillating. |
| story | story-5 | task-14 | covered | task-14 covers both the #1412 placeholder shape and the hand-repaired-title case. Depends on task-6 and task-9, so the recovery is exercised through the production path rather than a bespoke one. |
| story | story-6 | task-15 | covered | task-15 asserts the full eligibility matrix: cleared+ready eligible, still-labelled ineligible, cleared+draft still skipped. |
| task | task-1 | story-3 | covered | Adds `clearHaltStateForResume`; wired `none (inert until src/conductor/src/engine/conductor.ts)` pending task-9. |
| task | task-2 | story-3 | covered | Draft preservation — serves story-3 happy-path 2. |
| task | task-3 | story-3 | covered | `partial` on unconfirmed removal — serves story-3 negative-paths 1 and 2. |
| task | task-4 | story-3 | covered | gh-unavailable and marker-less cases — serves story-3 negative-paths 3 and 4. |
| task | task-5 | story-3 | covered | Superseding halt comment — serves story-3 happy-path 3. |
| task | task-6 | story-1 | covered | Repair on resolution — serves story-1 happy-path 1. Anchor `conductor.ts#resolveRetainedShipDraftPrUrl` validated (0 FAIL) and judged non-self-referential. |
| task | task-7 | story-1 | covered | Zero-mutation cost — serves story-1 happy-path 3 and negative-path retry semantics. |
| task | task-8 | story-1 | covered | Closed/merged never adopted — serves story-1 negative-path 2. |
| task | task-9 | story-3 | covered | Typed `infrastructure`; its supporting purpose is the dispatch-boundary wiring that makes story-3's clear reachable from BUILD, where the reported deadlock occurred. Not an unattached task. |
| task | task-10 | story-2 | covered | Adoption without retitle — serves story-2 happy-path 1. |
| task | task-11 | story-2 | covered | Zero-commit and push-failure guards — serves story-2 negative-paths 2 and 3. |
| task | task-12 | story-4 | covered | Sweep leaves a cleared PR alone — serves story-4 happy-path 1. |
| task | task-13 | story-4 | covered | Partial-clear convergence — serves story-4 negative-path 1. |
| task | task-14 | story-5 | covered | Placeholder recovery — serves story-5 happy-path 1 and negative-path 1. |
| task | task-15 | story-6 | covered | Eligibility matrix — serves story-6 happy paths 1–3 and negative-path 2. |

## Consistency pass (§4d)

Cross-layer pairs were checked in both directions. Two were non-obvious and are recorded here
rather than left implicit:

**outcome-5 ↔ story-4 / the reconciliation sweep.** *If outcome-5 is fully satisfied (clearing the
HALT and re-dispatching resumes the build), does the sweep's existing contract still hold?* Only
because the clear removes the body marker — the sweep's sole selector
(`halt-pr-reconciliation.ts:129`). *If the sweep's contract is fully satisfied (marked PRs stay
labelled until a shipped record exists, `:158`), does outcome-5 still hold?* No — a resume happens
long before `finish` writes that record. This is a true oscillation, and it was designed out in
`adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` before stories were written rather
than discovered as unexplained rework. No `fail` row: the contradiction does not survive into the
spec.

**outcome-3 ↔ story-6 / draft gating.** *If outcome-3 is read as "eligible immediately after
resume," does the draft gate still hold?* No. *If the draft gate holds, is outcome-3 satisfied?*
Only under the narrower reading — "not left with recovery paths disabled." The operator accepted
the narrower reading as Conflict 3 (degrading, accepted). Recorded as `covered` with the scope
stated in its own row rather than silently credited, because a reader checking outcome-3 against
the shipped behavior must see the boundary.

**No `fail` rows.** No cited counterpart contradicts what it implements. Zero `gap` rows: every
outcome maps to at least one story, every story to at least one task, and every task to a story.
