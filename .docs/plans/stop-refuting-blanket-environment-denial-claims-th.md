# Implementation Plan: Stop refuting blanket environment-denial claims (#1298)

**Date:** 2026-09-06
**Stories:** .docs/stories/stop-refuting-blanket-environment-denial-claims-th.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the audit's existing contract — refute only what the dispatch facts positively disprove, never widen what counts as a claim, and keep the fence-derived deniable-operation set and provider policy authoritative.

## Summary

Four bounded tasks deliver #1298: a blanket command-denial detector, its use as a negative guard on the refutation decision, an explicit proposition-and-evidence sentence in the rendered refutation, and a wrapper-level integration proof that a blanket-denial dispatch passes through untouched. The fence's own over-blocking behavior, new audited operations, and provider policy stay outside this slice.

## Technical Approach

The audit today requires an environmental cause, a blocking assertion, and an audited-operation regex on one line, then refutes whenever the generated fence script carries no token for that operation. That evidence disproves exactly one proposition — "the fence carries a rule naming this operation" — which a deny-all claim never asserts, so the engine refutes a claim it did not disprove.

Add one exported predicate to the audit module that recognizes an assertion of unbounded command denial. Recognition requires a denial quantifier bound to a command surface, not a bare quantifier: forms such as blocking or rejecting all/every/any Bash, shell, tool, or terminal commands, calls, or invocations; blocking or denying or rejecting or refusing everything; and an unconditional block, denial, rejection, or refusal. Keep the pattern list short, explicit, and case-insensitive, in the same style as the module's existing cause and assertion tables, and scan the whole output rather than a single line so that a hard-wrapped provider paragraph cannot split the quantifier away from its verb.

Use the predicate as a negative guard in the audit entry point, evaluated after the provider check and before claim detection: when the output asserts blanket denial, return the module's existing empty result. Suppression is deliberately independent of whether a write fence was installed, because the engine still cannot disprove a total command failure when no fence exists; that is the module's documented asymmetry, and the accepted cost is that a claim of total denial is left alone rather than failed. Nothing else about detection changes: the three-signal line rule, the fence-derived deniable set, and the marker that stops the audit re-refuting its own quoted message all stay as they are.

Then extend the rendered message with one proposition sentence and one evidence sentence, placed with the existing engine-facts block, so the log distinguishes what was disproved from what was merely claimed. The added prose deliberately avoids the guard's own vocabulary; the echo case in the unit spec proves the message cannot re-trigger or silently change the audit's verdict when a later attempt quotes it back.

The existing specs supply the test patterns. The unit spec already table-drives the incident blocker, the provider policy, the unfenced dispatch, and the echo case; the new unit cases follow that shape and inject dispatch facts directly. The integration spec already reaches the conductor's self-host candidate-safety wrapper through a scripted fake provider result with no CLI, network, or LLM; the new integration case reuses that helper unchanged and asserts pass-through. Tests may vary fixture builders and assertion grouping provided they keep those boundaries. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the negative-guard approach over sentence-scope detection, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/self-host/environment-claim-audit.ts` detects a claim only when an environmental cause, a blocking assertion, and an audited-operation regex all match the same trimmed line, and refutes every detected claim whose operation is absent from the fence-derived deniable set.
- Verified: the same module's `AUDITED_OPERATIONS` gives `gh` the fence token `\bgh\b` and `git push` the token `\bpush\b`, and `writeFenceDeniableOperations()` derives the deniable set by scanning `generateFenceScript` output.
- Verified: the same module short-circuits on any line containing the `ENVIRONMENT_CLAIM_REFUTED` marker, which is why an echoed refutation does not loop the step.
- Verified: `src/conductor/src/engine/self-host/write-fence.ts` treats any `>`, `>>`, or `&>` redirection as a write shape and greps the entire tool-call JSON for `>` before printing its undeterminable-target block, so a total Bash block is a reachable failure mode rather than a fabrication.
- Verified: `src/conductor/src/engine/conductor.ts` calls the audit inside `withSelfHostCandidateSafety` and converts a non-null message into a failed attempt, so each false refutation costs one attempt of the retry budget.
- Verified: `src/conductor/test/engine/environment-claim-audit.test.ts` and `src/conductor/test/integration/environment-claim-refutation.integration.test.ts` exist and hold the incident, provider-policy, unfenced, echo, and wrapper cases the change must not regress.
- Scope check: harness-repo-only (self-host engine machinery); no skill addition; provider-agnostic. Event spine: no new event, metric, span, or channel — the change edits an existing gate result's text only.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree; no load-bearing assumption remains unconfirmed.

