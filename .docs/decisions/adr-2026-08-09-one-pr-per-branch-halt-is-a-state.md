# ADR: A feature branch has exactly one PR; a HALT is a state on it, never a second PR

**Date:** 2026-08-09
**Status:** APPROVED (operator, 2026-08-09)
**Deciders:** James Stoup (operator), engineer session for intake #1415
**Feature:** auto-opened needs-remediation PR occupies the branch's retained draft-PR slot (ai-conductor#1415)
**Related:** `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md` (how the state is cleared),
`adr-2026-07-29-ship-start-draft-pr-supersedes-self-host-precedence.md` (the decision this one moves earlier)

## Context

A GitHub branch has exactly one open PR slot. The conductor today competes with itself for it
with two different PR *shapes*:

| Shape | Born in | Title | Presentation |
|---|---|---|---|
| Implementation PR | SHIP entry, `openShipDraftPr` via `conductor.ts` | `feat: «desc»` | draft, no label |
| Remediation placeholder | any irrecoverable HALT with commits, `escalateBuildFailure` | `needs-remediation: «branch» — manual remediation required` | draft, `needs-remediation` label, `<!-- conductor:needs-remediation -->` body marker |

Whichever is created first owns the slot. The repair that converts the second into the first —
`makeRetainedPrPresentable` (`halt-pr-rehabilitation.ts:495`) — exists and is correct, but has
**exactly one call site**: `conductor.ts:4051`, guarded by `step.phase === 'SHIP'` **and** an
`openShipDraftPr` outcome of `published` (verified by grep across `src/conductor/src`; the only
other reference is a doc comment in `ship-draft-pr.ts:67`).

Issue #1415's observed deadlock happened in **BUILD** (`attempt …:build:2`), a phase that never
reaches that call site. The retry therefore found a placeholder it refused, re-asked for a PR it
could never be granted, and burned its attempt budget. `resolveRetainedShipDraftPrUrl`
(`conductor.ts:3092`) would have *returned* the placeholder to the release gate — it matches any
OPEN head/base PR with no marker or label filter — but it applies no repair on the way through,
so the placeholder reaches consumers unrepaired.

The sticky label independently disables two recovery paths on whatever PR carries it
(`ci-fix.ts:264`, `mergeable-sweep.ts:431`), so the stranding is not merely cosmetic.

Two placeholders were in this state when the issue was filed: #1395 and #1412.

## Options Considered

**Option 1 — one adopt+repair seam on every retained-PR resolution.** Fold
`makeRetainedPrPresentable` into `resolveRetainedShipDraftPrUrl` so every consumer gets a repaired
PR. Cheapest, reuses tested machinery. But it only *adopts* — a HALT that lands before any PR
exists still leaves the retry with nothing to adopt, which is precisely the #1415 timeline (the
first HALT preceded any PR). It treats the symptom.

**Option 2 (CHOSEN, as amended) — demote escalation to a decorator and repair on adoption.**
Escalation stops being a distinct *shape*: `findOrCreatePr` already adopts an existing OPEN PR
untouched, so `escalateBuildFailure` decorates whatever PR is there with the label, the body
marker and the halt comment. Wherever the retained PR is *resolved*, its halt state is repaired
first, so a branch has one PR whose halt condition is a *removable state* rather than a second
immutable shape competing for the slot.

