# Architecture Review: intake label authority (#889)

**Date:** 2026-07-23
**Tier:** M — lightweight review
**Design:** adr-2026-07-23-intake-label-authority-scoped-replace (APPROVED)
**Status:** APPROVED WITH CONDITIONS 1–4
**Source:** jstoup111/ai-conductor#889

## Verdict

The design is architecturally sound and correctly located. The defect is a **missing
authority contract in a shared seam**, and the fix is placed in that seam
(`syncIssueLabels`) rather than in either caller — so all three consumers
(`intake-label-sync-apply.mts`, `bin/intake-file`, `bin/intake-backfill`) inherit the
correction and cannot drift. Per this repo's Design Principle, the enforcement is
mechanical (a convergent write in code), not prompt- or convention-level.

The strongest property of the design is that it makes the **working path provably
untouched**: `extractField`'s regex is unchanged, so the issue-form rendering that works
today cannot regress by construction. Moving the adaptation to the *producer* side
(`bin/intake-file` emits the shape the parser already knows) instead of the *parser* side
is the right direction of coupling — one parser, N producers.

## Findings

### F1 — The existing idempotency test is false-green (must be fixed, not extended)
`test/acceptance/intake-form-label-sync.test.ts` "re-edit with identical values is
idempotent" passes today with the bug live, because it re-runs the seam with the *same*
field values and asserts the second applied set equals the first. Duplication requires a
computed value that **differs** from a label already present — precisely the case the test
omits. Confidence: verified (test read in full). Leaving it as-is would let the same class
of defect return silently.

### F2 — A true full replace would be destructive, and the header currently prescribes it
The workflow header instructs a future maintainer toward `PUT .../labels`, which replaces
the *entire* label set. On these issues that set includes `engineer:handled` and
`blocked_by:#N` edge labels that other engine components (`createDependencyLinks`,
`backlog-priority`) read. Implementing the header literally would silently break dependency
scheduling. The header is not a harmless stale comment — it is an active hazard, and
correcting it is in-scope, not cosmetic.

### F3 — Read-then-write is not atomic; convergence, not locking, is the answer
The scoped replace reads current labels then writes. Two concurrent syncs could interleave.
The design handles this correctly by making both producers derive the *same* value, so any
interleaving converges to the same end state; no locking or serialization is introduced.
This must be an explicit invariant, not an accident.

### F4 — `backfill.ts` currently cannot see the problem it needs to fix
`backfill.ts` skips any issue where `parseSizeLabel`/`parsePriorityLabels` return a value —
and both return the *highest-ranked* match, so an issue with two size labels reads as
"already labelled" and is skipped with zero `gh` calls. The dedupe sweep therefore cannot
be a mode of the existing skip logic; it needs its own predicate (namespace **cardinality**
> 1), or it will no-op over all 23 issues.

### F5 — Out of scope, flagged: the workflow has no intake-only filter
`on: issues [opened, edited]` carries no label or author filter and the job has no `if:`,
so *every* issue opened or body-edited in the repo gets `priority:`/`size:` stamped,
despite the header describing it as intake-only. This is pre-existing and unchanged by this
design (an issue with an empty namespace still receives a default, before and after). It is
**not** fixed here — file separately. Noted so the next reader does not mistake it for
collateral damage of this change.

## Conditions

1. **Fix F1 in place.** The existing "re-edit ... idempotent" acceptance test must be
   rewritten to use *differing* values (a computed default meeting an explicit label
   already on the issue) and must be demonstrated RED against current `main` before the
   implementation lands. A test that only passes after the fix, and would have passed
   before it, does not count as coverage for this bug.
2. **Scoped delete, never `PUT`.** Removal must go through `restRemoveLabelArgs` filtered
   to `^priority: ` / `^size: `. No code path may replace the whole label set. Add a test
   pinning that a co-resident `engineer:handled` and a `blocked_by:#123` label survive a
   sync untouched.
3. **State convergence as a tested invariant (F3).** Pin, in a test, that for a given issue
   the seam's end state is identical whether the CLI's apply or the workflow's apply runs
   last — the property that retires the race rather than narrowing it.
4. **Dedupe gets its own cardinality predicate and a dry-run (F4).** The sweep must select
   on "more than one label in the namespace", not on the existing "has a parsed value" skip.
   It must default to reporting and require an explicit flag to write, and it must leave
   any namespace with two or more **non-default** members untouched, reporting it for human
   resolution rather than guessing.