## Tasks

### Task 1: Recognize an assertion of unbounded command denial
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/self-host/environment-claim-audit.ts, src/conductor/test/engine/environment-claim-audit.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven unit tests for the new exported predicate: blocking all Bash commands, rejecting every Bash call, being unable to run any shell commands, an unconditional block, and a claim that the fence blocks everything.
2. Add the negative controls in the same table: the incident blocker prose naming both remote operations, an all-tests-pass and every-task-committed summary, and prose that quantifies something other than commands.
3. Verify the new cases fail (RED), then implement the predicate as a short case-insensitive pattern list in the module's existing table style, requiring a denial quantifier bound to a command surface or an explicit everything or unconditional denial.
4. Verify the cases pass (GREEN) and commit the focused change.

**Done when:**
1. The predicate returns true for blocking all Bash commands, rejecting every Bash call, inability to run any shell commands, an unconditional denial, and blocking everything.
2. The predicate returns false for the incident blocker prose, for an all-tests-pass and every-task-committed summary, and for a quantifier that is not bound to a command surface.
3. The predicate is exported from the audit module and evaluated over the whole output string rather than one line.

### Task 2: Suppress the operation-specific refutation for a blanket claim
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/self-host/environment-claim-audit.ts, src/conductor/test/engine/environment-claim-audit.test.ts
**Dependencies:** 1

**Steps:**
1. Write unit tests for the audit entry point using the reported dispatch output — a write-fence hook blamed for blocking all Bash commands with `gh pr list` named as one of them — on a fenced claude dispatch and on an unfenced one.
2. Add the regression cases in the same run: the incident blocker prose still refutes both operations, and a fenced-operation claim carried alongside unrelated totalizing prose still refutes.
3. Verify RED, then apply the predicate as a negative guard in the entry point, after the provider check and before claim detection, returning the module's existing empty result.
4. Verify GREEN, confirm the existing spec's provider, unfenced, echo, and empty-output cases still pass, and commit.

**Done when:**
1. The audit returns an empty refutation set and a null message for the blanket-denial output naming `gh pr list`, on both a fenced and an unfenced claude dispatch.
2. The audit still refutes `git push` and `gh` for the incident blocker prose held in the existing unit spec.
3. A fenced-operation claim accompanied only by unrelated totalizing prose is still refuted.
4. Every pre-existing case in the audit unit spec passes unchanged.

### Task 3: State the disproved proposition and its evidence
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/self-host/environment-claim-audit.ts, src/conductor/test/engine/environment-claim-audit.test.ts
**Dependencies:** 2

**Steps:**
1. Write unit tests asserting the rendered refutation for the incident blocker names the disproved proposition as a write-fence rule denying the named operations, and names the fence-script scan and the provider's absence of an OS sandbox as the evidence.
2. Add the echo case for the extended message: feed the full rendered refutation back through the audit and assert an empty result and a null message.
3. Verify RED, then add the proposition and evidence sentences to the rendered message alongside the existing engine-facts block, keeping the added prose clear of the blanket-denial vocabulary.
4. Verify GREEN and commit.

**Done when:**
1. The rendered refutation contains a proposition statement naming a write-fence rule denying the refuted operations.
2. The rendered refutation names the generated fence-script scan and the provider's absence of an OS sandbox as the evidence for that proposition.
3. Feeding the full rendered refutation back through the audit returns an empty refutation set and a null message.

