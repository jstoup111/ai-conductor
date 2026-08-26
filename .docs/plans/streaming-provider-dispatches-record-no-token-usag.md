# Implementation Plan: One provider dispatch path that records its usage

**Date:** 2026-08-24
**Stories:** .docs/stories/streaming-provider-dispatches-record-no-token-usag.md
**Conflict check:** Clean as of 2026-08-24

## Summary

Collapses `LLMProvider.invoke()` and `LLMProvider.invokeInteractive()` into one dispatch path so
every non-REPL dispatch requests its provider's machine envelope and records token usage. 31 tasks.

## Technical Approach

The defect is a duplicated seam, not a missing parser. Both adapters already own a working envelope
parser and already emit stream observations; only `invoke()` asks for the envelope and only
`invoke()` passes the observation hook. `streamingProviderRuntimes` then routes every streaming step
through the method that does neither, so most dispatches discard usage that was never requested.

Three decisions are fixed by APPROVED ADRs and are not open at build time:

- The engine calls exactly one dispatch member, and `invokeInteractive` is removed from
  `LLMProvider` and from `plugin-loader`'s required members
  (`adr-2026-08-24-one-dispatch-member-on-the-provider-contract`). Removal is safe: dropping a
  required duck-type check is a loosening, and a class with an extra method still satisfies
  `implements`.
- Live observation is carried by an optional **stream-consumer object** on `InvokeOptions`, not a
  boolean. The object is the seam a later context-control feature extends; its authority stays
  exactly none (same ADR, D3-D5).
- Every non-REPL dispatch requests the envelope; the REPL keeps plain text and inherited stdio
  (`adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope`).

**Sequencing rationale.** The interface member cannot be removed until nothing calls it, so the
order is: add the consumer field (additive, unused) → unify each adapter internally → repoint every
engine call site → delete the member and the wrapper → prove the metering and visibility outcomes.
Each adapter is unified independently so a failure in one does not block the other.

**Local pattern context.** Per-dispatch behavioral variation in this codebase is already carried as
optional fields on `InvokeOptions` — `interactive`, `onProviderStream`, `dangerouslySkipPermissions`,
`selfHost`, `spawnPermit` — with the adapter, never the caller, deciding how to honor them. The
traits to preserve: the field is optional; its absence reproduces today's behavior exactly; and no
caller branches on provider identity to decide how it is applied. Allowed variation: the field's
name, and whether an adapter branches early in argument construction or late at stdio selection.
Search hints for an equivalent on current HEAD: the `InvokeOptions` interface in
`src/conductor/src/execution/llm-provider.ts`, and either adapter's `buildArgs`/`buildEnv` pair.

## Prerequisites

- None. No migration, no config key, no external account.

## Non-goals

- Reworking the reported totals line so tokens and cost share a stated denominator — out of scope
  by operator direction, filed as jstoup111/ai-conductor#1863.
- Granting the stream consumer any dispatch authority. The observation-only boundary of
  `adr-2026-08-19-live-provider-stream-observation` is preserved.
- Publishing a types entry point for the provider contract.
- Documentation updates, which the pipeline's `maintain-documentation` step owns.

## Tasks

### Task 1: Add the stream-consumer field to InvokeOptions
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write a failing type-level test in `llm-provider.test.ts`: an `InvokeOptions` literal omitting the new field compiles, and one supplying an object with an `onProviderStream` callback and a `close` function compiles.
2. Verify RED.
3. Add one optional field to `InvokeOptions` typed as the existing `ProviderStreamCandidateObserver` shape. Follow the local pattern for per-dispatch variation: optional, absence reproduces today's behavior, adapter-honored. Do not add a boolean.
4. Verify GREEN; commit "feat(provider): carry live observation as a consumer on InvokeOptions".

**Done when:**
- `InvokeOptions` in `src/conductor/src/execution/llm-provider.ts` declares exactly one new optional field, and it is an object type, not a boolean.
- Every existing construction of `InvokeOptions` in `src/conductor/src` compiles unchanged with the field omitted.
- A doc comment on the field states it grants no timeout, kill, retry, or lifecycle authority.

