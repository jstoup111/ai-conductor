**Status:** Accepted

# Stories: Coherent FINISH Publication

## Story 1: Detect deterministic blockers before judgment

**Requirement:** FR-1
**Requirement:** FR-2

As an unattended operator, I want mechanically knowable FINISH blockers evaluated before a judgment pass so that time and retry budget are not spent on work that cannot complete.

### Acceptance Criteria

#### Happy Path

- Given green SHIP evidence and all currently knowable publication prerequisites, when FINISH begins, then the system advances to the judgment-dependent work without reporting a blocker.
- Given a missing or invalid deterministic prerequisite, when FINISH begins, then the system performs no judgment dispatch and reports the exact failed condition and permitted next action.

#### Negative Paths

- Given the prerequisite reader cannot distinguish valid from invalid state, when FINISH begins, then the system reports the condition as indeterminate and does not treat it as satisfied.
- Given several deterministic prerequisites are unsatisfied, when FINISH begins, then the report identifies a stable actionable blocker without dispatching judgment or changing unrelated publication state.

### Done When

- [ ] A deterministic-gap fixture records zero FINISH judgment dispatches.
- [ ] The failure result exposes a typed condition plus an actionable operator message.
- [ ] A ready fixture reaches the judgment boundary exactly once.

## Story 2: Resume publication without duplicating effects

**Requirement:** FR-3
**Requirement:** FR-4

As a recovery operator, I want FINISH to resume from verified publication progress so that retries never replay completed external or repository effects.

### Acceptance Criteria

#### Happy Path

- Given a partially completed publication with earlier effects verified, when FINISH resumes, then it starts at the first incomplete transition and retains the completed effects.
- Given publication is retried after a process restart, when authoritative repository and external state still agree, then the same next transition is selected without relying on process-local memory.

#### Negative Paths

- Given a local completion hint conflicts with Git or GitHub state, when FINISH resumes, then authoritative observed state wins and the conflicting transition is not declared complete.
- Given two resume attempts observe the same incomplete effect concurrently, when they advance, then stable identity and verify-after-write behavior yield one PR, one shipped record, and one final outcome rather than duplicates.
- Given an external write succeeds but its response is lost, when FINISH retries, then it discovers and verifies the existing effect instead of creating another one.

### Done When

- [ ] A transition-table test covers every partial-progress state and expected next transition.
- [ ] Retry and restart acceptance tests prove no duplicate PR, shipped record, comment, or outcome marker.
- [ ] Conflicting local-versus-external evidence fails closed with a typed result.

## Story 3: Keep publication recovery inside FINISH

**Requirement:** FR-5
**Requirement:** FR-6

As an operator with already-validated implementation work, I want publication-only failures isolated from BUILD so that completed code is not churned unnecessarily.

### Acceptance Criteria

#### Happy Path

- Given valid implementation and SHIP evidence plus a publication-only failure, when recovery is classified, then the feature remains at FINISH and retries only the incomplete publication transition.
- Given current evidence proves an implementation defect or invalid implementation proof, when recovery is classified, then the feature routes to BUILD with the cited evidence.

#### Negative Paths

- Given a publication failure message contains no implementation-invalid evidence, when recovery is classified, then generic remediation cannot select BUILD.
- Given the classifier receives an unknown or contradictory failure shape, when recovery runs, then it halts for human review rather than defaulting to BUILD or success.
- Given BUILD evidence became stale during a publication retry, when FINISH re-evaluates it, then the stale evidence is classified as implementation-invalid rather than hidden by prior publication progress.

### Done When

- [ ] Every FINISH disposition maps exhaustively to FINISH retry, BUILD, human HALT, or complete.
- [ ] An acceptance test proves a release-readiness publication gap never dispatches BUILD.
- [ ] An implementation-invalid fixture proves BUILD routing includes concrete evidence.

## Story 4: Bound judgment to one quality pass

**Requirement:** FR-7
**Requirement:** FR-8

As a repository reader, I want FINISH to retain a real quality check for PR prose without asking judgment to orchestrate mechanical publication.

### Acceptance Criteria

#### Happy Path

- Given green SHIP evidence, satisfied deterministic prerequisites, and incomplete PR prose, when FINISH runs, then it performs one bounded title/body quality pass and completes the remaining mechanical verification without a second judgment pass.
- Given PR title and body already satisfy the accepted quality contract, when FINISH resumes, then it skips judgment and proceeds to completion verification.

#### Negative Paths