### Task 4: Prove pass-through at the self-host candidate-safety wrapper
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/integration/environment-claim-refutation.integration.test.ts
**Dependencies:** 2

**Steps:**
1. Add a scripted fake provider result carrying the reported blanket-denial output to the existing integration spec, alongside its incident and honest-finish fixtures.
2. Dispatch it through the spec's existing candidate-safety helper on the claude provider and assert the returned result equals the injected result.
3. Verify the existing wrapper cases — the refuted incident dispatch, the honest finish, and the codex dispatch — still hold, and keep the run bounded to the wrapper with no conductor run, network, or provider process.
4. Commit the focused integration change.

**Done when:**
1. The self-host candidate-safety wrapper returns the blanket-denial claude dispatch result unchanged in success flag, exit code, and output.
2. The wrapper still fails the incident dispatch and carries the refutation marker in its output.
3. The integration case reaches the wrapper through the spec's existing scripted fake result, launching no conductor run and no external process.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a claude dispatch output that blames the write fence for blocking all Bash commands and cites `gh pr list` as one of them, when the environment-claim audit runs, then it produces no refuted claim and a null message. | 1, 2 | "The audit returns an empty refutation set and a null message for the blanket-denial output naming `gh pr list`, on both a fenced and an unfenced claude dispatch." | diff-local |
| Story 1 happy: Given the incident blocker prose that names `git push` and `gh pr` without asserting denial of every command, when the environment-claim audit runs, then it still refutes both operations as it does today. | 2 | "The audit still refutes `git push` and `gh` for the incident blocker prose held in the existing unit spec." | diff-local |
| Story 1 happy: Given a claude dispatch whose output asserts blanket Bash denial, when the self-host candidate-safety wrapper evaluates the dispatch, then it returns the dispatch result unchanged in success flag, exit code, and output. | 4 | "The self-host candidate-safety wrapper returns the blanket-denial claude dispatch result unchanged in success flag, exit code, and output." | diff-local |
| Story 1 negative: Given output that names a fenced operation and also carries unrelated totalizing prose such as an all-tests-pass summary, when the environment-claim audit runs, then the refutation still fires because no denial of every command was asserted. | 1, 2 | "A fenced-operation claim accompanied only by unrelated totalizing prose is still refuted." | diff-local |
| Story 1 negative: Given output asserting blanket Bash denial on a dispatch for which no write fence was installed, when the environment-claim audit runs, then it still produces no refuted claim. | 2 | "The audit returns an empty refutation set and a null message for the blanket-denial output naming `gh pr list`, on both a fenced and an unfenced claude dispatch." | diff-local |
| Story 2 happy: Given the audit refutes a claim, when it renders the refutation message, then the message names the disproved proposition as a write-fence rule denying the named operations and cites the fence-script scan and the unsandboxed provider as its evidence. | 3 | "The rendered refutation contains a proposition statement naming a write-fence rule denying the refuted operations." | diff-local |
| Story 2 negative: Given a later attempt echoes the full rendered refutation, including its new proposition and evidence sentences, when the environment-claim audit runs on that output, then it produces no refuted claim and a null message. | 3 | "Feeding the full rendered refutation back through the audit returns an empty refutation set and a null message." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: the audit is a pure function over an output string and injected dispatch facts, so no commit outside this feature's diff can change whether a criterion holds. Task 1 owns unit coverage of the new predicate, including the over-suppression controls. Task 2 owns unit coverage of the refutation decision, including the incident regression and the unfenced case. Task 3 owns unit coverage of the rendered message and the echo guard. Task 4 owns the single cross-boundary integration proof, at the conductor's self-host candidate-safety wrapper, using the integration spec's existing scripted fake provider result; the wrapper is the only production boundary this behavior crosses, and no new boundary is introduced. The existing unit and integration cases remain authoritative for provider policy, empty output, honest dispatches, and observed command failures; no aggregate, smoke, or external-service test is added, and no terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
Task 2 -> Task 4