**Files:**
- src/conductor/src/execution/llm-provider.ts
- src/conductor/test/execution/llm-provider.test.ts

**Dependencies:** none

### Task 2: Make the REPL-plus-consumer combination unrepresentable or documented
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that an options value with `interactive: true` and a supplied stream consumer is rejected by the type or, if the pair is left representable, that the adapter leaves the consumer un-invoked.
2. Verify RED.
3. Implement the chosen constraint. Prefer a discriminated shape that makes the pair unrepresentable; if the existing option surface makes that impractical, document on the field that a REPL dispatch leaves it inert, and enforce that inertness in the adapter.
4. Verify GREEN; commit "feat(provider): constrain REPL dispatch against a live consumer".

**Done when:**
- Either the type rejects `interactive: true` together with a supplied consumer, or the field's doc comment states the combination is inert and a test proves the consumer is never invoked on a REPL dispatch.
- The test fails if the constraint is removed.

**Files:**
- src/conductor/src/execution/llm-provider.ts
- src/conductor/test/execution/llm-provider.test.ts

**Dependencies:** 1

### Task 3: Unify claude argument construction around one envelope decision
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `claude-provider.test.ts`: a non-REPL dispatch's argument list contains `--print`, `--output-format`, `stream-json`, and `--verbose`; a REPL dispatch's list contains none of `--output-format`, `stream-json`, `--verbose`.
2. Verify RED.
3. Move envelope flag selection into the single argument-construction path, branching on the REPL condition rather than on which method was entered. Do not duplicate the flag list.
4. Verify GREEN; commit "feat(claude): select the envelope in one argument path".

**Done when:**
- The literal `stream-json` appears exactly once in `src/conductor/src/execution/claude-provider.ts` outside comments and tests.
- The two new tests pass and fail if the REPL branch is removed.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** 1

### Task 4: Unify the claude dispatch body
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that a REPL dispatch and a non-REPL dispatch both reach one internal dispatch implementation, observed by a single spy on the process-run seam.
2. Verify RED.
3. Collapse `invokeInteractive`'s body into `invoke`, keeping the REPL's stdio inheritance and prompt-as-argv behavior on the REPL branch. `invokeInteractive` becomes a thin delegator for this task only; it is deleted in Task 19.
4. Verify GREEN; commit "refactor(claude): one dispatch body for every mode".

**Done when:**
- `claude-provider.ts` contains one method that spawns the provider process; the other path delegates to it and contains no spawn of its own.
- The spy test observes exactly one dispatch implementation for both modes.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** 3

### Task 5: Feed the claude classifier the envelope on every non-REPL dispatch
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that a non-REPL dispatch's completion classification receives the envelope, and that the branch returning `tokenUsage` as absent is reached only for a REPL dispatch.
2. Verify RED.
3. Derive the classifier's envelope argument from the same REPL condition Task 3 introduced, rather than from a per-call-site literal.
4. Verify GREEN; commit "fix(claude): classify every non-REPL dispatch from its envelope".

**Done when:**
- No call site in `claude-provider.ts` passes a hard-coded false for the envelope argument.
- A test asserts a non-REPL dispatch never reaches the usage-discarding branch, and fails if that branch is made reachable again.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** 4

### Task 6: Deliver an oversized prompt on stdin for every non-REPL claude dispatch
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write a failing test: a prompt exceeding the argv length limit, dispatched non-REPL, is written to the child's stdin and does not appear in the argument list.
2. Verify RED.
3. Ensure the unified path applies stdin delivery on every non-REPL dispatch, preserving the REPL's positional-argument behavior.
4. Verify GREEN; commit "fix(claude): stdin prompt delivery on every non-REPL dispatch".

**Done when:**
- A prompt of at least 200 KiB dispatched non-REPL appears in the child's stdin and not in its argv.
- The REPL path still passes its prompt positionally, asserted by a second case.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** 4

### Task 7: Pass the stream consumer on every claude dispatch that supplies one
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write a failing test: a non-REPL dispatch supplied a consumer receives at least one observation carrying non-zero token counts from a fake NDJSON stream.
2. Verify RED.
3. Wire the consumer through the unified path to the existing stream-observation emitter. Do not add a second emitter.
4. Verify GREEN; commit "feat(claude): deliver stream observations on every dispatch".

