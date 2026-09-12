**Status:** Accepted

# Stories: Selective verification after a completed rebase

**Source-Ref:** jstoup111/ai-conductor#2253
**Track:** technical
**Architecture:** adr-2026-09-11-selective-post-rebase-verification
**Approval:** Operator accepted these seven stories in the composer session on 2026-09-11.

The scope is the whole approved post-rebase flow. Existing finish/re-kick entry policy, #2453 active-input classification, and #2495 pre-rebase recovery remain authoritative. Every preservation scenario assumes a previously passing, currently applicable verdict and completed work; none cancels an outstanding failure or repair.

## Story 1: Clean replay preserves completed work

As the daemon operator, I want a clean replay of completed work to retain valid approvals so that upstream changes do not cause redundant authoring, implementation, or feature reviews.

### Acceptance Criteria
#### Happy Path
- Given completed acceptance specs and BUILD and passing feature reviews, when a successful rebase preserves the expected feature replay including disjoint upstream edits in the same file, then acceptance_specs, BUILD, build_review, prd_audit, and architecture_review_as_built are not dispatched again solely because of that rebase.
- Given that replay changes aggregate verification or runtime inputs, when the loop continues, then current aggregate proof is established before required downstream reviews and applicable manual testing still runs for changed runtime behavior.
#### Negative Paths
- Given the implementation replay is unchanged but an active review input changed, when revalidation is selected, then the affected review is reopened and cannot inherit approval from implementation equivalence alone.
- Given a gate was already failing, pending repair, or lacked valid evidence before rebase, when unchanged replay is established, then that gate is not converted into a preserved PASS.
### Done When
- [ ] A bounded production-flow fixture records zero extra acceptance, BUILD, and preserved-review dispatches for the same-file disjoint replay.
- [ ] The fixture observes current suite evidence and applicable manual-test execution before publication can proceed.

## Story 2: Changed or unprovable replay revalidates explicitly

As the operator, I want uncertain or changed replay to cause the checks it actually needs without restarting completed work by position.

### Acceptance Criteria
#### Happy Path
- Given a successful conflict resolution changes the feature result, when post-rebase checks are selected, then the affected judged gates and required suite verification reopen while completed acceptance authoring and BUILD are not reopened merely because of their location.
- Given replay equivalence cannot be established but completion evidence remains valid, when the loop continues, then affected reviews are conservatively revalidated and no event claims unchanged replay was proved.
#### Negative Paths
- Given a missing baseline, unsupported Git capability, failed comparison command, or conflicting reconstruction, when replay preservation is considered, then no unchanged-replay approval is issued.
- Given completed BUILD evidence cannot be established after rebase, when continuation is evaluated, then progress blocks with evidence/recovery diagnostics rather than blindly dispatching the completed task list or proceeding to publication.
### Done When
- [ ] Changed-resolution and unavailable-comparison fixtures expose the actual required gate set without an acceptance/BUILD positional cascade.
- [ ] An unavailable-completion fixture reaches its named recovery/halt observation with zero blind BUILD dispatches and no publication.

## Story 3: Coverage refresh does not restart implementation

As the operator, I want affected coverage claims checked without reopening unrelated completed work.

### Acceptance Criteria
#### Happy Path
- Given coverage inputs changed after a successful rebase and the refreshed claims pass, when coverage is checked, then its evidence is refreshed and continuation reaches the required verification tail without dispatching acceptance_specs or a completed BUILD.
- Given coverage pairs are unchanged or the judge is disabled by existing configuration, when coverage refresh is required, then the existing cache or disabled behavior is retained without unnecessary judge dispatch.
#### Negative Paths
- Given a refreshed claim does not assert its criterion, when coverage evaluates it, then the existing human-correction refusal blocks progress without appending a task or starting an unrelated BUILD.
- Given the coverage judge or its result is unavailable or malformed, when refresh runs, then existing bounded retry/refusal handling applies and neither coverage PASS nor permission to publish is fabricated.
### Done When
- [ ] Coverage refresh through the production runner emits its existing lifecycle evidence and retains zero unrelated authoring/BUILD dispatches.
- [ ] Cache, disabled, rejected-claim, and unavailable-result fixtures observe their existing distinct outcomes.

## Story 4: Real test failure enters repair

As the operator, I want a broken combined tree repaired while infrastructure failures retain their proper recovery route.

### Acceptance Criteria
#### Happy Path
- Given a post-rebase suite command completes with a failing exit, when its result is processed, then BUILD receives the failure evidence for scoped repair and a successful repair is followed by suite verification and ordinary downstream validation.
- Given the native verifier establishes current passing proof through execution or permitted reuse, when the result is processed, then rebase alone causes no BUILD repair dispatch.
#### Negative Paths
- Given the verifier times out, cannot launch, or cannot establish a result, when failure is processed, then infrastructure recovery applies without charging a code-repair kickback as though tests failed.
- Given the existing repair or infrastructure allowance is exhausted, when the next failure is processed, then the existing bounded halt occurs and publication remains blocked.
### Done When
- [ ] A bounded conductor fixture observes failure evidence at BUILD and the subsequent suite/review sequence after repair.
- [ ] Passing/reused, infrastructure-failure, and exhausted-budget fixtures distinguish their routes and ledger effects.

