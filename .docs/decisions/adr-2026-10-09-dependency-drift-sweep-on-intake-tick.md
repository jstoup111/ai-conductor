---
status: APPROVED
date: 2026-10-09
---

# ADR: Dependency drift is a read-only sweep on the intake tick's reconcile hook, time-bounded, published as one spine event

**Status:** APPROVED
**Date:** 2026-10-09
**Deciders:** Operator (James Stoup), composer DECIDE session
**Feature:** dependency-edges-are-hand-maintained-intake-and-de (#536)
**Related:** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership (same reconciler);
adr-2026-07-03-dependency-fail-closed-and-cache (applied: an error degrades to indeterminate,
never to clean).

## Context

PRD FR-14..18 require two things:
- an on-demand drift report;
- an automatic report during intake polling, at a bounded cadence, publishing one summary record
  per run.

Both must be read-only and must respect the API rate budget.

Verified facts:
- `intakeTick` already calls an optional `reconcile()` hook every tick, inside a non-fatal
  try/catch (`intake-loop.ts:194`).
- The production composition root `intake-loop-cli.ts` wires `reconcileClosedIssues` into that
  hook and receives an `IntakeEventEmitter`.
- `GET …/issues/{n}/dependencies/blocked_by` returns each blocker's `state` and `state_reason`.
  For example, #474's blockers return `{"state":"closed","state_reason":"completed"}`. This was
  checked live on 2026-10-09.
- `BlockerResolver` already detects cycles through open blockers.

## Options Considered

### Option A: A separate scheduler or daemon timer for drift
- **Cons:** A second poller is a parallel channel, which the event-spine rule forbids. It also
  duplicates the tick's lifecycle.

### Option B: Run every tick
- **Cons:** One API call per open issue per tick stacks onto normal polling and threatens the rate
  budget.

### Option C: Compose into the existing reconcile hook, gated by a minimum interval
- **Pros:** No new loop. Cadence is bounded. The failure isolation already exists.

## Decision

**Option C.**

1. **Single implementation path.** The on-demand verb (`ai-conductor compose dep-audit --project
   <name>`, which prints the report and exits 0 for a registered project, and exits non-zero
   naming the project, with no tracker calls, for an unknown one) and the poll pass both call the same reconciler
   sweep. Neither ever writes to GitHub.
2. **What the sweep checks.** For each open issue in the repository, the sweep:
   - lists the issue together with its body;
   - reads its `blocked_by` list, one call per issue;
   - classifies findings as **unlinked declaration**, **stale link** (blocker `state_reason` is
     `not_planned`), **cycle** (`BlockerResolver`), or **direction contradiction** (the body
     declares "blocks #N" / "blocker for #N" while `blocked_by` contains N).

   No `blocking`-list read is needed. Blockers closed as `completed` are never findings. Any read
   error or rate-limit response marks that issue **indeterminate** and is never retried within the
   sweep.
3. **Poll cadence.** The poll pass is composed into the existing `reconcile` hook in
   `intake-loop-cli.ts`, after `reconcileClosedIssues`. It runs at most once per hour per
   repository. The last-run time is held in memory per loop process, so a restart runs a sweep
   promptly; that is acceptable. The interval is a code constant, not a config key.
4. **One new spine variant, `dependency_drift_swept`.** Each poll sweep emits exactly one event per
   repository: `{ repository, status: 'swept' | 'repository-indeterminate', unlinked, stale,
   cycles, contradictions, indeterminate }`, each list holding issue refs (counts are derivable).
   A clean sweep emits `status: 'swept'` with empty lists. A failed open-issue listing emits
   `status: 'repository-indeterminate'` with empty lists, so it is never read as clean. It is
   registered in
   `event-sinks.ts` (`persist: true`). The on-demand verb prints and does not emit.

## Consequences

### Positive
- Drift is visible without anyone auditing. Every bus consumer can see it.
- Rate cost is bounded: at most one call per open issue per hour, per repository.

### Negative
- After a restart the first sweep can repeat within the hour.
- Repositories with large numbers of open issues spend more of the budget. Indeterminate results
  make that visible rather than hidden.

### Follow-up Actions
- [ ] Sweep function in the reconciler, plus fixture tests covering each category, indeterminate,
      and completed-blocker exclusion.
- [ ] `compose dep-audit` verb registered in the compose subcommand table.
- [ ] Interval-gated composition into the `intake-loop-cli.ts` reconcile hook; the
      `dependency_drift_swept` variant and sink registration.
