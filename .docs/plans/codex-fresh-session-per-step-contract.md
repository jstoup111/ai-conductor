# Implementation Plan: Codex fresh-session-per-step contract (#903)

Stem: codex-fresh-session-per-step-contract
Track: technical
Tier: M
Story: S1
Story: S2
Story: S3
Story: S4
Refs: jstoup111/ai-conductor#903, #325, #759, #1041, #1042

## Goal

Make session resume a **declared provider capability**, have Codex declare it unsupported, and
delete the Codex `exec resume` argv branch so a resume invocation is structurally unconstructable.
Then prove the contract with a faithful Codex fake (one that mints its own thread id instead of
echoing the harness id) and an opt-in real-Codex smoke. Per
`adr-2026-07-27-codex-never-resumes-a-harness-minted-session`.

## Files

- `src/conductor/src/execution/llm-provider.ts` — add `supportsSessionResume` to `LLMProvider`.
- `src/conductor/src/execution/codex-provider.ts` — declare `false`; delete the resume argv branch
  (`:496-498`) and the `!options.resume` guard on `--cd` (`:511`).
- `src/conductor/src/execution/claude-provider.ts` — declare `true`; no behavior change.
- `src/conductor/src/engine/provider-execution.ts` — capability conjunct at the single resume
  decision (`:397`); emit the `session_policy` suppression diagnostic.
- `src/conductor/test/fixtures/codex-provider-fake.ts` — **new** shared faithful Codex fake.
- `src/conductor/test/execution/llm-provider-contract.test.ts` — capability contract coverage.
- `src/conductor/test/engine/conductor.test.ts` (`:9082-9245`) and
  `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts` (`:922-973`) —
  amend the Codex half of the existing resume assertions.
- `src/conductor/test/execution/codex-provider.smoke.test.ts` — extend the opt-in real-CLI probe.
- `.docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md`,
  `.docs/stories/fresh-session-per-step.md`,
  `.docs/stories/per-step-provider-routing-927.md` — supersession annotations.
- `docs/explanation/architecture.md` — document the per-step session contract + the capability.
- `CHANGELOG.md` — `## [Unreleased]` entry.

## Non-goals

- **Do not change Claude's resume behavior.** The operator's end state is no resume for either
  provider, but Claude's mechanism is functional and flipping it changes token cost on the default
  path. The capability field is the flip point; a separate change with its own evidence flips it.
- **Do not remove `forceFreshSession`** (`provider-execution.ts:376`, `:546`). It is
  provider-agnostic and remains #1042's seam. This feature composes with it.
- **Do not remove `CODEX_SESSION_EXPIRED_RE` or the conductor's `sessionExpired` branch.** They
  become unreachable via our own resume but stay as defensive classifiers; retiring them belongs
  to #1042.
- **Do not change `ProviderSessionStore` id minting or scoping.** The id remains the audit/log
  correlation key.
- No VERSION bump (operator-frozen pre-v1). No migration block — no `bin/conduct` CLI, hook
  wiring, skill symlink, or `settings.json` schema surface is touched. If the release gate's
  path-based classifier flags one anyway, add a `.docs/release-waivers/
  codex-fresh-session-per-step-contract.md` in the same diff rather than inventing an empty
  migration.

## Tasks

### Task 1 — Add `supportsSessionResume` to the provider contract (RED first)

**Story:** S1
**Dependencies:** none

In `src/conductor/src/execution/llm-provider.ts`, add `supportsSessionResume: boolean` to the
`LLMProvider` interface (`:148-165`) with a doc comment stating the fail-closed rule: an adapter
that cannot resume a **caller-supplied** session id declares `false`, and an undeclared field is
read as `false`.

Write the failing contract test first in `test/execution/llm-provider-contract.test.ts`: a
provider declaring `supportsSessionResume: false` must never be invoked with `resume: true`.
Today that suite only ever passes `resume: false` (`:43`), so this is new coverage.

Estimated: 4 min.

### Task 2 — Declare the capability on both adapters

**Story:** S1
**Dependencies:** Task 1

`ClaudeProvider` → `supportsSessionResume = true` (its `--session-id` create binds the harness
uuid, so `--resume <uuid>` is valid; `claude-provider.ts:649-653` unchanged).
`CodexProvider` → `supportsSessionResume = false`.

Estimated: 3 min.

### Task 3 — Delete the Codex resume argv branch

**Story:** S1
**Dependencies:** Task 2

In `CodexProvider.buildArgs` (`codex-provider.ts:495-516`) replace the conditional
`options.resume ? ['exec','resume',options.sessionId] : ['exec']` with an unconditional
`['exec']`, and drop the `!options.resume` guard so `--cd <cwd>` is always appended when `cwd` is
set. Remove the now-stale comment at `:511`.

Per the conflict check: this is the one line where the resume branch interleaves with the
model/effort argv from #902/#931. Confirm `--model` and `--config model_reasoning_effort` still
append in the same order and that `-` remains the final argument.

Add a unit test asserting `buildArgs` emits `exec` (never `exec resume`) and always carries
`--cd` when `cwd` is provided, even if a caller passes `resume: true`.

Estimated: 6 min.

### Task 4 — Gate resume at the single decision point + emit the diagnostic

**Story:** S1
**Story:** S3
**Dependencies:** Task 2

In `runProviderInvocation` (`provider-execution.ts:384-411`), change `:397` from
`resume: forceFreshSession ? false : session.resume` to
`resume = providerSupportsResume && !forceFreshSession && session.resume`, reading the capability
fail-closed (`provider.supportsSessionResume === true`).

