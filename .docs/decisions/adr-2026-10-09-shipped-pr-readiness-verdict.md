# ADR: Shipped-PR readiness verdict — one closed verdict per watched PR, one route per verdict

**Date:** 2026-10-09
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for #438

<!-- Filename convention: adr-2026-10-09-shipped-pr-readiness-verdict.md. Cite by filename stem. -->

## Context

`sweepMergeableLabels` (`src/conductor/src/engine/mergeable-sweep.ts`) re-derives state for every
daemon-shipped PR in `.daemon/mergeable-watch.jsonl` on each idle tick (adr-015 D1). Its per-entry
logic is a chain of independent conditions — label reconcile, `mergeable === 'CONFLICTING'` →
autoresolve candidate, `checksOutcome === 'failed'` → ci-fix candidate (adr-2026-07-07-ship-ci-feedback-loop).
Any state none of those conditions matches gets no action and no signal. #438 names three such
states, all verified on 2026-10-09:

- **Lazy `UNKNOWN` mergeability.** GitHub computes mergeability on demand. A first read of #2886
  returned `UNKNOWN/UNKNOWN`; a second read returned `CONFLICTING/DIRTY` (verified, 100%). The
  sweep never re-reads, so a conflicting PR read as `UNKNOWN` never reaches autoresolve.
- **Zero check runs.** `checksOutcome: 'none'` is treated as no evidence (`ci-fix.ts`
  `nonTerminalCheckNames` returns `[]` for an empty rollup), so a PR whose CI never ran gets nothing.
  CI here runs only on `pull_request` into `main` (`.github/workflows/ci.yml`), with no
  `workflow_dispatch` trigger, so zero checks is expected for a PR whose base is not `main`.
- **Post-ship draft.** Finish marks the PR ready (`finish-publication-production.ts`,
  `ready: !pr.isDraft`), so a watched shipped PR that is a draft drifted after ship. The sweep only
  reads `isDraft` to keep drafts out of autoresolve and ci-fix dispatch.

Also unrouted today: `checksOutcome: 'pending'` (correctly a wait, but implicit).

Operator-confirmed scope (2026-10-09): daemon-shipped (watched) PRs only. Spec PRs, manual or
unledgered PRs, and an operator digest of them are out of scope. Operator-confirmed nudge choice:
surface only — no new GitHub write operation to start CI.

## Options Considered

### Option A: Add the missing conditions to the existing chain
- **Pros:** Smallest diff.
- **Cons:** Keeps the defect class. Whether every state has a route is still something a reader
  must check by hand, and the next unrouted state falls through silently again.

### Option B: Closed readiness verdict with an exhaustive route table
- **Pros:** Every live watched PR gets exactly one verdict and every verdict has exactly one route.
  An exhaustive `switch` with no default makes an unrouted verdict a compile error. Each verdict is
  observable on the event spine.
- **Cons:** Restructures the sweep's per-entry branch, which existing tests pin.

### Option C: Hold finish until checks register and mergeability computes
- **Pros:** Prevents some cases at the source.
- **Cons:** Misses post-ship drift (base-branch conflicts appearing later, manual redraft) and
  slows every finish.

## Decision

Option B, operator-confirmed.

1. **One pure classifier over re-read state.** For each watched PR whose lifecycle state is OPEN,
   after the existing MERGED / CLOSED / NOTFOUND / read-failure handling (unchanged), a pure
   function maps the PR's read state to exactly one member of the closed union
   `ready | conflicting | ci-failing | ci-pending | no-checks | draft | indeterminate`. The read
   adds `mergeStateStatus`, `baseRefName`, and `headRefOid` to the existing fields, through the
   existing typed tracker read (adr-015 D2 seam). When `mergeable` reads `UNKNOWN`, the sweep
   re-reads once within the same tick before classifying.
2. **Fixed precedence.** The first matching rule wins: `draft` (isDraft) → `indeterminate`
   (mergeability still `UNKNOWN` after the re-read, the re-read failed, or `mergeStateStatus` is outside GitHub's documented set `BEHIND | BLOCKED | CLEAN | DIRTY | DRAFT | HAS_HOOKS | UNKNOWN | UNSTABLE`) → `conflicting` (`mergeable = CONFLICTING` or
   `mergeStateStatus = DIRTY`) → `ci-failing` (`checksOutcome = failed`) → `ci-pending`
   (`checksOutcome = pending`) → `no-checks` (base is `main`, zero check runs on the head commit,
   and the grace period since that head commit was first observed has elapsed) → `ready`. A
   zero-check PR whose base is not `main`, or still inside the grace period, classifies as
   `ci-pending`.
