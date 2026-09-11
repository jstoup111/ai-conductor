**Status:** Accepted

# Stories: Stop refuting blanket environment-denial claims (#1298)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the environment-claim audit's refutation decision and the explanation it renders. The write fence's own over-blocking behavior, new audited operations, and provider policy are outside this slice.

## Story 1: Leave a blanket command-denial claim alone

As the engine, I want to refute only the proposition my evidence actually contradicts, so that a dispatch reporting a total command block is not failed on evidence about a single operation name.

### Acceptance Criteria

#### Happy Path

- Given a claude dispatch output that blames the write fence for blocking all Bash commands and cites `gh pr list` as one of them, when the environment-claim audit runs, then it produces no refuted claim and a null message.
- Given the incident blocker prose that names `git push` and `gh pr` without asserting denial of every command, when the environment-claim audit runs, then it still refutes both operations as it does today.
- Given a claude dispatch whose output asserts blanket Bash denial, when the self-host candidate-safety wrapper evaluates the dispatch, then it returns the dispatch result unchanged in success flag, exit code, and output.

#### Negative Paths

- Given output that names a fenced operation and also carries unrelated totalizing prose such as an all-tests-pass summary, when the environment-claim audit runs, then the refutation still fires because no denial of every command was asserted.
- Given output asserting blanket Bash denial on a dispatch for which no write fence was installed, when the environment-claim audit runs, then it still produces no refuted claim.

### Done When

- [ ] The audit returns an empty refutation set and a null message for a blanket-denial output naming a fenced operation, on both fenced and unfenced claude dispatches.
- [ ] The audit still refutes `git push` and `gh` for the incident blocker prose recorded in the existing unit spec.
- [ ] The self-host candidate-safety wrapper returns a blanket-denial claude dispatch result byte-identical to what the provider returned.
- [ ] Unrelated totalizing prose in an output does not suppress a refutation that would otherwise fire.

## Story 2: State which proposition the refutation disproved

As an operator reading `.daemon/daemon.log`, I want each refutation to name the proposition it disproved and the evidence, so that a wrong refutation is visible instead of indistinguishable from a right one.

### Acceptance Criteria

#### Happy Path

- Given the audit refutes a claim, when it renders the refutation message, then the message names the disproved proposition as a write-fence rule denying the named operations and cites the fence-script scan and the unsandboxed provider as its evidence.

#### Negative Paths

- Given a later attempt echoes the full rendered refutation, including its new proposition and evidence sentences, when the environment-claim audit runs on that output, then it produces no refuted claim and a null message.

### Done When

- [ ] The rendered refutation for the incident blocker contains an explicit proposition statement naming the fence-rule proposition and the operations it covers.
- [ ] The rendered refutation names the generated fence script scan and the provider's absence of an OS sandbox as the evidence for that proposition.
- [ ] Feeding the full rendered refutation back through the audit yields no refuted claim.

## Negative-category review

Invalid and ambiguous input is covered by the over-suppression case (totalizing prose that is not a denial assertion) and by the echo case, which is the module's idempotency and self-reference guard. Dependency-unavailability and permission categories map here to the dispatch-fact inputs: the unfenced-dispatch case pins behavior when the fence dependency is absent, and the provider sandbox policy is unchanged and already covered by the existing spec. The audit is a pure function over a string and dispatch facts, so concurrency, timeout, partial-failure, rollback, resource-exhaustion, cascade-deletion, and data-integrity categories are inapplicable: it performs no I/O, holds no state, and deletes nothing. Immutability is preserved by returning a new result object rather than mutating the dispatch result.
