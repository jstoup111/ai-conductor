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

**Matrix:** the provider is a matrix dimension with a single `claude` value and `fail-fast: false`.
Each leg is independently credentialed and independently skippable, so one leg's missing credential
never suppresses another's signal.

**Codex is deferred, not dropped (amended 2026-08-02).** The original decision shipped both a
`claude` and a `codex` leg. Two facts moved Codex to a follow-on. First, headless `CODEX_API_KEY`
auth has no CI precedent anywhere in this repository, making it the assumption in this feature least
likely to hold (65%, per the architecture review's ledger). Second, and more decisive: nothing this
feature builds can be verified by the build that builds it — there are no secrets and the smoke file
is excluded from `npm test` — so every additional task spends build time on output no gate can
check. Concentrating that time on the leg with a proven auth pattern
(`test/engine/build-token-auth.smoke.test.ts`) buys the most signal per task. The matrix shape is
retained precisely so the Codex leg is one entry plus one credential var when someone dispatches the
Claude leg successfully and wants the second.

> **Amended 2026-08-12 by #1264:** the final sentence's expectation — that the retained matrix
> shape makes the Codex leg "one entry plus one credential var" — did not hold when the second leg
> was actually built. Verified against the tree on 2026-08-12: `matrix: provider` is never consumed
> (every leg runs the same `npm run smoke`, and the credential-check step reads only
> `CLAUDE_CODE_OAUTH_TOKEN`), so adding `codex` to the list would have run the Claude leg twice; the
> `credentialed` smoke capability is hardcoded to `CLAUDE_CODE_OAUTH_TOKEN` in both advisory and gate
> resolution, so a second provider has no way to declare its own credential; and
> `daemon-e2e-live.smoke.test.ts` hardcodes `ClaudeProvider`, `which claude`, `executable: 'claude'`,
> and `providerKey: 'claude'`. The provider-neutral part of the expectation was correct and did hold:
> `provider-home.ts` already maps `codex → CODEX_HOME`, and `CodexProvider` already implements
> `prepareSelfHostAuth`, `readiness`, and `resolveSelfHostExecutable`. See
> `adr-2026-08-12-per-provider-live-smoke-legs` for the shape the second leg actually takes, and
> `adr-2026-08-12-live-provider-coverage-from-plugin-registry` for the check that replaces this
> retained-intent mechanism.

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
