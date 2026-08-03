# ADR: Manual dispatch now, reusable fail-closed gate mode reserved for release

**Date:** 2026-08-02
**Status:** APPROVED
**Feature:** daemon-e2e-smoke-step-has-no-real-agent-live-llm-t (jstoup111/ai-conductor#1124)
**Related:** #1259 (no release-time smoke or eval gate)

## Context

Issue #1124 proposes a nightly schedule for the live tier. Two facts change the calculus:

1. Verified 2026-08-02: the repository has zero Actions secrets, and no workflow anywhere in
   `.github/` uses `schedule`, `cron`, or `workflow_dispatch`. A nightly trigger would spend a live
   run per day starting the moment secrets are provisioned, before anyone has established what a
   healthy run costs or how often it flakes.
2. The operator's intent for this tier is a **pre-release** gate, once the changelog/unreleased-issue
   implementation merges — not a recurring background job. A nightly cadence would spend tokens on
   days with no release and still not gate the release.

## Decision

**Trigger:** `workflow_dispatch` (operator-run, advisory) plus `workflow_call` (reusable), in a new
workflow file. No `schedule`. No `pull_request`. The workflow is absent from `ci.yml`'s `ci-gate`
`needs` list, so it can never block a merge.

**Two modes, one workflow.** The `workflow_call` interface takes a `require_credentials` boolean
input, default `false`:

- **Advisory mode** (`false`, what `workflow_dispatch` uses): a leg whose credential or CLI is
  missing **skips** and reports so in the job summary. A dispatch on an unprovisioned repository is
  a clean, honest skip rather than a red X.
- **Gate mode** (`true`, reserved for the future release caller): a missing credential is a
  **failure**. A release must never pass because its smoke tier silently skipped.

**Matrix:** two legs, `claude` and `codex`, each independently credentialed and independently
skippable. One leg's missing credential never suppresses the other's signal.

**Out of scope:** wiring this workflow into `release.yml`. That belongs to #1259 and depends on the
changelog/unreleased-issue implementation landing first. This ADR only guarantees the seam exists so
that wiring is a caller change, not a rewrite.

## Alternatives considered

- **Nightly schedule (the issue's hypothesis).** Rejected: recurring spend with no release coupling,
  and no baseline yet for cost or flake rate. Nothing here forecloses adding `schedule` later — it
  is one trigger block on a workflow already built to be run unattended.
- **Manual dispatch only, no `workflow_call`.** Rejected: the release gate is a stated near-term
  intent, and retrofitting a reusable interface later means changing the workflow's contract after
  operators have learned the dispatch form.
- **Label-gated on PRs.** Rejected: puts a live-agent run on the pull-request path, where a flake
  becomes indistinguishable from a merge blocker.

## Consequences

**Positive.** Zero recurring spend. The tier runs when someone wants an answer, and the release gate
it is destined for gets a fail-closed mode from day one rather than inheriting the advisory
semantics by accident.

**Negative.** Between dispatches there is no regression signal — a real-agent regression can sit
undetected until the next manual run or release. This is the accepted cost of not paying for a
nightly run; #1259's release gate is what closes it.