> **Amended 2026-08-09 by #1415 (conflict-check resolution):** as originally written this option
> also moved PR birth from SHIP entry to BUILD entry. `/conflict-check` found that
> `adr-2026-07-29-ship-start-draft-pr` had already considered that exact move as its Option C and
> **rejected** it ("a PR open for the entire build maximizes the window in which the branch is
> remotely visible but incomplete… the largest change to the self-host guardrail surface").
> The operator resolved the conflict by keeping SHIP-entry birth unchanged. The one-PR rule and
> escalation-as-decorator stand; the timing change is withdrawn. Issue #1415's outcome 1
> explicitly permits either adoption *or* a usable slot, and adoption is what this ADR now
> specifies.

**Option 3 — escalate with no PR at all** (the filer's second hypothesis): report the HALT only
via the event spine, `.pipeline/HALT`, and an issue comment. Rejected on the issue's own terms —
it satisfies "the slot stays free" while *failing* desired outcome 1, because the retry still
finds no retained PR and asks for one it cannot get. It also removes the operator's single-glance
"this branch needs me" surface that the PR list provides today.

## Decision

**A feature branch has exactly one pull request. Its halt condition is a state carried on that
PR — the `needs-remediation` label plus the body marker — never a second pull request.**

Consequences that follow directly:

1. **The halt-state repair is unbound from SHIP entry.** Wherever the conductor resolves the
   branch's retained PR — `resolveRetainedShipDraftPrUrl` as well as the SHIP-entry adoption site —
   the PR's halt state is repaired before the URL is handed to any consumer, so no consumer ever
   receives a placeholder it can only refuse.

   > **Amended 2026-08-09 by #1415 (conflict-check resolution):** this consequence originally read
   > "`openShipDraftPr` is invoked at **BUILD entry** rather than SHIP entry." PR *timing* is
   > unchanged by this ADR — `adr-2026-07-29-ship-start-draft-pr` continues to own it, and SHIP
   > entry remains the sole birth site. What changes is *where the repair runs*, not when the PR is
   > created.
2. `escalateBuildFailure` is a **decorator**. Its `commitCount === 0` conservative no-op stays
   exactly as it is (`build-failure-escalation.ts:135`) — this ADR does not invent an escalation
   surface for the pre-first-commit window, because there is nothing to decorate there and the
   HALT is already durable in `.pipeline/HALT` and on the event spine.
3. The `needs-remediation:` **title shape stops being how a human identifies a halted branch.**
   The label is that signal. `retitleFloor` remains, because branches already carrying the old
   title shape (#1395, #1412) must still be rehabilitated.
4. Draft-ness continues to gate everything downstream. `mergeable-sweep.ts:423,509` skips draft
   PRs for both autoresolve and ci-fix dispatch, so an earlier-born draft is inert to the sweep
   until `finish` flips it ready (`ensureShipReady`). Moving birth earlier therefore does **not**
   expose an in-flight build to merge or CI-fix machinery.

## Assumptions and confidence

| Assumption | Basis | Confidence | If wrong |
|---|---|---|---|
| `makeRetainedPrPresentable` is reachable only from the SHIP-entry `published` path | verified — grep over `src/conductor/src`, one call site | 95% | The defect has a second cause; the fix is still correct but incomplete |
| The #1415 deadlock occurred in BUILD, where that path never runs | inferred — daemon log shows `attempt …:build:2`; the Task 15 prompt itself was not traced | 85% | The repair would be unbound from SHIP entry for no benefit; escalation-as-decorator still fixes the slot contention |
| `findOrCreatePr` adopts an existing OPEN PR without rewriting title or body | verified — `pr-labels.ts:409`, and the `conductor.ts:4042` comment states it | 95% | Escalation would clobber the implementation PR's title; adoption must then be made explicit |
| A draft PR is skipped by autoresolve and ci-fix dispatch | verified — `mergeable-sweep.ts:423,509` | 95% | Earlier birth would expose in-flight builds to the sweep, needing an explicit draft guard |

No load-bearing assumption is unconfirmed at the level that would change this decision: the one
inferred item (85%) affects *where* the fix pays off, not whether the one-PR rule is right.

## Consequences

**Positive.** The deadlock class disappears rather than being handled: there is no second shape to
collide with. Desired outcome 4 (operator can tell a live PR from a placeholder) becomes true by
construction — label present means awaiting a human. Outcome 5 (clear the HALT, re-dispatch,
resume) becomes reachable because the state is removable.

**Negative.** A feature that HALTs before any PR exists still spends that first attempt on the
HALT: escalation then creates the PR, and only the *retry* finds an adoptable one. This ADR makes
the retry succeed; it does not prevent the initial HALT. Preventing that would require moving PR
birth earlier, which `adr-2026-07-29-ship-start-draft-pr` decided against and the operator
reaffirmed on 2026-08-09.

**Migration.** Branches already carrying a placeholder (#1395, #1412) are not abandoned —
`makeRetainedPrPresentable` remains the adoption/rehabilitation path and is what converts them.