**Done when:**
- A non-REPL dispatch supplied a consumer receives observations with non-zero `uncachedInputTokens` and `outputTokens`.
- A dispatch supplied no consumer emits no observation and behaves as the buffered dispatch does today.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** 4

### Task 8: A throwing consumer callback must not fail the claude dispatch
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write a failing test: a consumer whose `onProviderStream` throws on first observation still allows the dispatch to run to completion and return its result.
2. Verify RED.
3. Isolate consumer invocation so a thrown error is contained and does not propagate into dispatch control flow.
4. Verify GREEN; commit "fix(claude): a throwing stream consumer cannot fail its dispatch".

**Done when:**
- The dispatch returns a successful result despite every observation callback throwing.
- The thrown error does not reach the caller and does not abort the child process.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** 7

### Task 9: Unify codex argument construction around one envelope decision
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `codex-provider.test.ts`: a non-REPL dispatch's argument list contains the JSON flag; a REPL dispatch's does not.
2. Verify RED.
3. Derive the JSON flag from the REPL condition inside the single `buildArgs` path rather than from a per-call-site boolean.
4. Verify GREEN; commit "feat(codex): select the envelope in one argument path".

**Done when:**
- `buildArgs` in `src/conductor/src/execution/codex-provider.ts` derives the JSON flag from one condition, and no caller passes it as a literal.
- The two new tests pass and fail if the REPL branch is removed.

**Files:**
- src/conductor/src/execution/codex-provider.ts
- src/conductor/test/execution/codex-provider.test.ts

**Dependencies:** 1

### Task 9.1: Re-probe the installed codex envelope
**Story:** 5
**Type:** verification
**Verify-only:** yes

**Steps:**
1. Run a real `codex exec --json` dispatch against the installed CLI in the opt-in smoke context, capturing its emitted envelope.
2. Assert the existing codex JSONL parser reads a usage record from it.
3. Record the observed CLI version alongside the result so a future drift has a baseline to compare against.
4. Commit with an `Evidence: skipped` trailer per the verify-only convention.

**Done when:**
- The captured envelope from the installed codex CLI parses to a usage record with non-zero token counts.
- The observed codex CLI version is recorded in the feature evidence.
- An envelope that does not parse is recorded as a blocking finding rather than passed over.
- No production file is modified by this task.

**Files:**
- none

**Dependencies:** 9

### Task 10: Unify the codex dispatch body and classifier input
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test asserting one internal dispatch implementation serves both modes, and that completion classification receives the envelope for a non-REPL dispatch.
2. Verify RED.
3. Collapse `invokeInteractive`'s body into `invoke`, preserving the REPL's inherited stdout and stderr. `invokeInteractive` becomes a thin delegator until Task 19.
4. Verify GREEN; commit "refactor(codex): one dispatch body for every mode".

**Done when:**
- `codex-provider.ts` contains one method that spawns the provider process.
- No call site passes a hard-coded false for the classifier's envelope argument.

**Files:**
- src/conductor/src/execution/codex-provider.ts
- src/conductor/test/execution/codex-provider.test.ts

**Dependencies:** 9

### Task 11: Pass the stream consumer on every codex dispatch that supplies one
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write a failing test: a non-REPL codex dispatch supplied a consumer receives observations with non-zero token counts from a fake JSONL stream.
2. Verify RED.
3. Wire the consumer through the unified path to the existing codex stream-observation emitter.
4. Verify GREEN; commit "feat(codex): deliver stream observations on every dispatch".

**Done when:**
- A non-REPL codex dispatch supplied a consumer receives observations with non-zero token counts.
- A consumer whose callback throws does not fail the dispatch, asserted by a second case.

**Files:**
- src/conductor/src/execution/codex-provider.ts
- src/conductor/test/execution/codex-provider.test.ts

**Dependencies:** 10

