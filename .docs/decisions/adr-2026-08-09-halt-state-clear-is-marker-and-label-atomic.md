# ADR: Clearing the halt state removes the marker and the label together, and preserves draft

**Date:** 2026-08-09
**Status:** APPROVED (operator, 2026-08-09)
**Deciders:** James Stoup (operator), engineer session for intake #1415
**Feature:** auto-opened needs-remediation PR occupies the branch's retained draft-PR slot (ai-conductor#1415)
**Related:** `adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md` (establishes the one-PR rule this clears)

## Context

`adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md` makes the halt a removable state on the
branch's single PR. Something must remove it when the build resumes, and the daemon already runs a
sweep that actively *re-asserts* it.

`reconcileHaltPrs` (`halt-pr-reconciliation.ts:102`) enumerates open PRs and:

- **selects** on the body marker alone — `body.includes(NEEDS_REMEDIATION_BODY_MARKER)`
  (`halt-pr-reconciliation.ts:131`); a PR without the marker is never touched;
- **clears** a marked PR only when `.docs/shipped/<slug>.md` is committed on its head branch
  (`hasShippedRecordOnBranch`, `halt-pr-reconciliation.ts:60`) — a signal written at `finish`,
  far after a resume;
- otherwise **heals** the PR back to draft + labelled via `ensureHaltPresentation`
  (`halt-pr-reconciliation.ts:196`).

This makes a naive resume-time clear actively harmful. Removing only the label leaves the marker,
the sweep still selects the PR, sees `hasLabel === false`, classifies it non-conforming, and heals
the label straight back on the next tick. The deadlock would return in a worse form — daemon-driven,
and no longer traceable to a single HALT.

The complementary mistake is equally live: `cleanupHaltPresentation` (`pr-labels.ts:998`) by default
also flips the PR out of draft (Step 3). Doing that at resume would publish an in-flight build's PR
for review before any ship gate ran, which is exactly what
`adr-2026-07-29-ship-start-draft-pr-supersedes-self-host-precedence` and the finish-owned
`ensureShipReady` exist to prevent.

## Options Considered

**Option 1 — clear the label only.** Smallest change. Rejected: the sweep re-heals it, per the
selector above. This is not a race that a retry fixes; it recurs every tick.

**Option 2 — teach the sweep a second "resume" resolution signal** alongside the shipped record,
so it stops healing a PR whose feature is building again. Rejected as the primary mechanism: it
adds a second source of truth for "is this halt over" and leaves the marker on a PR that is no
longer halted, so a human reading the body still sees halt boilerplate.

**Option 3 (CHOSEN) — clear the marker and the label together, atomically, preserving draft.**
Reuse `cleanupHaltPresentation` with `opts.preserveDraft: true`, which already exists
(`pr-labels.ts:1004-1006`) and already carries the confirm-and-retry loop the label removal needs
(`pr-labels.ts:1018-1041`). Once the marker is gone the sweep no longer selects the PR at all, so
no second resolution signal is required and the two mechanisms cannot disagree.

## Decision

**A resume-time halt-state clear removes the body marker and the `needs-remediation` label as one
operation, and never changes draft status.**

1. The clear reuses `cleanupHaltPresentation(..., { preserveDraft: true })`. It is not a new
   mechanic and does not fork the existing one.
2. The marker is the reconciliation sweep's **sole** selector, so it must never be left behind by
   a partial clear. A clear that cannot confirm marker removal reports `partial` and is retried,
   exactly as label removal is today; it never reports success.
3. The draft→ready flip stays owned by `finish` (`ensureShipReady`). Nothing on the resume path
   makes a PR reviewable.
4. The halt narrative is **not** destroyed. The marked halt comment is superseded in place through
   the existing `upsertComment` marker discipline, so the PR thread records that the halt happened
   and that it was cleared — the same pattern `reconcileHaltPrs` uses at
   `halt-pr-reconciliation.ts:169`.
5. `hasShippedRecordOnBranch` remains the sweep's clear trigger for PRs that reach `finish`
   without a resume. This decision adds an earlier clearing path; it removes none.

## Assumptions and confidence

| Assumption | Basis | Confidence | If wrong |
|---|---|---|---|
| The sweep selects only on the body marker | verified — `halt-pr-reconciliation.ts:129-133` | 95% | Marker removal alone would not stop the re-heal; the sweep would need an explicit resume signal (Option 2) |
| The sweep's only clear trigger is a committed shipped record on the head branch | verified — `halt-pr-reconciliation.ts:158-160` | 95% | A resume-time clear might already exist and this ADR is redundant |
| `cleanupHaltPresentation` already supports preserving draft | verified — `pr-labels.ts:1004-1006` | 95% | A new preserve-draft variant is needed; decision unchanged, cost rises |
| Clearing at resume cannot strand a genuinely-unresolved halt | inferred — the daemon only re-dispatches after the HALT marker is cleared | 80% | A cleared label could hide a still-broken feature from an operator scanning the PR list; mitigated by the superseding halt comment, which stays on the thread |

## Consequences

**Positive.** Desired outcome 5 becomes literally true: clearing `.pipeline/HALT` and letting the
daemon re-dispatch is sufficient, with no hand-editing of titles, bodies, or labels. Outcome 3
follows once `finish` flips the PR ready — the label is genuinely gone, so `ci-fix.ts:264` and
`mergeable-sweep.ts:431` no longer withhold recovery.

**Negative.** The PR body loses its halt boilerplate on resume, so a human scanning bodies (rather
than the comment thread or the label) sees no trace of the halt. Accepted: the superseded comment
carries the narrative, and a body that still reads "manual remediation is required" on a building
feature is the worse lie.

**Ordering constraint for implementation.** The clear must run before the first task that consumes
the retained PR, and its confirm-retry must complete rather than being fire-and-forget — a clear
still in flight when the sweep ticks is the failure this ADR exists to prevent.