## Story 5: Preserved authority survives finish and resume checks

As the operator, I want a valid preserved review honored throughout the remaining lifecycle rather than rejected by another reader.

### Acceptance Criteria
#### Happy Path
- Given a review was validly preserved after rebase and its relevant inputs remain unchanged, when finish evaluates its evidence, then the review is accepted without another judge dispatch.
- Given the same valid preservation survives a process restart, when resume and stale-artifact cleanup inspect it, then the passing evidence is retained and the review is not redispatched solely because the session changed.
#### Negative Paths
- Given relevant code or review inputs change after preservation, or an ordinary repair kickback is outstanding, when a reader checks the verdict, then the old preservation cannot satisfy the gate.
- Given preservation evidence is absent, malformed, belongs to another gate or verdict, or references unavailable replay objects, when a reader evaluates it, then it grants no additional preservation authority and existing evidence rules apply.
### Done When
- [ ] Production completion, sweep, resume, and finish consumers retain valid preserved evidence without changing the original judge identity.
- [ ] Changed-input, outstanding-failure, and invalid-binding fixtures deny preservation at those consumers.

## Story 6: Reopening has consistent durable effects

As the operator, I want state, verdicts, and events to agree about what was preserved or reopened.

### Acceptance Criteria
#### Happy Path
- Given a successful rebase produces explicit preservation and invalidation decisions, when they are applied, then state and verdicts agree with the reported decisions and skipped gates and unrelated fields remain unchanged.
- Given the same completed rebase result is processed again, when application repeats, then it does not duplicate reopening effects, erase newer work, or replace a later failure with an earlier PASS.
#### Negative Paths
- Given persistence stops between required verdict and state writes, when the process resumes, then the incomplete transition cannot permit publication and is reconciled before continuation.
- Given a same-field state conflict or held mutation lease prevents application, when the write is attempted, then the conflicting update is not overwritten and successful transition completion is not reported.
### Done When
- [ ] Shared transition integration asserts the exact changed fields and matching applied-decision events.
- [ ] Repeated-application, interrupted-write, and concurrent-write fixtures preserve newer authority and block partial publication.

## Story 7: Existing integration and recovery policy remains authoritative

As the operator, I want the new post-rebase handling to compose with already-owned integration work.

### Acceptance Criteria
#### Happy Path
- Given normal finish or a re-kick, when entry policy runs, then the existing finish skip conditions and mandatory re-kick play-forward remain unchanged before the shared post-rebase decision is applied.
- Given a document-only advance changes active review inputs, when the delivered input classifier processes it, then only affected review work is requested and document-only change itself does not reopen BUILD or aggregate verification.
#### Negative Paths
- Given rebase remains unresolved or protected evidence checks fail, when continuation is considered, then the existing recovery or halt remains blocking and the new preservation path cannot bypass it.
- Given unrelated documents change or pre-rebase collision recovery is required, when the existing owner handles that case, then the post-rebase feature adds no competing entry decision or collision-recovery action.
### Done When
- [ ] Finish and re-kick integration exercise their existing distinct entry policies and share only completed-rebase handling.
- [ ] Active/unrelated document, unresolved-rebase, protected-evidence, and collision fixtures retain their prerequisite-owned behavior.

## Negative-Category Review

Invalid source data and unavailable dependencies are covered by Stories 2, 3, and 5. Process permission/launch failure and exhaustion are covered by Stories 2 and 4. Concurrent access, partial writes, and idempotency are covered by Story 6. Data integrity and alternate entry/early-return branches are covered by Stories 5 and 7. No new authentication endpoint, deletion/cascade, or third-party integration is introduced; those categories impose no additional scenario here.

## Governing Architecture and Scope

All seven stories implement adr-2026-09-11-selective-post-rebase-verification. They honor the amendments to adr-2026-07-08-post-rebase-gate-first-mechanical-reverify, adr-2026-07-20-post-rebase-delta-aware-invalidation, and adr-2026-07-22-gate-evidence-code-validity-on-redispatch. Existing #2453/#2495 behavior is consumed, not reassigned. No ordinary documentation deliverable is an acceptance criterion.

## Verify-Claims

The operator accepted the seven success/failure boundaries before this artifact was written. Existing suite failure routing, coverage digest-cache/refusal behavior, mutation-port conflict handling, and code-validity readers were read directly. The new behavior is an approved requirement, not a claim that it is already implemented. No pending behavioral assumption remains.