- Given the judgment pass returns placeholder, halt, or structurally incomplete prose, when quality is checked, then FINISH does not record completion.
- Given the judgment provider times out or is unavailable, when the quality pass runs, then completed mechanical transitions remain intact and FINISH returns a retryable or human-action result according to existing provider policy.
- Given mechanical publication succeeds after prose was accepted but final verification fails, when FINISH retries, then it does not dispatch a second prose pass unless observed PR content has become stale.

### Done When

- [ ] A normal publishable fixture records at most one FINISH judgment dispatch.
- [ ] Accepted existing prose records zero judgment dispatches.
- [ ] Placeholder and provider-failure fixtures leave final completion unrecorded while preserving verified progress.

## Story 5: Preserve interactive and foreground conduct

**Requirement:** FR-9
**Requirement:** FR-11

As an interactive operator, I want conversational conduct and my publication choices preserved while all execution modes use the same completion rules.

### Acceptance Criteria

#### Happy Path

- Given interactive conduct, when FINISH reaches an operator-owned outcome choice, then the host asks for that choice before deterministic publication actions advance.
- Given equivalent PR intent and repository state in interactive, foreground-auto, and daemon runs, when FINISH completes, then each mode satisfies the same publication evidence contract.

#### Negative Paths

- Given an interactive operator declines or defers publication, when FINISH receives that response, then no PR-ready or final-completion effect is synthesized.
- Given foreground-auto has no publishable remote, when its existing safe keep policy applies, then work remains committed and completion follows the non-PR evidence contract without attempting GitHub effects.
- Given one mode supplies an outcome that its policy does not authorize, when FINISH evaluates intent, then it refuses the outcome rather than weakening completion rules for that mode.

### Done When

- [ ] Interactive acceptance coverage proves a user choice precedes publication advancement.
- [ ] Mode-matrix coverage exercises interactive, default foreground, foreground-auto, and daemon behavior.
- [ ] Equivalent PR outcomes converge on one completion predicate across modes.

## Story 6: Halt safely on unauthorized publication decisions

**Requirement:** FR-10
**Requirement:** FR-12

As an unattended operator, I want unsafe or ambiguous publication decisions to halt so that automation never guesses, discards work, or merges a PR.

### Acceptance Criteria

#### Happy Path

- Given an authorized unattended PR publication with unambiguous evidence, when FINISH advances, then it performs only the permitted create/update/push/ready effects and leaves merge to the operator.
- Given a decision requires human authority, when FINISH encounters it, then it emits an actionable human-required halt and preserves all work and verified publication progress.

#### Negative Paths

- Given ambiguous PR identity, indeterminate push safety, or a destructive choice, when unattended FINISH evaluates the next action, then it performs no guessed mutation and halts.
- Given any transition or retry path, when its possible external effects are enumerated, then no path invokes pull-request merge or enables automatic merge.
- Given GitHub is unavailable during a load-bearing external transition, when safety cannot be verified, then FINISH retains prior verified state and does not report completion.

### Done When

- [ ] Negative-path tests cover ambiguity, destructive intent, indeterminate evidence, and dependency unavailability.
- [ ] Production-call reachability tests prove no FINISH transition reaches merge authority.
- [ ] Human-required results preserve the branch, worktree state, PR, and completed transition evidence.

## Story 7: Record completion only from coherent evidence

**Requirement:** FR-13

As a daemon supervisor, I want FINISH completion recorded only after local and external publication state agree so that no feature is falsely shipped.

### Acceptance Criteria

#### Happy Path

- Given authorized intent, accepted prose, pushed branch state, correct PR identity, valid durable shipment evidence, and all required publication effects, when final verification runs, then the final outcome is recorded and FINISH becomes complete.

#### Negative Paths

- Given any required durable or external effect is missing, stale, malformed, mismatched, uncommitted, or unpushed, when final verification runs, then the final marker is not written and the exact incoherence is returned.
- Given the final marker exists but authoritative evidence no longer supports it, when completion is revalidated, then FINISH is not accepted as complete.
- Given the state write succeeds but final marker creation fails, when FINISH resumes, then the partial write cannot masquerade as completion and the recorder safely retries.

### Done When

- [ ] A full evidence matrix proves only the coherent row passes.
- [ ] Marker-without-evidence and evidence-without-marker cases fail closed.
- [ ] Interrupted final recording resumes without false completion or duplicate durable effects.

## Verify-Claims Ledger

### Claims

- [verified] Every scenario traces to FR-1 through FR-13 and the approved ADR's explicit failure modes.
- [verified] Network, concurrency, partial-failure, idempotency, alternate-mode, and data-integrity negatives are represented where applicable.

### Assumptions

- None pending. Mode authority, no-merge behavior, prose quality, fail-closed evidence, and recovery boundaries are explicit in the approved PRD and ADR.

Verdict: CLEAR