### Task 12: Preserve the codex unattended sandbox and approval configuration
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write a failing test enumerating every configuration entry an unattended codex dispatch carries today — workspace-write sandbox mode, network access, approval policy, reviewer, and the environment-policy entry — and asserting all are present after unification.
2. Write a second case asserting an interactive dispatch carries none of them.
3. Verify RED, implement, verify GREEN; commit "test(codex): pin unattended sandbox configuration across unification".

**Done when:**
- The test enumerates the five configuration entries by name and fails if any one is dropped.
- An interactive dispatch is asserted to carry none of them.

**Files:**
- src/conductor/src/execution/codex-provider.ts
- src/conductor/test/execution/codex-provider.test.ts

**Dependencies:** 10

### Task 13: Preserve fresh-session enforcement on the unified path
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests for both adapters: a dispatch requesting session reuse still reaches the provider with a freshly minted session id and no resume, on both REPL and non-REPL modes.
2. Verify RED.
3. Ensure the enforcement helper is applied at the single dispatch entry rather than once per former method.
4. Verify GREEN; commit "fix(provider): enforce fresh sessions at the one dispatch entry".

**Done when:**
- Each adapter applies the fresh-session enforcement helper exactly once, at its single dispatch entry.
- A dispatch requesting reuse is asserted to resume no session, on both providers.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/src/execution/codex-provider.ts
- src/conductor/test/execution/claude-provider.test.ts
- src/conductor/test/execution/codex-provider.test.ts

**Dependencies:** 4; 10

### Task 14: Preserve self-host executable resolution and auth handoff
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write a failing test: a self-host dispatch on the unified path resolves its provider executable and performs its auth handoff before the child home overrides provider state.
2. Verify RED.
3. Ensure both optional contract members remain reachable from the unified path.
4. Verify GREEN; commit "test(provider): self-host resolution survives dispatch unification".

**Done when:**
- A self-host non-REPL dispatch is asserted to call executable resolution before spawning.
- The test fails if the resolution call is removed from the unified path.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/src/execution/codex-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** 13

### Task 14.1: An autonomous step output and usage are unchanged
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write a failing test capturing an autonomous step's text output and recorded usage from a faked provider envelope, asserting both equal the pre-unification expectation fixed in the test.
2. Verify RED.
3. Make only the change the test exposes; an autonomous dispatch must take the unified path with no behavioral difference.
4. Verify GREEN; commit "test(provider): autonomous dispatch behavior is unchanged by unification".

**Done when:**
- An autonomous step's text output equals the pre-unification expectation, asserted on both providers.
- Its recorded token counts and cost equal the pre-unification expectation.
- The test fails if the autonomous path is routed differently from the unified path.

**Files:**
- src/conductor/test/execution/claude-provider.test.ts
- src/conductor/test/execution/codex-provider.test.ts

**Dependencies:** 14

### Task 15: Repoint the collaborative and branch-session dispatch call site
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test: a step dispatched with a branch session id reaches the provider through `invoke`, carrying the same options it carries today.
2. Verify RED.
3. Change the call site that currently dispatches collaborative and branch-session steps to call `invoke`, supplying the REPL option where it supplied it before and a stream consumer where the step is not a REPL.
4. Verify GREEN; commit "refactor(step-runners): dispatch collaborative steps through invoke".

**Done when:**
- The call site calls `invoke` and the pre-dispatch model-availability consult still precedes it.
- A branch-session dispatch is asserted to reach the same entry point as a non-branch dispatch.

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** 7; 11

### Task 15.1: A dead model with no live ladder model is not silently dispatched
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write a failing test: a dispatch whose resolved model is marked dead and whose fallback ladder contains no live model does not hand the dead model to the provider.
2. Write a second case: a dispatch whose resolved model is marked dead and whose ladder has a live model dispatches the substituted model and emits the substitution warning.
3. Verify RED, implement, verify GREEN; commit "test(step-runners): the availability consult survives on the one dispatch path".

**Done when:**
- The exhausted-ladder case is asserted not to dispatch the dead model.
- The substitution case is asserted to dispatch the first live ladder model and to emit its warning.
- Both cases fail if the pre-dispatch availability consult is removed from the unified call site.

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** 15

