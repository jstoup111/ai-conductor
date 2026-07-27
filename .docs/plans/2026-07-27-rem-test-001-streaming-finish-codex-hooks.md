# Remediation Plan: retain Codex self-host hooks in streaming finish dispatch (`rem-test-001`)

**Date:** 2026-07-27
**Status:** completed bounded repair; additive provenance addendum
**Governing plan:** `.docs/plans/2026-07-26-codex-safety-and-self-host-parity-907.md`, Task 23
**Stories:** `.docs/stories/codex-safety-and-self-host-parity-907.md`, FR-8 HP-1 and FR-15 HP-2
**Architecture:** `.docs/decisions/architecture-review-2026-07-25-codex-safety-self-host-parity-907.md`

## Purpose

This addendum retroactively records the bounded repair committed in
`a1ec9d48b` (`fix: retain Codex self-host hooks for finish`). It supplies task-level
provenance for that already-completed repair; it does not change behavior, reopen #907, or
amend the active #971 feature plan.

## Problem

The streaming provider runtime adapter in `DefaultStepRunner` copied `invoke` and
`invokeInteractive`, but omitted the optional `prepareSelfHostAuth` and
`resolveSelfHostExecutable` capabilities. A resolved Codex `finish` candidate therefore could
not provision its isolated self-host home.

Task 23 is the governing authority: it requires the optional provider-owned self-host-auth
capability, an isolated `CODEX_HOME`, and the resolved executable. Its linked FR-8 HP-1 requires
selected-auth isolation, while FR-15 HP-2 requires Claude-only operation not to depend on Codex
state. The approved architecture further requires a provider-aware per-candidate wrapper after
candidate resolution and keeps the capability provider-owned. Forwarding those optional hooks
through the streaming finish adapter preserves that established contract without exposing it to
providers that do not implement it.

## Task `rem-test-001`: retain optional hooks on the streaming finish candidate

**Type:** bugfix / repair
**Governing authority:** #907 Task 23; FR-8 HP-1; FR-15 HP-2; approved provider-aware
per-candidate wrapper and provider-owned capability

**Test-first specification:**

1. Add a focused `step-runners.test.ts` case showing a `finish` Codex runtime reaches both
   `prepareSelfHostAuth` and `resolveSelfHostExecutable` through the streaming candidate and
   completes the candidate self-host teardown.
2. Forward only those optional hooks from the resolved runtime provider through the streaming
   adapter. Providers that do not expose either capability retain their existing behavior.
3. Run the focused step-runner test and the repository integrity suite.

**Exact changed files:**

- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/step-runners.test.ts`

**Completed by:** `a1ec9d48b` (`Task: rem-test-001`)

## Verification scope

- `src/conductor/test/engine/step-runners.test.ts`
- `test/test_harness_integrity.sh`

## Non-goals

- No change to the provider-owned auth capability, credential selection, isolated-home policy, or
  teardown implementation.
- No change to candidate ordering, fallback behavior, or safety-wrapper policy.
- No change to Claude behavior or any provider that lacks these optional capabilities.
- No amendment to #907 or the active #971 plan, and no reopening of #907's approved design.
