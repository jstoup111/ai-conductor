# Implementation Plan: Stop retrying an unresolved skill dispatch and name its remedy

**Date:** 2026-09-06
**Stories:** .docs/stories/stop-retrying-an-unresolved-skill-dispatch-and-nam.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing provider contract and the existing build_review settlement contract: an unresolved command stays a non-success provider result, a rubric that cannot be judged stays an infrastructure failure, and no verdict, budget, or routing authority changes.

## Summary

Four bounded tasks deliver #1631. An auxiliary member stops consuming its retry allowance on a
deterministic unresolved-command result, and the rubric lane records a named cause and remedy in the
detail it already carries, surfaced on the event it already emits. A pre-dispatch skill-existence
preflight for ordinary lifecycle steps, parity of the unresolved-command signal across providers, and
any change to park-versus-halt routing are outside this slice.

## Technical Approach

The provider contract already declares `commandUnresolved` and `commandUnresolvedName`, and the
conductor already treats an ordinary step's unresolved command as terminal without retry, escalation,
or provider walking. The auxiliary executor is the one remaining loop that does not honor that
policy: it re-enters the candidate executor once per configured retry, and only a successful result
returns early. Add the same early return for an unresolved-command result, before the loop records it
as the last failure, so the classification reaches the caller unchanged. No change is needed inside
the candidate executor: an unresolved command is not a candidate-advancing classification there, so it
already returns without invoking a second provider, and that behavior is pinned by a new regression
assertion rather than re-implemented.

Render the operator-facing diagnosis as a pure function beside the existing dispatch-failure
constructor, so it is unit-testable without a provider, a worktree, or a filesystem probe. It takes
the rubric skill name and the unresolved command name and returns one sentence group naming the
skill, stating that retrying cannot make the command resolvable, and giving both remedies: relink the
provider skill catalog, and rebase a feature whose base predates the skill. The rebase remedy is
prose in the detail, not a routing decision — nothing in this slice parks, kicks back, or triggers a
rebase.

Widen the rubric dispatch helper's internal invocation result to carry the two contract fields it
currently drops, and, when the first invocation reports an unresolved command, return the pre-formed
dispatch failure carrying the rendered detail instead of the bare undefined that reaches the
coordinator today. Every other failure path keeps its current diagnosis: the repair turn, the
byte-identical guard, and the contract-rejection excerpts are untouched, and the unresolved-command
branch is checked before the repair turn so no second invocation is spent on a command that cannot
resolve.

The coordinator already carries a branch detail into the settled infrastructure failure and already
declares an optional excerpt on its infrastructure-failure event; the pre-dispatch digest branch fills
it while the post-dispatch branch does not. Fill it from the settled branch detail in the post-dispatch
emission loop, omitting the field when the branch has no detail. This is the existing event variant and
the existing optional field — one spine, one schema, no new channel and no new consumer.