### Task 16: Repoint the free-form REPL call site
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test: the free-form REPL dispatch reaches `invoke` with the REPL option set, supplies no stream consumer, and requests no envelope flag.
2. Verify RED.
3. Change that call site to `invoke`, preserving its interactive flag, permission behavior, and model and effort resolution.
4. Verify GREEN; commit "refactor(step-runners): dispatch the REPL through invoke".

**Done when:**
- The call site calls `invoke` with the REPL option set and supplies no consumer.
- The resulting argument list is asserted to contain no envelope flag.

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** 15

### Task 17: Delete the streaming-runtime dispatch substitution
**Story:** 2
**Type:** refactor

**Steps:**
1. Write a failing test asserting that a streaming step's dispatch is not routed through any substituted provider method, observed at the adapter's single entry.
2. Verify RED.
3. Remove the `invoke`-substituting members from the streaming runtime wrapper. If the wrapper retains no other delegation duty, delete it and its construction site; if it does, keep it and state the remaining duty in a comment, preserving its prototype-delegation contract verbatim.
4. Verify GREEN; commit "refactor(step-runners): retire the streaming dispatch substitution".

**Done when:**
- The wrapper no longer defines `invoke` or `invokeInteractive` members.
- Either the wrapper is deleted with its construction site, or a comment names the delegation duty that keeps it, and its prototype-delegation base is unchanged.

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** 16

### Task 18: Repoint the attribution-lane delegator
**Story:** 2
**Type:** refactor

**Steps:**
1. Write a failing test asserting the attribution lane's provider delegator forwards to `invoke`.
2. Verify RED.
3. Replace the delegated member with `invoke`.
4. Verify GREEN; commit "refactor(attribution-lane): delegate to the one dispatch member".

**Done when:**
- `attribution-lane.ts` delegates `invoke` and defines no `invokeInteractive` delegator.
- The delegation test passes and fails if the member is restored.

**Files:**
- src/conductor/src/engine/attribution-lane.ts
- src/conductor/test/engine/attribution-lane.test.ts

**Dependencies:** 17

### Task 19: Remove invokeInteractive from the provider contract
**Story:** 3
**Type:** refactor

**Steps:**
1. Write a failing test asserting `LLMProvider` has no `invokeInteractive` member and that neither built-in adapter defines one.
2. Verify RED.
3. Delete the member from the interface and the delegators left in both adapters by Tasks 4 and 10.
4. Verify GREEN; commit "feat(provider)!: one dispatch member on the provider contract".

**Done when:**
- `grep -rn 'invokeInteractive' src/conductor/src` returns no match outside comments.
- Both adapters compile and their existing suites pass with the member absent.

**Files:**
- src/conductor/src/execution/llm-provider.ts
- src/conductor/src/execution/claude-provider.ts
- src/conductor/src/execution/codex-provider.ts
- src/conductor/test/execution/llm-provider.test.ts

**Dependencies:** 18

### Task 20: Require only invoke of an llm_provider plugin
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: a plugin exporting only `invoke` loads; a plugin exporting both `invoke` and an extra `invokeInteractive` loads and never has the extra member called; a plugin exporting no `invoke` fails with an error naming `invoke`; a plugin whose `invoke` is not a function fails; a plugin exporting only `invokeInteractive` fails naming `invoke`.
2. Verify RED.
3. Remove the `invokeInteractive` requirement from the plugin loader's validation, leaving the `invoke` requirement unchanged.
4. Verify GREEN; commit "feat(plugin-loader): require only invoke of a provider plugin".

**Done when:**
- The loader validates `invoke` only, and the five enumerated cases above all pass.
- The failure message for a missing `invoke` names `invoke`.

**Files:**
- src/conductor/src/engine/plugin-loader.ts
- src/conductor/test/engine/plugin-loader.test.ts

**Dependencies:** 19

### Task 21: Update the reference provider plugin to the revised contract
**Story:** 3
**Type:** refactor

**Steps:**
1. Write a failing test in the reference plugin's suite asserting it satisfies the revised contract with `invoke` alone.
2. Verify RED.
3. Remove `invokeInteractive` from the reference provider and fold any behavior it recorded into `invoke`.
4. Verify GREEN; commit "refactor(recorder-provider): match the one-member provider contract".

