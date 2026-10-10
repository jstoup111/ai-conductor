# Architecture Review: Shipped PRs get a re-examined readiness verdict (#438)

**Date:** 2026-10-09
**Mode:** Lightweight (Tier M) — Technical Feasibility + Architectural Alignment
**Inputs reviewed:** `.docs/track/shipped-is-fire-and-forget-no-reconciliation-sweep.md`,
`.docs/complexity/shipped-is-fire-and-forget-no-reconciliation-sweep.md`,
`.docs/architecture/shipped-is-fire-and-forget-no-reconciliation-sweep.md` (operator-approved).
Technical track: no PRD; stories do not exist yet.
**Verdict:** APPROVED

Scope boundary (binding, from the track marker): daemon-shipped (watched) PRs only. Spec PRs,
manual or unledgered PRs, and any digest of them are excluded.

## Feasibility

| Check | Finding | Confidence / basis |
|---|---|---|
| Stack compatibility | No new packages or services. `gh pr view --json` already supplies `mergeStateStatus`, `baseRefName`, `headRefOid`; `gh pr list --json mergeStateStatus` returned values on this repo today. | 95%, verified |
| Prerequisites | None. No config key is required; the grace period is a named constant. | 90%, inferred |
| Integration surface | One external system (GitHub) through the existing typed tracker read and the existing feature-write label operations. No operation is added to `GITHUB_OPERATION_REGISTRY` (operator chose surface-only). Internal modules: `mergeable-sweep.ts`, `pr-labels.ts`/`tracker-client.ts` (read fields), `types/events.ts`, `daemon-observe-cli.ts`, `daemon-cli.ts`. | 95%, verified |
| Data implications | Additive optional fields on `WatchEntry` (`.daemon/mergeable-watch.jsonl`); existing lines parse unchanged. One additive `ConductorEvent` variant. | 90%, verified (`WatchEntry` fields read) |
| Performance | At most one extra `gh pr view` per watched PR whose first read is `UNKNOWN`; the registry is capped at 100 entries (`MAX_WATCH_ENTRIES`). | 90%, verified |
| Worktree isolation | No ports, databases, or shared services. The sweep runs in the daemon main root only. | 95%, verified |

**Feasibility findings that shaped the design:**

- **No automatic way to start CI exists.** `ci.yml` runs only on `pull_request` into `main`; it has
  no `workflow_dispatch`, and a PR with zero runs has nothing to re-run. Pushing an empty commit
  or closing and reopening the PR would each need a new guarded write, and close/reopen races the
  sweep's own CLOSED handling and the `shipped-record` workflow. The operator chose surface-only:
  `no-checks` routes to the existing `needs-remediation` label path. (verified, 95%)
