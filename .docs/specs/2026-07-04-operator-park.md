# PRD: Operator Park — a human-placed park survives autonomous re-dispatch

- **Status:** Approved
- **Date:** 2026-07-04
- **Source:** intake jstoup111/ai-conductor#236
- **Track:** product
- **Complexity tier:** M

## Problem / Background

The daemon autonomously retries halted features: when the base branch genuinely advances, a
sweep clears every live halt so the feature is re-attempted against the new base. That is the
sanctioned rebase-on-latest flywheel — but it cannot distinguish "halted by a failed step,
retry-worthy on a new base" from "parked by a human, do not touch."

Observed 2026-07-03: a feature needing human intervention was halted by the operator, but every
merge to the base branch would have cleared the park and burned one or two autonomous runs
before halting again. The operator's only recourse was a filesystem-permissions hack to make the
sweep's clear fail. "Needs human intervention" is a state the daemon must be able to respect
indefinitely, through every automatic recovery path it has.

## Goals

1. Give the operator a first-class, supported way to park a feature so that **no** autonomous
   path — base-advance sweep, daemon restart, polling tick, or any recovery mechanism — resumes
   or re-dispatches it.
2. Keep the existing autonomous retry behavior for machine-placed halts completely unchanged.
3. Make the parked state visible and distinguishable wherever feature states are shown.

## Non-Goals

- Making the sweep's once-per-base-advance guard durable across daemon restarts (a real defect,
  explicitly deferred to its own issue).
- Changing how machine-placed halts are created, cleared, or retried.
- Any form of scheduled or conditional auto-unpark; a park ends only by operator action.

## Users / Personas

- **Operator** (James): runs one daemon per repo, often supervising from a phone; needs to say
  "leave this one alone" once and trust it holds.
- **The daemon** (as a consumer of the contract): must be able to tell parked work apart from
  retryable halted work without human interpretation.

## Functional Requirements

- **FR-1 Park.** The operator can park a named feature through an explicit, supported action.
  Parking succeeds whether or not the feature is currently halted, and takes effect immediately.
- **FR-2 Park is absolute.** While parked, a feature is never dispatched, resumed, retried, or
  cleared by any autonomous path: the base-advance sweep, daemon startup, restart, polling
  ticks, and any pending-recovery signals all leave it untouched. This holds indefinitely across
  any number of base advances and restarts.
- **FR-3 Sweep skips parked work non-destructively.** When the base-advance sweep encounters a
  parked feature, it skips it, leaves any existing halt state byte-for-byte intact, and records
  in its log that the feature was skipped because an operator parked it.
- **FR-4 Unpark.** The operator can unpark a parked feature through an explicit, supported
  action. After unparking, the feature returns to exactly the state it would otherwise be in —
  a halted feature becomes an ordinary halted feature again (eligible for the sweep's normal
  retry on the next base advance), and a non-halted feature becomes ordinarily eligible.
- **FR-5 Machine halts unchanged.** Features halted by a failed step and never parked keep
  today's behavior in every respect: the sweep clears them on a genuine base advance and they
  are re-attempted.
- **FR-6 Visibility.** Parked features appear in the daemon's status/dashboard output as their
  own state, distinct from halted, taking display precedence over halted when both apply.
- **FR-7 Negative paths.**
  - Parking a feature the daemon does not know fails with a clear error and changes nothing.
  - Parking an already-parked feature is a safe, idempotent no-op that reports the existing
    park without corrupting or duplicating state.
  - Unparking a feature that is not parked is a safe no-op with a clear message.
  - A park placed while the daemon is mid-run for that feature does not interrupt the running
    attempt, but takes effect before the next autonomous decision about that feature.

## Non-Functional Requirements

- **Zero-burn guarantee:** a parked feature consumes no autonomous runs (no model invocations,
  no build attempts) while parked — the cost the current gap incurs on every base advance.
- **No polling load:** respecting parks must not add meaningful per-tick work for repos with no
  parked features.

## Acceptance Criteria / Success Metrics

- With a feature parked, merge to the base branch N times and restart the daemon between merges:
  zero re-dispatches, zero autonomous runs for that feature, halt state (if any) unchanged.
- A halted-but-not-parked sibling feature in the same repo is still cleared and retried by the
  same sweep, in the same pass.
- Unpark followed by a base advance retries the feature exactly as today's halted flow does.
- The permissions hack (write-protecting a feature's state directory) is no longer needed for
  any parked feature, and the previously affected feature can be managed by park/unpark.
- Status/dashboard output shows parked features as their own group.
- Documentation and the changelog describe the park/unpark capability (repo convention).

## Scope

**In:** the park/unpark operator actions, the sweep/dispatch/restart contract for parked
features, parked-state visibility, negative-path handling above.

**Out:** durable once-per-base-advance retry accounting across restarts (deferred, own issue);
changes to machine-halt semantics; automatic or conditional unparking; multi-operator park
ownership/permissions (single-operator daemon today).

## Key Decisions & Rationale (product)

- **Parked and halted are distinct states, not flavors of one state.** A human's "do not touch"
  and a machine's "failed, retry when base moves" have opposite retry semantics; conflating them
  is the root cause of this gap.
- **Park ends only by operator action.** Any auto-expiry would recreate the burned-run problem
  it exists to fix.
- **Parking is independent of halting.** The operator can pre-emptively park work that has not
  failed yet (e.g. known-broken direction pending a decision).

## Dependencies

- The existing daemon halt/retry flywheel and its status/dashboard output (pre-existing
  behavior this feature extends).
- The intake issue's originating repo conventions: docs and changelog updated in the same PR.

## Open Questions (for architecture-review)

- How the parked state should be represented and stored so that every autonomous path can check
  it cheaply and no existing halt writer can clobber it — trade-off already narrowed in explore
  (separate operator-owned state vs. annotating the existing halt state); needs an ADR.
- Where the park/unpark actions surface in the existing operator tooling and how they behave
  when the daemon is not running (park should not require a live daemon) — needs an ADR.
- Whether display precedence "parked over halted" needs any tie-breaking with the existing
  processed/in-progress precedence chain in status output.
