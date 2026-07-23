# Stories: build_review fresh-base grading + bounded scope-verdict disposition

**Feature:** `build-review-grades-plan-vs-diff-against-a-stale-o`
**Track:** technical (acceptance criteria live here; no PRD)
**Date:** 2026-07-23

## Story 1 — Grading uses a verified-fresh base

**As** the conductor's build_review step, **I want** the graded diff computed
against the true remote default head, **so that** main's merged work never appears
inside a feature's diff.

- **Happy:** Given a branch rebased onto remote head `R` and a tracking ref lagging
  at `S` (ancestor of `R`), When build_review inputs are assembled, Then the
  resolver detects `S ≠ ls-remote head`, fetches, and the graded diff contains only
  the branch's own commits (no file from `S..R`).
- **Negative:** Given the tracking ref already equals the ls-remote head, When
  inputs are assembled, Then no fetch is issued (probe only) and the diff is
  byte-identical to today's output.

## Story 2 — Offline/no-remote grading degrades unchanged

- **Happy:** Given a repo with no `origin` remote, When build_review inputs are
  assembled, Then the resolver degrades to the current local-ref behavior, logs one
  advisory line, and grading proceeds.
- **Negative:** Given `ls-remote` fails (network down), When inputs are assembled,
  Then the failure is swallowed to the same local degrade — never a thrown error
  that fails the step.

## Story 3 — Stale-mirage scope FAIL is invalidated, not reworked

- **Happy:** Given a scope FAIL whose graded base is proven stale (graded-base sha ≠
  fresh merge-base sha) and whose recomputed fresh diff no longer contains the
  flagged content, When the conductor handles the FAIL, Then the verdict is
  discarded, NO build rework is dispatched, and build_review re-runs against the
  fresh inputs.
- **Negative:** Given the recomputed fresh diff still contains the flagged content,
  When the conductor handles the FAIL, Then the verdict stands and the FAIL routes
  to build rework exactly as today.

## Story 4 — Regrade is bounded: no death loop

- **Happy:** Given one regrade has already been consumed this feature-session, When
  a second scope FAIL again presents a stale graded base, Then the conductor HALTs
  with evidence (graded-base sha, fresh-base sha, flagged paths, regrade count) —
  it never re-enters grading.
- **Negative:** Given the first regrade's re-run PASSes, When the step completes,
  Then the counter state does not leak into the next feature-session (fresh session
  starts at zero).

## Story 5 — Genuine out-of-scope work still fails and kicks to build

- **Happy:** Given a fresh-base graded diff that truly bundles work no plan task
  covers, When build_review FAILs on scope, Then the disposition confirms base
  freshness and routes to build rework with the unchanged retry hint.
- **Negative:** Given a genuinely stalled/violating build, When disposition runs,
  Then no verdict is ever discarded on content that persists under a fresh base —
  the invalidation path is unreachable.

## Story 6 — The engine never mutates history in this path

- **Happy:** Given any disposition outcome (invalidate / kick-to-build / HALT), When
  the handling completes, Then the branch's commit set is unchanged by the engine
  (no rebase, no reset, no deletions) — asserted by comparing pre/post HEAD and
  reflog in the fixture.
- **Negative:** Given a stale-mirage verdict, When invalidation runs, Then no agent
  session is dispatched at all (no rework prompt containing "fix in build" is
  constructed).

## Story 7 — Base-freshness telemetry on every grading

- **Happy:** Given any build_review dispatch, When inputs are assembled, Then an
  event carrying `{mergeBase, trackingRefSha, remoteHeadSha, fresh}` is emitted and
  visible in the daemon log line stream.
- **Negative:** Given the offline degrade (Story 2), When inputs are assembled, Then
  the event still emits with `remoteHeadSha: null, fresh: false` — telemetry never
  throws.

Status: Accepted