- **Zero checks is correct for non-`main` bases.** Stacked child PRs (#2942) do not target `main`,
  so `no-checks` applies only when the base is `main` and a grace period has elapsed since the
  head commit was first observed. (verified from `ci.yml`, 95%)
- **`checksOutcome: 'pending'` was unrouted.** Added as an explicit `ci-pending` wait verdict.
- **Sweep events never reach the daemon ledger.** The production `sweepMergeableLabels` call in
  `daemon-cli.ts` passes no `onEvent`, so the existing `ci_failed` sweep events and any new verdict
  event would be invisible to `daemon status`. The design wires `onEvent` to the daemon's global
  emitter, which `startDaemonEventPersistence` persists to `.daemon/events.jsonl`. (verified by
  reading the call site, 90%)

## Alignment

- **adr-015-daemon-pr-labeling-sweep D1/D2 (APPROVED)** — reused, not superseded. The sweep
  still re-derives truth from GitHub on every pass (registry = which, GitHub = state), and all
  reads stay on the shared seam.
- **adr-2026-07-07-ship-ci-feedback-loop (APPROVED)** — reused. `ci-failing` routes to the
  unchanged ship-ci path; its draft exclusion, attempt cap, and exhaustion escalation are
  untouched.
- **adr-2026-07-04-autoresolve-state-and-config (APPROVED)** — reused. `conflicting` feeds the
  existing autoresolve candidate path; the only change is which PRs qualify (`DIRTY`, and
  `UNKNOWN` resolved by a re-read).
- **Event spine (CLAUDE.md, `.agents/skills/event-spine`)** — compliant. The verdict is an
  occurrence and rides a new `ConductorEvent` variant; `daemon status` reads it from the ledger.
  The grace bookkeeping (head SHA, first-seen time) is durable sweep state in the existing watch
  entry, alongside `ciFixAttempts`, not a telemetry channel.
- **State management** — the verdict is a closed union with fixed precedence and an exhaustive
  route `switch` with no `default`, so an invalid or unrouted state cannot be represented.
- **Security** — no new write operation, no new credential use; label writes keep the existing
  feature-scoped `GithubOperationRunner`.
- **Production DI defaults** — no new store; the watch registry stays file-backed.
- **Diagram accuracy** — the approved diagram was revised in place for the surface-only route,
  `ci-pending`, and the `onEvent` wiring; both blocks render.

**Focused local pattern basis.** The status section follows the READ-ONLY REVIEW CAPABILITY
renderer in `daemon-observe-cli.ts` (`readLatestReadOnlyReviewCapabilities`): a bounded backwards
scan of `.daemon/events.jsonl` keeping the latest record per key. Preserve: backwards chunked
scan, latest-wins per key (here, PR URL), absent ledger renders as "unknown" not as an error.
Allowed variation: key and rendered fields. The label-once rule follows ship-ci exhaustion in
`mergeable-sweep.ts` (label-absent→present transition gates the mutation).

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `classifyShippedReadiness` (pure classifier) | Called per live watched entry inside `sweepMergeableLabels`, which the daemon runs at startup and on each idle poll tick through the `sweepMergeableLabels` binding in `daemon-cli.ts`. |
| Exhaustive verdict route dispatch | Same per-entry loop in `sweepMergeableLabels`, replacing the independent condition chain. |
| `UNKNOWN` re-read | Inside the sweep's per-entry read, through the existing tracker `readPullRequestMergeState`. |
| New PR read fields (`mergeStateStatus`, `baseRefName`, `headRefOid`) | Returned by the existing typed PR state read used by the sweep. |
| `WatchEntry` head-SHA / first-seen fields | Written by the sweep through the existing `rewriteWatch`. |
| `shipped_pr_readiness` event variant | Emitted by the sweep through `onEvent`, now passed by the `daemon-cli.ts` sweep binding to the daemon's global `ConductorEventEmitter`; persisted by `startDaemonEventPersistence`. |
| SHIPPED PRS status section | Rendered by `daemon-observe-cli.ts` in the existing per-repo `daemon status` output. |

**Early overlap scan** (`ai-conductor overlap-scan` over the files above): one advisory overlap,
`origin/spec/self-host-phase6-wiring` touching `src/conductor/src/daemon-cli.ts` (stale spec
branch). No open PR or in-flight daemon build touches the sweep, autoresolve, ci-fix, or the PR
read (checked 2026-10-09).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Restructuring the sweep regresses existing label/autoresolve/ci-fix behaviour | Technical | Medium | Medium | Existing sweep tests stay as regression tests; the route table maps each verdict to the unchanged existing path. |
| `needs-remediation` applied to a PR whose CI is merely slow to register | Integration | Low | Medium | Grace period from head-commit first-seen; non-`main` bases never classify `no-checks`. |
| Wiring `onEvent` adds event volume to `.daemon/events.jsonl` | Performance | Low | Low | Change-only emission per PR and head SHA; the registry is capped at 100. |
| A human drafts a shipped PR on purpose and gets a `needs-remediation` label | Integration | Low | Low | Label only, never un-drafts; the label is the existing operator-cleared signal. |

## ADRs Created

- `adr-2026-10-09-shipped-pr-readiness-verdict` — closed readiness verdict with an exhaustive
  route table in the mergeable sweep (a durable state-transition design not covered by adr-015 or
  the ship-ci ADR, which govern individual branches, not the totality of routing). Presented for
  operator approval.

## Conditions

None.