Tests inject fake providers at the provider boundary and exercise the real internal executor,
dispatch helper, and coordinator. The auxiliary executor already has a unit fixture that injects
provider runtimes and asserts invocation counts; extend that pattern. The rubric dispatch assertion
stops at the dispatch helper's returned settlement rather than running a conductor. Rendering cases are
pure unit tests. No test may reach a real provider, network, or subprocess.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the excluded preflight, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/provider-execution.ts:781-810` loops `input.policy.max_retries` times and returns early only when `result.success` is true.
- Verified: `classifyProviderCandidateFailure` at `src/conductor/src/engine/provider-execution.ts:294-309` advances candidates only for provider-unavailability and model-unavailability, so an unresolved-command result already returns from the candidate executor without a second provider invocation.
- Verified: `src/conductor/src/execution/llm-provider.ts:235-237` declares `commandUnresolved` and `commandUnresolvedName` on the shared provider result contract, and `src/conductor/src/execution/claude-provider.ts:509,745` populates them from a zero-turn unknown-command envelope.
- Verified: `src/conductor/src/engine/conductor.ts:8757-8766` halts an ordinary step's unresolved command without retry, escalation, or provider walking, which is the policy this slice extends to the auxiliary loop.
- Verified: `src/conductor/src/engine/step-runners.ts:2200` types the rubric invocation result as success plus optional output only, and line 2259 returns undefined for any non-success first invocation.
- Verified: `src/conductor/src/engine/build-review-coordinator.ts:451-465` converts that undefined into an `invalid-provider-result` infrastructure failure whose detail is undefined, and lines 506-512 emit the settled infrastructure failure without an excerpt.
- Verified: `src/conductor/src/types/events.ts:265` already declares `excerpt` as an optional field of the infrastructure-failure event variant, so filling it is additive on an existing variant.
- Verified: `makeBuildReviewDispatchFailure` and `parseBuildReviewDispatchFailure` at `src/conductor/src/engine/build-review-domain.ts:115-117` are the existing pre-formed dispatch-failure envelope the coordinator reads before deriving its own diagnosis.
- Verified: `src/conductor/src/engine/step-runners.ts:1946-1967` resolves each registered rubric's installed SKILL.md digest and marks it unavailable when unreadable, and `src/conductor/src/engine/build-review-coordinator.ts:376-384` fails that rubric closed before dispatch, so a definition absent from the resolved harness root never reaches a provider today.
- Verified: `src/conductor/test/engine/provider-execution.test.ts:131` already exercises the auxiliary executor with injected provider runtimes and asserts per-provider invocation counts.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic by construction because the change reads the shared contract field and forks on no provider name. Event spine: no new channel and no new variant, only an existing optional field on an existing variant.
- Verify-claims verdict: CLEAR. One bounded assumption is recorded rather than asserted: only the claude adapter populates the unresolved-command fields today, so the auxiliary short-circuit is observable on that adapter first; closing that asymmetry is tracked separately and is not a precondition for this slice.

## Tasks

### Task 1: Render the unresolved-skill remedy
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/build-review-domain.ts, src/conductor/test/engine/build-review-domain.test.ts
**Dependencies:** none

**Steps:**
1. Write unit tests for a pure renderer that takes a rubric skill name and an unresolved command name and returns the operator-facing detail. Cover a named command, an absent command name, and a skill name that differs from the command name.
2. Establish RED, then implement the renderer beside the existing dispatch-failure constructor. The returned string names the rubric skill, states that no judgement was produced and that retrying cannot make the command resolvable, and gives both remedies: relink the provider skill catalog, and rebase a feature whose base predates the skill.
3. Keep the renderer pure: no filesystem access, no provider name, no configuration read, and no dependency on the harness root.
4. Run the focused unit tests and the repository typecheck for test files, then commit the focused change.

**Done when:**
1. The rendered detail contains the rubric skill name, the unresolved command name, the relink remedy, and the rebase remedy for a fully specified input.
2. The renderer returns a complete detail naming the skill and both remedies when no command name is available, and never emits an empty or placeholder fragment.
3. The renderer is exported, takes only its two string inputs, and performs no input or output.

### Task 2: Stop the auxiliary retry loop on an unresolved command
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/provider-execution.ts, src/conductor/test/engine/provider-execution.test.ts
**Dependencies:** none

**Steps:**
1. Extend the existing auxiliary executor fixture with an injected provider whose result reports an unresolved command, configured with an allowance greater than one, and assert the invocation count. Add a second fixture with two configured provider candidates whose first candidate reports the unresolved command.
2. Add a third fixture in which the injected provider fails for an ordinary reason on every attempt, to pin that the configured allowance is still consumed in full and the returned result carries no unresolved-command classification.
3. Establish RED, then return the unresolved-command result from the auxiliary loop immediately, before it is recorded as the last failure, so the caller receives the classification unchanged.
4. Leave the candidate executor untouched; the second-provider fixture pins its existing non-advancing behavior rather than changing it.
5. Run the focused unit tests and the repository typecheck for test files, then commit the focused change.

**Done when:**
1. A member with an allowance greater than one whose provider reports an unresolved command records exactly one provider invocation.
2. The returned result of that member still reports failure and still carries the unresolved-command classification and command name.
3. A member configured with two provider candidates records zero invocations against the second when the first reports an unresolved command.
4. A member failing for an ordinary reason consumes its full configured allowance and returns a result with no unresolved-command classification.

### Task 3: Record the named failure for an unresolved rubric skill command
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/step-runners.test.ts
**Dependencies:** 1, 2

**Steps:**
1. Write a dispatch-helper test whose injected provider returns a failed result carrying the unresolved-command classification, and assert the returned settlement is the pre-formed dispatch failure whose detail is the rendered remedy.
2. Add a companion test whose injected provider returns a successful but contract-violating output, asserting the existing repair turn and contract-rejection diagnosis are unchanged and carry no remedy text.
3. Establish RED, then widen the helper's internal invocation result to carry the two contract fields it currently drops, from both the runtime-candidates path and the single-provider path.
4. Return the pre-formed dispatch failure carrying the rendered remedy when the first invocation reports an unresolved command, checked before the repair turn so no second invocation is spent.
5. Run the focused tests and the repository typecheck for test files, then commit the focused change.

**Done when:**
1. A rubric dispatch whose first invocation reports an unresolved command returns a dispatch failure whose detail is the rendered remedy, and never a judgement.
2. That dispatch performs exactly one provider invocation, with no repair turn.
3. A contract-violating but successful output still produces the existing repair turn and the existing rejection diagnosis, with no remedy text added.

### Task 4: Surface the settled failure detail on its existing event
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/build-review-coordinator.ts, src/conductor/test/engine/build-review-coordinator.test.ts
**Dependencies:** 3

**Steps:**
1. Extend the coordinator fixture with an injected dispatch that returns a pre-formed dispatch failure carrying a detail, and assert the emitted post-dispatch infrastructure-failure event.
2. Add a companion case whose settled branch carries no detail, asserting the emitted event omits its excerpt field entirely.
3. Establish RED, then fill the already-optional excerpt field from the settled branch detail in the post-dispatch emission loop, omitting the field when the detail is absent.
4. Add no event variant and no field: the variant and the optional field already exist and the pre-dispatch branch already fills it.
5. Run the focused tests and the repository typecheck for test files, then commit the focused change.

**Done when:**
1. The post-dispatch infrastructure-failure event carries the settled branch detail as its excerpt when a detail is present.
2. The emitted event object has no excerpt property when the settled branch carries no detail.
3. The settled branch result is unchanged: the same reason, the same detail, and the same failure kind as before this task.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an auxiliary member's first provider attempt reports an unresolved skill command, when the auxiliary executor settles that member, then it makes no further provider attempt and returns that attempt's result with its unresolved-command classification intact. | 2 | "A member with an allowance greater than one whose provider reports an unresolved command records exactly one provider invocation." | diff-local |
| Story 1 happy: Given an auxiliary member's first provider attempt fails for an ordinary reason, when the auxiliary executor settles that member, then it retries up to the member's configured allowance exactly as before. | 2 | "A member failing for an ordinary reason consumes its full configured allowance and returns a result with no unresolved-command classification." | diff-local |
| Story 1 negative: Given an auxiliary member is configured with a second provider candidate and its first candidate reports an unresolved skill command, when the auxiliary executor settles that member, then the second provider is never invoked and the returned result still names the unresolved command. | 2 | "A member configured with two provider candidates records zero invocations against the second when the first reports an unresolved command." | diff-local |
| Story 1 negative: Given an auxiliary member exhausts its configured allowance on ordinary failures, when the auxiliary executor settles that member, then the returned result is the last ordinary failure and carries no unresolved-command classification. | 2 | "A member failing for an ordinary reason consumes its full configured allowance and returns a result with no unresolved-command classification." | diff-local |
| Story 2 happy: Given a rubric dispatch whose provider attempt reports an unresolved skill command, when that rubric branch settles, then the lap records a dispatch failure whose detail names the rubric skill, states that retrying cannot resolve it, and gives both the catalog-relink and the rebase remedy. | 1, 3 | "A rubric dispatch whose first invocation reports an unresolved command returns a dispatch failure whose detail is the rendered remedy, and never a judgement." | diff-local |
| Story 2 happy: Given a rubric branch settles as an infrastructure failure after dispatch and carries a detail, when the coordinator emits its infrastructure-failure event, then the event carries that detail as its excerpt. | 4 | "The post-dispatch infrastructure-failure event carries the settled branch detail as its excerpt when a detail is present." | diff-local |
| Story 2 negative: Given a rubric dispatch fails for any reason other than an unresolved skill command, when that rubric branch settles, then the recorded detail is the existing contract-rejection diagnosis and no remedy text is added. | 3 | "A contract-violating but successful output still produces the existing repair turn and the existing rejection diagnosis, with no remedy text added." | diff-local |
| Story 2 negative: Given a rubric branch settles as an infrastructure failure with no detail, when the coordinator emits its infrastructure-failure event, then the event omits its excerpt field rather than carrying an empty one. | 4 | "The emitted event object has no excerpt property when the settled branch carries no detail." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures with injected provider runtimes. Task 1 owns
the pure rendering cases. Task 2 owns the auxiliary executor's invocation-count and classification
cases, including the regression assertion that the candidate executor still does not advance to a
second provider. Task 3 owns the rubric dispatch helper's settlement cases and stops at the helper's
returned value rather than running a conductor. Task 4 owns the coordinator's emission cases. Existing
provider-execution, dispatch, and coordinator suites supply the unchanged retry, fallback, repair, and
rejection permutations; no new aggregate, conductor, or external-service test is required, and no
terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 3
Task 2 -> Task 3
Task 3 -> Task 4