When the capability (not `forceFreshSession`) is what suppressed a would-be resume, emit one
`session_policy` tracked event naming provider, step, and reason, deduped to once per step scope.
Do **not** emit when `session.resume` was already `false`, and do not emit for Claude.

Tests: capability suppression, fail-closed on an undeclared field, Claude unchanged, both
suppressors composing without error or duplicate diagnostic (S1's three negative paths), and
S3's two negative paths.

Estimated: 10 min.

### Task 5 — Shared faithful Codex fake

**Story:** S4
**Dependencies:** Task 3

Add `test/fixtures/codex-provider-fake.ts`: an `LLMProvider` fake that mints its **own**
uuidv7-shaped thread id per `exec` invocation, records it, and **fails** any invocation carrying
`resume: true` with a `no rollout found for thread id <id>` output — modelling the real CLI
instead of echoing back the harness `sessionId` the way every current inline fake does. Declare
`supportsSessionResume: false`.

Placed under `test/fixtures/` alongside `git-repo.ts` per the architecture review's
recommendation, so later Codex work inherits the fidelity.

Estimated: 8 min.

### Task 6 — Amend the two suites that assert the old behavior

**Story:** S4
**Dependencies:** Task 4, Task 5

- `test/engine/conductor.test.ts:9082-9245` — the `{step, provider, sessionId, resume}` sequence
  assertion currently expects a Codex resume on retry. Amend the Codex expectation to
  `resume: false` on every attempt; **keep** the Claude expectations and the
  `resetSessionCalls`/`beginStepCalls` assertions unchanged.
- `test/acceptance/per-step-provider-routing-927.acceptance.test.ts:922-973` — keep
  `claude.calls[0].resume === false` / `calls[1].resume === true`; change the Codex half to assert
  no attempt ever carries `resume: true`.

Amend, never delete — each test also carries the Claude invariant.

Estimated: 8 min.

### Task 7 — Annotate the superseded prior artifacts

**Story:** S1
**Dependencies:** Task 4

**Plan amendment (2026-07-28, operator-approved):** the three target documents —
`.docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md`,
`.docs/stories/per-step-provider-routing-927.md`, and `.docs/stories/fresh-session-per-step.md`
— are sealed, already-shipped artifacts belonging to other, unrelated features (#325, #927);
the protected-artifact seal correctly forbids editing them. The same qualification is recorded
instead in this feature's own story doc, `.docs/stories/codex-fresh-session-per-step-contract.md`
Story S2 ("Capability qualification (2026-07-27)"), where it documents this feature's own scope
without amending another feature's sealed record. No edits to the three named documents are
required; this task is satisfied by the existing annotation in this feature's own story.

Estimated: 5 min.

### Task 8 — Acceptance: end-to-end multi-attempt Codex step

**Story:** S2
**Story:** S4
**Dependencies:** Task 6

Drive the conductor through a Codex step that fails attempt 1 and succeeds on attempt 2 against
the Task 5 fake, asserting: zero invocations with `resume: true`; zero `no rollout found`
responses; zero `session_reset` events; exactly one step-boundary `resetSession(step.name)`
(`conductor.ts:3558`) and none per attempt; and that attempt 2's prompt contains both the
`RETRY:` prefix and the full step system prompt (S2's happy path, verifying the existing
`step-runners.ts:1901` behavior rather than changing it).

Then run `tsc` and the full suite to confirm no hidden consumer of the deleted argv branch
(ADR assumption 3).

Estimated: 12 min.

### Task 9 — Opt-in real-Codex smoke

**Story:** S4
**Dependencies:** Task 3

Extend `test/execution/codex-provider.smoke.test.ts` (already gated by
`CODEX_CLI_SMOKE_TEST === '1'` **and** a binary probe, and excluded by `vitest.config.ts:6`):
assert the installed CLI still exposes no flag to pre-register a caller-supplied session id
(`codex exec --help`, `codex exec resume --help`), re-checking the ADR's central assumption
against the real binary. Keep it help-only — no real session is created, and `test/setup.ts`'s
`AI_CONDUCTOR_NO_REAL_EXEC` guard is bypassed only in the excluded smoke lane.

Estimated: 6 min.

### Task 10 — Documentation + CHANGELOG

**Story:** S1
**Dependencies:** Task 4

`docs/explanation/architecture.md` — near the existing "fresh session" row (`:143`), add a short
subsection: every executed step starts a fresh provider session; a within-step retry may continue
it **only** for providers declaring `supportsSessionResume`; Codex does not, so every Codex
invocation is a cold start and the retry carries its context in the prompt.

`CHANGELOG.md` under `## [Unreleased]` → `### Changed`: "Session resume is now a declared provider
capability. Codex declares it unsupported and can no longer construct a `codex exec resume`
invocation — every Codex dispatch is a cold start, including within-step retries, which carry
their context via the `RETRY:`-prefixed full step prompt. Removes the per-retry `no rollout found`
round-trip caused by resuming a harness-minted uuid against a Codex thread id
(ai-conductor#903; partially supersedes adr-2026-07-24-provider-aware-step-execution-fresh-session-scope §2).
Claude behavior is unchanged."

Estimated: 6 min.

## Task Dependency Graph

```
Task 1 ─► Task 2 ─┬─► Task 3 ─┬─► Task 5 ─► Task 6 ─► Task 8
                  │           └─► Task 9
                  └─► Task 4 ─┬─► Task 6
                              ├─► Task 7
                              └─► Task 10
```

Task 1 is the only true root. Tasks 3 and 4 are independent of each other once Task 2 lands and
may run in parallel. Task 8 is the integration point and must run last among the code tasks;
Tasks 7, 9, and 10 are leaves.
