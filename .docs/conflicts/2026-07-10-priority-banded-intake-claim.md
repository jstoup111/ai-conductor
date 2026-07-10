# Conflict Report: Priority-banded intake claim (#461)

**Date:** 2026-07-10
**New stories:** `.docs/stories/2026-07-10-priority-banded-intake-claim.md`
**Scanned:** all `.docs/stories/` (8 files in the intake/claim area read pairwise against the
new stories), `.docs/specs/` context, prior conflict reports, and all 21 unmerged `origin/spec/*`
branches (zero touch `dependency-claim.ts`, `backlog-priority.ts`, or `intake/` — verified via
`git log main..<branch>`).
**Result:** 2 intentional-supersession overlaps found and resolved by amendment notes; zero
blocking conflicts remain.

## Conflict 1: CLI claim order — "oldest" vs "banded"

**Stories involved:** "Poll-on-launch wiring" + "Atomic claim prevents double-processing"
(phase-9.3b, FR-30/FR-31, as-built/shipped) vs "Claim serves the highest-priority band first" (TR-1)
**Files:** `phase-9.3b-github-intake-writeback.md` vs `2026-07-10-priority-banded-intake-claim.md`
**Type:** contradiction (at the CLI-selection level only)
**Severity:** degrading (intentional behavior change, rooted in APPROVED
`adr-2026-07-10-intake-claim-priority-banding` which amends ADR-011's selection order)

**Description:** FR-30/FR-31 assert end-to-end claim serves the *oldest* pending Envelope.
#461's whole purpose is to change that to band-first. The queue-level primitive assertion
(`claim()` returns oldest-by-`receivedAt`) is NOT in conflict — the primitive is untouched;
banding sorts envelopes the walk holds above it. Concurrency/atomicity scenarios unaffected.

**Resolution applied:** amendment note added to Story 6/7 in
`phase-9.3b-github-intake-writeback.md` scoping "oldest" to the queue primitive and marking the
CLI-level order as amended by #461. No superseding ADR needed (already covered by the new ADR).

## Conflict 2: Deferral walk order — "age order" vs "banded order"

**Stories involved:** "Intake claims the oldest unblocked idea" (FR-8,
dependency-ordered-intake-and-dispatch, shipped) vs TR-1/TR-4
**Type:** behavioral overlap
**Severity:** degrading (same intentional supersession)

**Description:** FR-8's scenario text says "deferral walks the whole queue in age order."
After #461 the walk order is banded (age order within band). The deferral *semantics* FR-8
actually gates on — stateless deferral, no attempt increment, whole-queue walk, fail-closed
indeterminate — are unchanged and re-asserted by TR-4.

**Resolution applied:** amendment note added above FR-8's story scoping the walk order to
banded, scenarios remaining valid for same-band entries.

## Checked and clean

- `engineer-claim-delivery-guard.md` — guard makes no ordering assertions; hold/release
  composition verified in source during architecture-review. Reasoned pair, clean.
- `2026-07-03-daemon-issue-priority-scheduling.md` — daemon backlog scheduler; shares the
  band vocabulary by design (single exported ranking). No resource contention: different
  queue, different process. Clean.
- `background-intake-conduct-loop.md` — brain loop polls/enqueues/notifies only; no
  selection-order assertions. Clean.
- `intake-issue-pr-link-autoclose.md`, `2026-07-03-intake-marker-plan-stem-keying.md` —
  post-claim lifecycle; order-independent. Clean.
- **Sequencing:** no unmerged spec/* branch touches the claim path (verified); no circular
  dependency introduced.
- **Resource contention:** the new code reads labels via `gh api` (read-only, shared with
  daemon resolver by design — same vocabulary, separate invocations). No shared mutable state
  added.

## Verdict

**Conflict check passed** — zero blocking conflicts; two degrading overlaps resolved by
amendment notes on the superseded story text (both rooted in the APPROVED ADR's intentional
amendment of ADR-011's selection order).
