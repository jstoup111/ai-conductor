# ADR: Fail-loud-once startup preflight + resolver error classification

**Status:** APPROVED
**Date:** 2026-07-20
**Context tier:** Medium
**Related:** intake jstoup111/ai-conductor#666, adr-2026-07-20-ci-fix-dispatch-via-steprunner, preflight.ts, build-auth-preflight.ts

## Context

Two intake outcomes are deterministic-machinery concerns, not LLM work:

- Outcome #3: fix-invocation validity must be verified **at daemon startup** (fail loud once),
  not rediscovered as an identical crash on every red PR.
- Outcome #1: a resolver spawn failure must surface a **diagnosable** reason (spawn env, flag
  validity, auth), never a bare `ExecaError: Command failed with exit code 1` swallowed at
  `ci-fix.ts:413` / `daemon-cli.ts:1486`.

## Decision

1. **Startup preflight.** Add a ci-fix preflight (alongside existing `preflight.ts` /
   `build-auth-preflight.ts`) that runs once when the daemon starts and probes that the
   fix-invocation surface is usable — i.e., the `claude` binary is on PATH and the headless
   invocation the resolver will use is accepted (a cheap capability/dry probe, **not** a model
   round-trip). On failure it logs a single classified reason and **disables ci-fix for the
   run** rather than letting the daemon emit an identical per-PR crash.

2. **Error classification at the resolver boundary.** When a dispatch/spawn fails, classify it
   into `flag-invalid` (arg-parse / unknown-option), `auth` (credential/login failure),
   `spawn-env` (ENOENT / PATH), or `unknown`, and log a diagnosable line. Replace the bare
   log-and-rethrow / log-and-swallow with this classified surface. A `flag-invalid` or
   `spawn-env` class is treated as a resolver-config fault (surfaced loudly), distinct from a
   genuine per-PR fix failure.

## Non-goals (explicit scope boundary)

- **Diagnosing the underlying red CI** (`[task-seed] Ambiguous plan discovery: multiple plans
  found …`, `remediate planner crashed`, possible #573 flakiness). Intake #666 defers this to
  separate triage "once a resolver runs at all". This spec makes the resolver **run and report**;
  it does not fix why `conductor` CI was red on #663/#664.
- Redesigning the mergeable-sweep eligibility gates or the guard/suite/lease-push pipeline.

## Rationale

- Mirrors the harness principle: enforce/validate mechanically at the point of failure; do not
  rely on the resolver silently retrying a structurally-impossible spawn.
- One loud startup failure is diagnosable and actionable; N identical per-PR `ExecaError`s are
  noise (the #438 fire-and-forget gap).

## Consequences

- New preflight module + wiring into daemon startup; a disabled-ci-fix state is logged and
  observable.
- Resolver error paths return/log a classified reason; existing callers that only logged the
  raw error now log the class + underlying message.
- Tests cover: preflight pass (valid), preflight fail (probe rejects → ci-fix disabled), and
  each error-classification branch.
