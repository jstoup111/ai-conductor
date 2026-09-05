# Architecture Review: A halted feature only re-runs when a human clears it, even for retryable failures (#2190)
**Date:** 2026-09-05
**Mode:** pre-stories, lightweight (Tier M)
**Inputs reviewed:** `.docs/track/`, `.docs/complexity/`, `.docs/architecture/<slug>.md`, `.docs/architecture/sequences/<slug>.md`, the explore decision record; repo-wide ADR sweep (all 305 `adr-*.md` read)
**Verdict:** APPROVED WITH CONDITIONS (BLOCKED at first pass; resolved by operator decision R + absorb, 2026-09-05)

## Feasibility

The explore-approved design — a typed DEFERRED record in the worktree, a daemon-side backoff timer
that re-dispatches it, conversion to `needs-human` at a bound, and a `daemon grant --laps N` verb
under `.daemon/grants` that records the grant and clears a `kickback-cap` HALT in one command — is
buildable on the current stack. It is not buildable **in compliance with the APPROVED ADR corpus**:
it re-decides five structural questions the repository has already decided the other way, and the
grant half is already the subject of an APPROVED ADR with a parked implementing feature.

Findings that change the design (all verified by reading the cited ADR's Decision section and the
cited source):

1. **Every one of the four "retryable" raisers already has a decided, fail-closed home.**
   - *Validation-group no-verdict* — `adr-2026-07-10-validation-group-join` §2: "infra fails fast … a
     no-verdict branch fails the group → halt." The cause is the member attempt budget of `1`
     (`conductor.ts` group-branch dispatch, the trailing literal) versus 3 on the serial path — #1425.
   - *Provider 5xx* outside a group — already inside the step retry ladder (3 attempts + escalation,
     `adr-2026-07-05-retry-as-escalation-ladder`); shared-cause provider unavailability is a
     daemon-level pause, not a per-feature marker (`adr-2026-07-05-daemon-rate-limit-episode-coordinator`,
     `adr-2026-07-22-daemon-level-missing-credential-gate`, `adr-2026-07-04-auth-failure-park-and-poll`).
   - *Self-host live-boundary trip* — `adr-2026-08-17-structural-live-checkout-containment` §4 and
     `adr-2026-06-30-halt-based-release-gates`: fail-closed HALT, deliberately. A timed retry
     re-fingerprints from the drifted state and proceeds, which defeats the guard's purpose (a self-host
     process rewriting operator config). #1301 owns attribution, the only durable fix.
   - *Protected-artifact seal error* — `adr-2026-07-26-protected-artifact-seal-rebaseline` §2 and
     `adr-2026-08-05-provenance-based-protected-artifact-inheritance`: fail-closed refusal naming its
     cause; indeterminate provenance is treated as feature-authored. Not a candidate for a timer.
   - *test_suite infrastructure failure* — written `needs-human` immediately with **no** retry
     (`conductor.ts`, the `fullSuiteFailure.reason !== 'nonzero_exit'` branch). This is the one genuine
     gap: no ADR forbids a bounded in-step retry, and `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
     already decided the exact shape (typed fault → non-charging bounded lane → `needs-human` naming
     the allowance spent).

2. **A clock-resumed marker conflicts with the daemon's resume model.**
   `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` §4: "the daemon must treat that
   marker as the sole resume condition … This ADR does not introduce automatic retry."
   `adr-2026-07-27-daemon-decide-kickback-halt`: "A guard whose halt the daemon auto-clears is not a
   guard — the single most load-bearing detail." `adr-2026-07-13-retry-classify-rerun-vs-route` D2/D6
   own the retry-decision seam (`classifyRetryDecision`, `retry_routing`); a third outcome belongs
   there, not in a new dispatch-loop state. `adr-2026-07-28-total-halt-classification-legacy-boundary`
   D2 fixes exactly four read dispositions; DEFERRED would be a fifth.

3. **The laps grant is already decided, in a different shape, by an APPROVED ADR.**
   `adr-2026-08-29-operator-authorized-kickback-budget-recovery` (D1–D8 binding; halt-class naming
   superseded by `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`): the command
   is `ai-conductor kickback-budget raise --feature <slug> --by N --rationale …` / `reset`; the
   adjustment lives in the kickback ledger with a lease and a staged journal; and **D6: "The daemon,
   not the CLI, clears the halt."** `adr-2026-08-03-fail-closed-decide-entry` D6 says the same from
   the other side: "Clearing the HALT is not a grant"; a grant is independent of the marker. The
   explore design fused grant-write and halt-clear in one CLI action, which both ADRs forbid — and the
   operator's desired outcome ("one command that records the grant and clears the halt together") is
   still met in effect: one operator command, then the daemon clears on its next boundary.
   The implementing feature, `the-cumulative-kickback-cap-never-resets-so-a-reco`, is **parked**,
   halted on a prd_audit growth cap, PR #2106 closed. The grant half of #2190 is that feature's
   deliverable.

4. **The grant must key on ledger evidence, not on `HALT.class`.** 08-29 D3 binds resume
   authorization "to the live typed cap evidence and generation." The cumulative `build_review` cap
   writes `needs-human` (08-29 successor D1) while as-built lap caps write `kickback-cap`
   (`adr-2026-08-25` D4), so "refuse unless class is kickback-cap" would be wrong for the very halt
   08-29 was written for. The explore rule is withdrawn.

5. **`mechanical` is not "transient".** Its 13 writers include three budget halts (manual-test cap,
   test_suite cap, per-gate remediation budget), parser faults, and "skill not in provider catalog".
   Retiring it wholesale — as explore proposed — would timer-retry budget exhaustion. Already
   corrected in the diagrams (operator-approved during this review). The three budget halts should
   write `needs-human` (08-29 successor D1 precedent), so the base-advance sweep stops auto-clearing
   a budget exhaustion (`adr-2026-07-26-cross-dispatch-kickback-livelock-bound` D4).

6. **Defect found, out of scope:** `protected-artifact` is absent from `isOperatorActionHalt`
   (`halt-marker.ts`), so seal-error halts are already re-kicked by the base-advance sweep — the
   opposite of what `adr-2026-07-26-…-seal-rebaseline` decided. File as intake; do not fix here.

## Alignment

Domain boundaries: the explore design placed a fourth stop state (DEFERRED) beside halted/parked/
paused and a second grant kind beside the DECIDE grant; both are the "parallel channel for a concern
the spine already carries" shape this repository's design principle exists to prevent — the retry
seam (`classifyRetryDecision`), the shared-cause pause (episode coordinator), the budget-recovery
command family (08-29), and the operator-lever resume model (08-05) all already exist. Pattern
consistency therefore fails as designed and passes under the resolution below, which touches no new
state, no new store, and no new CLI family.

Event spine: every retry and grant occurrence already has a home — `step_retry` → audit `retry`
(`adr-2026-07-07-audit-trail-event-sink` §2), and the 08-29 ledger events. New members, if any, must
enter the total sink registry (`adr-2026-07-26-event-sink-registry-exhaustiveness`).

Diagram accuracy: the two feature diagrams describe the blocked design and will be rewritten to the
approved resolution before stories; they are not authoritative until then.

Scope-check: the skill's daemon-machinery signal says harness-repo-only; overridden to
consumer-facing because the daemon runs in every registered project. Docs: `docs/reference/cli.md`
(if a CLI verb lands here), `docs/guides/running-the-daemon.md`, `docs/runbooks/stalled-or-stuck-feature.md`.

## Wiring Surface (for the recommended resolution)

| Surface | Called from |
|---|---|
| Validation-group member attempt budget = serial budget | the group-branch dispatch in `conductor.ts` (replace the trailing literal `1` at both group call sites with the resolved serial attempt budget) |
| test_suite infrastructure-failure bounded lane | the `fullSuiteFailure.reason !== 'nonzero_exit'` branch in `conductor.ts`; allowance constant + per-feature durable counter modeled on `MAX_MECHANICAL_FAULT_LAPS_BUILD_REVIEW` (08-18 D4); exhaustion writes `needs-human` naming attempts spent |
| Three budget halts → `needs-human` | the three `writeHaltMarker(…, 'mechanical')` budget sites in `conductor.ts` (manual-test cap, test_suite cap, per-gate remediation budget) |
| `kickback-budget raise|reset --feature <slug> [--by N] --rationale …` | pre-boot dispatch in `index.ts` beside `decide-grant` (08-29 D3, 08-09-reseal's three operator-only mechanisms); writes a staged adjustment into `.pipeline/kickback-ledger.json` under park quiescence (08-29 D1/D4/D5) |
| Daemon-side halt clear on authorization | the daemon halted-feature boundary in `daemon-cli.ts`/`daemon.ts` reads the typed ledger authorization bound to live cap evidence and generation, then clears via the existing atomic halt-state clear (08-29 D6, 08-29-successor D3, adr-2026-08-09-halt-state-clear) |
| Ledger inspection + exhaustion renderer | one renderer in `kickback-ledger.ts` used by the halt body and `daemon status` (08-29 D8) |

Early overlap scan (run 2026-09-05, advisory): `conductor.ts` overlaps 24 unmerged spec branches — notably
`the-cumulative-kickback-cap-never-resets-so-a-reco` (superseded by this feature; condition 3) and
`plan-growth-allowance-is-spent-on-work-existing-ta` (#2119, in flight). #2197 is not yet a diff
against main at the scan's granularity but is named in condition 4. No other file overlapped.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Raising the group member budget to 3 triples the cost of a group member that fails deterministically | Technical | Medium | Medium | `adr-2026-07-13-kickback-build-no-op-escalation` D2 already halts on unchanged verdict; the ladder's `attempt`-derived escalation applies |
| The parked 08-29 feature and this feature both build `kickback-budget` | Integration | High if G-b | High | Choose G-a or G-b explicitly (below); never both |
| A bounded suite-infra retry masks a real environment fault for N laps | Technical | Low | Medium | Allowance is small (2–3), durable per feature, and the halt names attempts spent |

## ADRs Created

None. No uncovered structural decision remains under R: the suite-infra retry lane reuses
`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`'s shape inside the existing ladder
(`adr-2026-07-05-retry-as-escalation-ladder`); the group budget change is a literal, not a design;
budget recovery is governed by the three 08-29/08-31 ADRs cited in condition 1. Governing ADRs are
cited, not duplicated.

## Operator Resolution (2026-09-05)

The operator chose **R — reshape to comply**, **absorb** the kickback-budget grant into this feature
(option G-b, with a companion cleanup PR), and **fold in #1425**. The blocking analysis is retained
below for the record.

## Conditions

1. No DEFERRED state, no timer, no `daemon grant --laps`, no new `.daemon/grants` kind. The retry
   half is R1–R4; the grant half is `ai-conductor kickback-budget raise|reset` implemented
   **exactly** per `adr-2026-08-29-operator-authorized-kickback-budget-recovery` D1–D8 as amended by
   `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` D1–D4 and
   `adr-2026-08-31-kickback-ledger-read-fails-closed` 1–5. The plan maps each of those decisions to a
   task by citation; the previous attempt (PR #2106) diverged from them and was closed for re-plan.
2. Live-boundary trips and protected-artifact seal errors are excluded from any retry. The stories
   and the intake marker say so explicitly, so the as-built PLAN_GAP check does not read outcome
   bullet 1 against the intake's list.
3. A companion main-based PR (not this spec branch — the land stem gate rejects foreign-stem `.docs/`
   edits) retires `.docs/{plans,stories,complexity,intake,track,architecture}/the-cumulative-kickback-cap-never-resets-so-a-reco.md`
   and closes #1760 as a duplicate of #2190, after this spec merges. The parked worktree and branch are
   removed by the operator per the daemon-safety rules (park first — already parked).
4. Non-competition with spec PR #2197 (#2195, Tier S, diagnostic-only: as-built BLOCKED halt reasons
   distinguish DESIGN from REMEDIABLE and name the planner no-plan cause). This feature does not
   touch the as-built halt reason text, the as-built gate in `artifacts.ts`, or `planRemediation`'s
   no-plan result. Both edit `conductor.ts`; the overlap is textual, not functional. #2197 should merge
   first; this plan's rebase step absorbs it. Likewise the in-flight coverage-claim feature (#2088):
   disjoint `conductor.ts` regions, shared `types/events.ts` and `event-sinks.ts` additions only.
5. The three reclassified budget halts write `needs-human` (not `kickback-cap`), matching
   08-29-successor D1; resume authorization keys on typed ledger evidence, never on `HALT.class`.
6. The event-spine rule holds: retry attempts ride `step_retry`; ledger adjustments ride 08-29 D7's
   events; any new `ConductorEvent` member is declared in the total sink registry.

## Blocking Issues (first pass, retained for the record)

The explore-approved design violates the APPROVED ADRs cited in Feasibility §1–§3. Resolution
options, for the operator (do not auto-resolve):

**R — Reshape to comply (recommended).** No DEFERRED state, no timer, no `daemon grant --laps`.
The feature becomes:
- R1. Validation-group members get the serial attempt budget (closes #1425 — pull it in, or leave
  #1425 and drop this bullet).
- R2. test_suite infrastructure failure gets a bounded, non-charging in-step retry lane (08-18 shape),
  then `needs-human` naming attempts spent.
- R3. Three `mechanical` budget halts reclassified to `needs-human`.
- R4. Live-boundary trips and seal errors are **excluded** as not retryable by decided design; the
  intake's list is wrong for those two, and the intake marker/stories say so.
- G. The grant half, one of:
  - **G-a** — drop it from this feature; unpark and finish `the-cumulative-kickback-cap-never-resets-so-a-reco`,
    which owns `kickback-budget raise/reset` under 08-29. This feature's outcome bullets 3–4 are
    delivered by that feature.
  - **G-b** — this feature implements `kickback-budget raise/reset` exactly per 08-29 D1–D8, and the
    parked feature is closed as superseded by this one.

**S — Supersede.** Keep the DEFERRED design and write one superseding ADR over
`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` §4, `adr-2026-07-10-validation-group-join` §2,
`adr-2026-08-17-structural-live-checkout-containment` §4, `adr-2026-06-30-halt-based-release-gates`,
`adr-2026-07-26-protected-artifact-seal-rebaseline` §2, and `adr-2026-08-29-…` D6. Not recommended:
the superseded reasoning ("a guard whose halt the daemon auto-clears is not a guard") is sound, and
the ADR count is disproportionate to a Medium feature.

Note for the record: R is the "retry at the raiser" approach explore rejected on the ground that it
could not cover live-boundary and seal errors. The ADR sweep shows those two must not be covered.