3. **One route per verdict, exhaustive.** The existing `mergeable` label reconcile (adr-015,
   FR-10/11/12) keeps running for every verdict except `indeterminate`, which makes no mutation
   at all; the verdict-specific route below is in addition to it. Route dispatch is a `switch`
   over the verdict with no `default`:
   - `ready` → the existing `mergeable` label reconcile.
   - `conflicting` → the existing autoresolve candidate path (adr-2026-07-04-autoresolve-state-and-config).
   - `ci-failing` → the existing ship-ci path (adr-2026-07-07-ship-ci-feedback-loop), unchanged.
   - `ci-pending` → wait: no dispatch and no `needs-remediation` change; re-examined next tick.
   - `indeterminate` → wait: no mutation of any kind; re-examined next tick.
   - `no-checks` and `draft` → the existing `needs-remediation` label path, applied once
     (label-absent→present transition), the same sweep-side precedent as ship-ci exhaustion.
     When the sweep adds the label for this reason it records `escalationCause:
     'shipped-readiness'` on the watch entry, extending the existing `escalationCause` union.
     The label is **self-clearing**: on a later tick whose verdict is none of `no-checks`, `draft`,
     `ci-pending`, or `indeterminate`, and the PR carries no halt body marker, the sweep removes `needs-remediation` and
     drops the cause, with the same three-attempt bounded retry as the conflict-resolution
     clear (`maybeClearConflictLabel`). A `needs-remediation` label the sweep did not add for
     this reason (halt presentation, ci-fix exhaustion, conflict escalation, a human) is never
     removed by this rule and keeps its existing sticky behaviour. Without self-clearing, a PR
     flagged `no-checks` whose CI later passes would be barred from `mergeable` forever
     (adr-015 FR-12) and from ci-fix dispatch (ship-ci sticky suppressor).
   Drafts remain excluded from autoresolve and ci-fix dispatch.
4. **Surface only — no new GitHub write operation.** No operation is added to
   `GITHUB_OPERATION_REGISTRY`. The daemon never starts CI, pushes, closes, reopens, or
   un-drafts a PR because of this verdict.
5. **Verdict on the event spine.** Each classification emits a `shipped_pr_readiness`
   `ConductorEvent` variant (PR URL, slug, verdict, head SHA, the observed fields that decided
   it) through the sweep's existing `onEvent` option. Emission is change-only per PR: a verdict
   equal to the PR's last emitted verdict for the same head SHA is not re-emitted; the last emitted verdict and head SHA are kept on the watch entry (D7) so the rule survives a daemon restart. Emission is wrapped so a listener or ledger failure never interrupts the sweep. No sidecar
   file and no bespoke format. The production sweep call in `daemon-cli.ts` passes no `onEvent`
   today (verified 2026-10-09), so sweep events never reach the daemon ledger; this decision
   wires `onEvent` to the daemon's global `ConductorEventEmitter`, which
   `startDaemonEventPersistence` persists to `.daemon/events.jsonl`. As a side effect, the
   sweep's existing `ci_failed` events start reaching the ledger too.
6. **Status reads the spine.** `daemon status` gains a per-repo SHIPPED PRS section listing
   watched PRs whose latest `shipped_pr_readiness` verdict is not `ready`, read from
   `.daemon/events.jsonl`, restricted to PRs still in `.daemon/mergeable-watch.jsonl`, with the same backwards-scan pattern as the READ-ONLY REVIEW
   CAPABILITY section.
7. **Grace bookkeeping lives in the watch entry.** The head SHA and when it was first observed
   are stored as optional fields on the existing `WatchEntry`, next to `ciFixAttempts` and
   `lastResolveAt`. This is durable sweep state, not telemetry. A changed head SHA restarts the
   grace period. The grace period is a named constant (30 minutes).

## Consequences

### Positive
- No live watched PR can end a tick without a verdict, and every verdict has an owner.
- Lazy `UNKNOWN` no longer hides a conflict from autoresolve.
- A shipped PR whose CI never ran, or that went back to draft, becomes visible within one tick
  after the grace period, in labels, the event ledger, and `daemon status`.

### Negative
- The sweep's per-entry branch is restructured, and existing sweep tests that pin the old branch
  order need updating.
- One extra `gh pr view` per watched PR whose first read is `UNKNOWN`.
- `no-checks` relies on the operator to act; CI is never started automatically.

### Follow-up Actions
- [ ] Spec PRs and manual or unledgered PRs are out of scope here; file separately if wanted.
