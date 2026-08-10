# Conflict Report: One branch, one PR, one halt state (#1415)

**Date:** 2026-08-09
**Stories checked:** `.docs/stories/auto-opened-needs-remediation-pr-occupies-the-bran.md` (Stories 1–6)
**Checked against:** existing halt-PR stories (`finish-should-rewrite-stale-needs-remediation-titl`,
`reused-halt-pr-ships-with-halt-boilerplate-body-an`, `daemon-halt-reconciliation`,
`auto-resolve-open-pr-conflicts`, `daemon-false-ship-guard`, `mergeability-first-finish`,
`configurable-pr-timing`) and the APPROVED ADRs governing PR timing and halt-PR presentation
**Result:** 1 blocking conflict — **resolved**; 1 degrading conflict — **accepted**; re-check clean

---

## Conflict 1: Story 1 re-decided PR birth timing against an APPROVED ADR — RESOLVED

**Stories involved:** Story 1 (as originally written: "The implementation PR is born at BUILD
entry") vs `adr-2026-07-29-ship-start-draft-pr` (APPROVED)
**Files:** `.docs/stories/auto-opened-needs-remediation-pr-occupies-the-bran.md` vs
`.docs/decisions/adr-2026-07-29-ship-start-draft-pr.md`
**Type:** contradiction (design-rooted — §5c routes to architecture, not story phrasing)
**Severity:** blocking
**Confidence:** 95% — the contradicted text is quoted verbatim below, not inferred

**Description.** Story 1 specified opening the implementation draft PR at BUILD entry. The
2026-07-29 ADR evaluated exactly that under the name its own predecessor gave it — "Option C:
Publish at BUILD start (the spec's `early-draft` timing)" — and rejected it:

> A PR open for the entire build maximizes the window in which the branch is remotely visible but
> incomplete, and the operator's problem is specifically the ship tail. Also the largest change to
> the self-host guardrail surface.

Both cannot hold. The design review had recorded "no existing ADR is superseded" on the reasoning
that earlier birth *extends* the ship-start decision; that reasoning was wrong, because the ADR did
not merely omit BUILD-start timing, it considered and declined it.

**Resolution Options presented:**
1. Drop BUILD-entry birth; fix via adopt-and-repair at every retained-PR resolution plus the atomic
   resume clear. Nothing superseded, smallest diff.
2. Implement BUILD-entry birth behind the already-APPROVED-but-unimplemented `pr_timing:
   early-draft` key (`adr-2026-07-03-pr-timing-config-key`), whose BUILD-phase-publishing meaning
   the 2026-07-29 ADR explicitly left reserved. Honors both ADRs; adds a config key, resolver, docs.
3. Supersede `adr-2026-07-29-ship-start-draft-pr` with a new ADR moving birth to BUILD entry.

**Operator selected: Option 1** (2026-08-09).

**Applied changes:**
- Story 1 rewritten as "Every retained-PR resolution hands back a repaired implementation PR" —
  same requirement tags (OUT-1, OUT-2), no timing claim.
- Story 2 gained a negative path covering the surviving case: a HALT before any PR exists still
  creates the placeholder, and the *next dispatch* repairs it (Stories 1 and 3), so the retry is
  not blocked.
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` amended additively — the Options section and
  Decision consequence 1 carry `> **Amended 2026-08-09 by #1415**` notes; the original assertions
  are preserved, per the accepted-artifact amendment rule.
- `review-2026-08-09-halt-pr-occupies-retained-slot-1415` amended additively in its ADR section
  (the incorrect "extends, not contradicts" claim) and its Wiring Surface table (the withdrawn
  BUILD-entry surface).
- `adr-2026-07-29-ship-start-draft-pr` is **untouched** — no supersession, no status change.

---

## Conflict 2: Story 3's resume clear vs the reconciliation sweep's re-heal — DESIGNED OUT

**Stories involved:** Story 3 (resume clears the halt state) vs Story 4 / existing
`daemon-halt-reconciliation` behavior
**Type:** oscillating (checked in both directions)
**Severity:** would be blocking if unresolved — resolved in design before stories were written
**Confidence:** 95% — the selector and clear trigger were read directly

**Both directions tested.** *If Story 3 is fully satisfied (label removed at resume), does the
sweep's contract still hold?* No — the sweep selects on the body marker alone
(`halt-pr-reconciliation.ts:129`) and heals any marked PR missing its label back to draft+labelled
(`:196`), so it would undo the clear on the next tick. *If the sweep's contract is fully satisfied
(marked PRs stay labelled until a shipped record exists at `:158`), does Story 3 still hold?* No —
a resume happens long before `finish` writes that record, so the clear could never stick.

Two "no" answers: a genuine oscillation, and the expensive kind — each lap is a daemon tick, not a
failed build.

**Resolution:** already carried by `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`,
which removes the marker *and* the label as one confirmed operation. Once the marker is gone the
sweep no longer selects the PR at all, so the two mechanisms cannot disagree — rather than teaching
the sweep a second resolution signal, which would have left two sources of truth. Story 4 exists
specifically to hold this closed with an acceptance test.

No further action; recorded here because the pair must not be re-derived independently later.

---

## Conflict 3: Story 6's eligibility restoration vs draft-gating — DEGRADING, ACCEPTED

**Stories involved:** Story 6 (recovery paths eligible again) vs Story 1/`mergeable-sweep`
draft-skip behavior (`mergeable-sweep.ts:423,509`)
**Type:** behavioral overlap
**Severity:** degrading
**Confidence:** 90%

**Description.** Issue #1415's outcome 3 asks that the PR carrying the implementation "is not left
with recovery paths disabled." Clearing the label satisfies that, but draft-ness independently
keeps the PR out of both autoresolve and ci-fix dispatch until `finish` flips it ready. So between
resume and finish the PR is still not a recovery candidate — for a different and intentional
reason.

**Accepted compromise.** This is correct behavior, not a defect: acting on an in-flight build's PR
is exactly what the draft gate exists to prevent. Story 6 states it explicitly (happy path 3 and
negative path 2) so the distinction is asserted rather than discovered later. Outcome 3 is met in
the sense that matters — nothing is left *permanently* disabled by a sticky label.

---

## Pairs checked clean

| Pair | Result |
|---|---|
| Story 5 (adopt existing placeholder) vs `finish-should-rewrite-stale-needs-remediation-titl` | Compatible — Story 5 uses the same rehabilitation mechanics earlier in the run; the finish-time repair remains and is idempotent |
| Story 3 (preserve draft) vs `mergeability-first-finish` / `ensureShipReady` | No contention — the clear never touches draft status; finish keeps sole ownership of the ready-flip |
| Story 2 (decorate, don't create) vs `daemon-false-ship-guard` escalation path | Compatible — the false-ship escalation calls the same `escalateBuildFailure`, which gains adoption semantics without changing its trigger |
| Story 1 (repair on resolution) vs `auto-resolve-open-pr-conflicts` | No overlap — autoresolve operates on ready, mergeable PRs; the retained-PR resolution path is build-time |
| Story 4 vs `daemon-halt-reconciliation` shipped-record clear | Additive — the existing clear trigger is retained; a second, earlier clearing path is added |
| Story 6 vs `ci-fix` retry cap | No contention — this feature changes label state, not cap accounting |

## Re-check

Re-run after applying the Conflict 1 resolution: **zero blocking conflicts remain.** One degrading
conflict (Conflict 3) is accepted and documented in the stories themselves.