**Done when:**
- `plugins/recorder-provider` compiles against the revised contract and its existing tests pass.
- The reference plugin defines no `invokeInteractive`.

**Files:**
- plugins/recorder-provider/index.ts
- plugins/recorder-provider/tests

**Dependencies:** 20

### Task 22: A streaming step's dispatch records its token usage
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test dispatching a streaming step end to end through the engine with faked provider output, asserting the emitted `provider_attempt` event carries a `tokenUsage` object with input, output, and cache counts, on both providers.
2. Verify RED.
3. Confirm the unified path already satisfies it; make only the wiring change the test exposes.
4. Verify GREEN; commit "test(engine): streaming dispatches record their usage".

**Done when:**
- A streaming step's `provider_attempt` event carries a non-absent `tokenUsage` for both providers.
- The test fails if the envelope request is removed from the non-REPL branch.

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** 17

### Task 23: A dispatch that fails or cannot be parsed records no usage
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests for three cases: a non-zero-exit streaming dispatch yields no `tokenUsage` and classifies unmetered; an unparseable stdout produces a parse or provider failure and no usage; an envelope missing its terminal result record reports a parse failure naming the missing record rather than returning empty output.
2. Verify RED.
3. Make only the changes the three cases expose.
4. Verify GREEN; commit "fix(provider): a failed or unparseable dispatch records no usage".

**Done when:**
- All three enumerated cases pass on both providers.
- The missing-terminal-record failure message names the missing record.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/src/execution/codex-provider.ts
- src/conductor/test/execution/claude-provider.test.ts
- src/conductor/test/execution/codex-provider.test.ts

**Dependencies:** 22

### Task 23.1: Metering classification stays three-valued and invents no cost
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing tests for four cases: an envelope reporting tokens and a cost classifies fully metered with the provider's own figure; an envelope reporting tokens with no cost and a model absent from the rate card classifies cost-unmetered, contributing tokens and no cost; an envelope whose terminal record carries no usage fields classifies unmetered; a non-finite or non-numeric reported cost does not classify as fully metered.
2. Verify RED.
3. Make only the changes the four cases expose. Introduce no code path that writes a cost the provider envelope or the committed rate card did not supply.
4. Verify GREEN; commit "fix(provider): restored measurements never invent a cost".

**Done when:**
- All four enumerated cases pass.
- A usage-absent dispatch contributes neither tokens nor cost to the feature rollup, and is still counted as unmetered.
- No file changed by this feature writes a `costUsd` value not sourced from the provider envelope or the committed rate card.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/src/execution/codex-provider.ts
- src/conductor/test/execution/codex-provider.test.ts
- src/conductor/test/engine/cost-rollup.test.ts

**Dependencies:** 23

### Task 24: Partial observations from an incomplete dispatch produce no usage record
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write a failing test: a dispatch that emits several stream observations with rising token counts and is then killed by a signal yields no `tokenUsage` on its result.
2. Verify RED.
3. Ensure usage is derived only from the terminal result record, never accumulated from observations.
4. Verify GREEN; commit "fix(provider): observations are not a usage record".

**Done when:**
- A signal-killed dispatch that emitted observations returns a result with no `tokenUsage`.
- The test fails if usage is derived from accumulated observations.

**Files:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** 23.1

### Task 25: Live token burn and child observability reach a streaming step
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests: while a streaming step is running, the live status surface reports running uncached input and output token counts for it; a provider that cannot observe child activity reports child observability as unsupported rather than a count of zero.
2. Verify RED.
3. Supply the stream consumer at the streaming dispatch site so observations reach the existing live status surface. Add no second surface.
4. Verify GREEN; commit "feat(daemon): live burn reaches streaming steps".

**Done when:**
- A running streaming step's live status reports non-zero running token counts before the step completes.
- A provider without child observability reports unsupported, asserted to be distinguishable from zero.

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** 22

### Task 25.1: A quiet stream does not mark a running step stalled
**Story:** 9
**Type:** negative-path

