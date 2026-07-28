# Codex fresh-session-per-step contract (#903)

Status: Accepted

## Context

#325 made every executed step start on a fresh LLM session, preserving one exception: a step's
own internal retries resume that step's session (`ProviderSessionScope.prepare()` returns
`resume: session.created`, `provider-session.ts:44-47`; `markCreated` fires on every non-skipped
attempt, `provider-execution.ts:404-409`).

For Codex that exception is unimplementable. The harness mints a `uuidv4`
(`provider-session.ts:34`); Codex rollout ids are `uuidv7` minted by Codex, and `codex exec`
exposes no flag to bind a caller-supplied id (verified in #1042 at Codex 0.145.0). So
`codex exec resume <harness-uuid>` (`codex-provider.ts:496-498`) always fails with
`no rollout found for thread id …`, is matched by `CODEX_SESSION_EXPIRED_RE`
(`codex-provider.ts:25`), and round-trips through the conductor's budget-neutral stale-session
reset (`conductor.ts:3978-3996`). Every Codex retry therefore spends a real provider invocation
learning something knowable before dispatch, and recovery depends on matching provider error
strings.

The suite does not catch this because every provider fake is defined inline per test file and
echoes back whatever `sessionId` it is handed — none model Codex's server-minted thread id.
Two suites actively assert the broken behavior as correct
(`conductor.test.ts:9082-9245`, `per-step-provider-routing-927.acceptance.test.ts:922-973`).

Per adr-2026-07-27-codex-never-resumes-a-harness-minted-session, session resume becomes a
declared provider capability; Codex declares it unsupported and loses the ability to construct a
resume invocation.

## Story S1 — Codex dispatch never requests session resume

As the conductor dispatching a step to Codex, every invocation must be a cold start, so that no
dispatch can ask Codex to resume an id Codex never minted.

### Happy Path

- **Given** a step routed to the `codex` provider whose scope has already recorded one created
  invocation (`session.created === true`, so `ProviderSessionScope.prepare()` reports
  `resume: true`),
- **When** `runProviderInvocation` builds the invocation for that provider,
- **Then** the `resume` flag passed to `CodexProvider.invoke` is `false`, because
  `CodexProvider.supportsSessionResume` is `false` and the capability gate ANDs it in,
- **And** the argv built by `CodexProvider` begins `['exec', …]` and never
  `['exec', 'resume', …]`,
- **And** the invocation includes an explicit `--cd <cwd>` (the `--cd` suppression existed only
  to accommodate the resume form).

### Negative Paths

- **Given** a provider adapter that does not declare `supportsSessionResume` at all,
- **When** `runProviderInvocation` resolves the resume flag,
- **Then** it treats the provider as non-resuming and dispatches `resume: false` — the gate is
  fail-closed, never fail-open.

- **Given** a step routed to the `claude` provider whose scope reports `resume: true`,
- **When** `runProviderInvocation` builds the invocation,
- **Then** `resume` stays `true` and Claude dispatches `--resume <sessionId>` exactly as before —
  this change must not alter Claude's behavior on any path.

- **Given** a self-host Codex dispatch where `forceFreshSession` is already `true`
  (`provider-execution.ts:546`),
- **When** the capability gate also resolves to no-resume,
- **Then** the result is still `resume: false` with no error and no double-suppression
  diagnostic — the two suppressors compose.

## Story S2 — A Codex within-step retry cold-starts and still carries the step's context

As a retried Codex step attempt, I must receive the full step context through the prompt rather
than through session memory, so that removing resume loses nothing.

> **Capability qualification (2026-07-27):** #325's "within-step retries resume the same
> session" rule applies only to providers declaring `supportsSessionResume`. Codex does not
> declare it; each Codex retry is a cold start carrying retry context via the `RETRY:`-prefixed
> full prompt (see Happy Path below).

### Happy Path

- **Given** a Codex step whose attempt 1 failed and whose retry hint is set,
- **When** attempt 2 dispatches,
- **Then** the prompt sent to Codex is the **full** step system prompt prefixed with
  `RETRY: <reason>` (`step-runners.ts:550`, `:1819`, `:1901`) — not a delta or continuation
  turn,
- **And** `resume` is `false` on attempt 2 just as on attempt 1,
- **And** the step-boundary reset at `conductor.ts:3558` still fires exactly once per step, not
  once per attempt (the #325 structure is unchanged).

### Negative Paths

- **Given** a Codex step retrying after a failure,
- **When** attempt 2 dispatches,
- **Then** no `session_reset` event is emitted for that attempt and no retry budget is consumed
  by a `sessionExpired` round-trip, because the unresolvable-thread-id failure can no longer
  occur.

- **Given** a Codex invocation whose output happens to contain text matching
  `CODEX_SESSION_EXPIRED_RE` for an unrelated reason,
- **When** the conductor classifies the result,
- **Then** the existing `sessionExpired` branch still handles it as before — this feature removes
  the *cause*, it does not remove or weaken the defensive classifier.

## Story S3 — A capability-suppressed resume is visible in the audit trail

As an operator reading a build's audit trail, I must be able to tell that a Codex retry cold-started
by policy rather than by accident, so a cold start is never mistaken for a lost session.

### Happy Path

- **Given** a Codex step where the session scope reported `resume: true` and the capability gate
  suppressed it,
- **When** the invocation is dispatched,
- **Then** the engine emits one `session_policy` diagnostic for that step naming the provider
  (`codex`), the step, and the reason (provider does not support session resume),
- **And** the diagnostic is emitted at most once per step regardless of how many attempts are
  suppressed.

### Negative Paths

- **Given** a Codex step's first invocation, where the scope reported `resume: false` anyway,
- **When** the invocation is dispatched,
- **Then** no `session_policy` diagnostic is emitted — the diagnostic reports *suppression*, not
  every cold start, so it does not become noise on the common path.

- **Given** a Claude step where resume proceeds normally,
- **When** the invocation is dispatched,
- **Then** no `session_policy` diagnostic is emitted.

## Story S4 — The contract is covered by a faithful Codex fake and an opt-in real smoke

As the test suite, I must fail if Codex dispatch ever requests a resume again, so this cannot
silently regress the way it did before.

### Happy Path

- **Given** a shared faithful Codex fake that mints its **own** thread id (uuidv7-shaped) and
  rejects any `exec resume <id>` for an id it did not mint — rather than echoing back the
  harness-supplied `sessionId` as every current inline fake does,
- **When** the conductor drives a multi-attempt Codex step end to end against that fake,
- **Then** the run completes with zero resume requests, zero `no rollout found` responses, and
  zero `sessionExpired` resets,
- **And** the existing suites that assert the old behavior
  (`conductor.test.ts:9082-9245`'s codex resume-on-retry expectation and
  `per-step-provider-routing-927.acceptance.test.ts:922-973`) are updated to the new contract
  rather than deleted, so the Claude half of each assertion keeps its coverage.

### Negative Paths

- **Given** a hypothetical future change that reintroduces a resume request for Codex,
- **When** the suite runs,
- **Then** a contract-level test in `test/execution/llm-provider-contract.test.ts` fails,
  asserting that a provider declaring `supportsSessionResume: false` never receives
  `resume: true` — coverage that does not exist today (the contract test only ever passes
  `resume: false`).

- **Given** the default `npm test` run with no opt-in env var,
- **When** the suite executes,
- **Then** no real Codex binary is invoked: the real-Codex check lives in
  `test/execution/codex-provider.smoke.test.ts`, gated by `CODEX_CLI_SMOKE_TEST=1` **and** a
  binary probe, and is excluded by `vitest.config.ts:6` (`test/smoke/**`,
  `**/*.smoke.test.ts`), consistent with the repo's third-party-calls-are-smoke-only policy.

- **Given** the opt-in smoke run with a real Codex binary,
- **When** it probes `codex exec --help` / `codex exec resume --help`,
- **Then** it records whether Codex still exposes no way to pre-register a caller-supplied
  session id — so the ADR's central assumption is re-checked against the installed CLI rather
  than trusted indefinitely.