**Steps:**
1. Write a failing test: a streaming step whose provider emits no observation for an extended interval is still reported as running, and is not reported as stalled solely because no observation arrived.
2. Verify RED.
3. Ensure liveness continues to derive from the existing activity heartbeat rather than from observation arrival.
4. Verify GREEN; commit "fix(daemon): observation silence is not a stall signal".

**Done when:**
- A streaming step with no observations for the configured stall interval is reported running, not stalled.
- The test fails if liveness is derived from observation arrival.

**Files:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** 25

### Task 26: Record the streaming-visibility before/after comparison
**Story:** 9
**Type:** verification
**Verify-only:** yes

**Steps:**
1. Run one streaming step under the unified dispatch and capture what the operator sees while it runs.
2. Compare it against the pre-change operator-visible output for the same step, recorded from the branch point.
3. Write the comparison into the feature's evidence, stating explicitly any information present before and absent after, and whether that loss is accepted or must be corrected.
4. Commit with an `Evidence: skipped` trailer per the verify-only convention.

**Done when:**
- A written before/after comparison for one named streaming step exists in the feature's evidence.
- It states, for each item of information visible before, whether it is still visible, and names any accepted loss.
- No production file is modified by this task.

**Files:**
- none

**Dependencies:** 25

## Task Dependency Graph

```text
1 ─┬─ 2
   ├─ 3 ── 4 ─┬─ 5
   │          ├─ 6
   │          ├─ 7 ── 8
   │          └─ 13 ── 14 ── 14.1
   └─ 9 ─┬─ 9.1
         └─ 10 ─┬─ 11
                ├─ 12
                └─ 13

7, 11 ── 15 ─┬─ 15.1
             └─ 16 ── 17 ── 18 ── 19 ── 20 ── 21

17 ── 22 ─┬─ 23 ── 23.1 ── 24
          └─ 25 ─┬─ 25.1
                 └─ 26
```

## Integration Points

- **After Task 8:** the claude adapter dispatches every mode through one body and delivers
  observations; testable in isolation against a faked stream.
- **After Task 14:** both adapters are unified and every enforcement that lived on the two bodies is
  pinned; the engine still calls the old member.
- **After Task 18:** every engine call site reaches `invoke`; the interface member is now dead code.
- **After Task 21:** the contract change is complete, including the reference plugin.
- **After Task 25:** the feature's outcome is observable end to end — a streaming step both records
  usage and reports live burn.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-fr79-1: src/conductor/test/execution/claude-provider.test.ts — add a non-REPL streaming dispatch test asserting ClaudeProvider.invoke spawns `options.selfHost.executable` (claude-provider.ts:555) and forwards `selfHost.args` (:778) and `selfHost.env` (:823) before the child home overrides provider state, and a sibling test asserting CodexProvider.invoke spawns `options.selfHost.executable` (codex-provider.ts:299); each test must fail if its adapter's `options.selfHost?.executable ?? <default>` is reverted to the bare default
**Gate:** prd-audit
**Rationale:** Plan Task 14 (`850d668ff`) landed as an empty commit, so no test asserts self-host executable resolution on a unified non-REPL dispatch; the behavior is present (`src/conductor/src/execution/claude-provider.ts:555,778,823` and `src/conductor/src/execution/codex-provider.ts:299` read `options.selfHost`), and Task 14's own file scope (claude-provider.ts, codex-provider.ts, claude-provider.test.ts) admits the missing regression guard, so this is owned build work rather than a plan gap. This task adds coverage only — it removes, replaces, or relaxes no existing code, test, or assertion. Matched-pair sweep: `selfHost?.executable` has exactly two adapter sites (claude-provider.ts:555, codex-provider.ts:299) and both are named in the task so the guard cannot cover one and miss the other; `src/conductor/test/engine/conductor.test.ts:10576` and `src/conductor/test/engine/self-host/live-containment.test.ts:92` were found and deliberately excluded because both stub the runner or the provider executor and so cannot pin the adapter-level resolution Task 14 owns.
**Criterion:** S7.9
**Parent task:** 14
**Done when:**
- S7.9 is satisfied by this task.
