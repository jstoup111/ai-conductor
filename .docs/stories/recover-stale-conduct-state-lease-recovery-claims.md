**Status:** Accepted

# Stories: Recover stale conduct-state lease recovery claims

Source: jstoup111/ai-conductor#2170
Track: technical
Complexity: M
Governing architecture: `adr-2026-09-11-immutable-state-lease-recovery-succession` decisions 1–6, preserving `adr-2026-08-01-conduct-state-mutation-port` and `adr-2026-08-12-fail-closed-intake-ledger-durability`.

Scope boundary: Repair shared state-lease recovery, including malformed metadata, uncertain liveness, and concurrent/replacement races. Exclude the separate full-suite lock and replacement of locking technology.

## Story 1: Resume after a recoverer dies

**Requirement:** Intake desired outcome 1; ADR decisions 1–4.

A state-store caller can acquire a lease after its owner and interrupted recoverers die, without manual removal of ownership state.

### Acceptance Criteria

#### Happy Path
- Given a dead lease owner and a valid recovery claim left by a dead process using the previous claim format, when another process acquires the lease, then acquisition succeeds without operator intervention and the acquired handle can release successfully.
- Given a dead lease owner and several valid interrupted recovery attempts whose processes are all dead, when a caller acquires within its wait budget, then acquisition succeeds and subsequent release allows another caller to acquire.

#### Negative Paths
- Given a live lease owner and a dead recovery claimant, when another caller attempts acquisition, then it does not gain ownership or alter the live owner's protected state and returns a bounded failure if the owner remains live.
- Given a dead lease owner but a live recovery claimant, including one using the previous claim format, when a second caller attempts recovery, then it leaves that claimant's authority intact and returns a bounded failure while that claimant remains live.

### Done When
- [ ] Acquisition and release return successful handles for isolated legacy and repeated-interruption fixtures.
- [ ] Live-owner and live-recoverer fixtures produce no second ownership handle and no protected-state write.

## Story 2: Refuse recovery when authority is uncertain

**Requirement:** Confirmed edge-case scope; ADR decisions 2, 3, and 5.

A caller receives a specific failure when recovery ownership cannot be established safely.

### Acceptance Criteria

#### Happy Path
- Given valid owner and recovery identities and successful probes proving both processes dead, when recovery is attempted, then the caller can acquire and release the lease.
- Given a supported valid legacy claim without new-format owner binding, when its claimant and the current owner are both proved dead, then recovery remains available without a metadata migration.

#### Negative Paths
- Given malformed, truncated, unsupported, or identity-inconsistent recovery metadata at any recovery stage, when a caller attempts acquisition, then recovery is refused with a message identifying invalid recovery metadata and the protected state is unchanged.
- Given recovery metadata that revisits a prior recovery identity, when acquisition evaluates it, then it refuses the invalid recovery state within the original wait budget rather than looping or granting ownership.
- Given a process probe that cannot establish a claimant's death, when acquisition attempts recovery, then it does not steal ownership; its failure identifies the blocking claimant or unverifiable liveness without asserting that an unverified process is live.
- Given an unreadable claim or a claim-creation permission/storage failure, when recovery encounters that error, then acquisition returns a failure naming the failed recovery operation and performs no protected-state mutation or cleanup of a replacement lease.

### Done When
- [ ] Refusal results distinguish invalid metadata, unverifiable liveness, and failed filesystem operations using the configured store label.
- [ ] The corresponding fixtures observe no successful ownership handle, no protected-state persistence, and no removal of unrelated or replacement ownership.

## Story 3: Preserve one owner through competing recovery and replacement

**Requirement:** Intake desired outcome 3; confirmed race scope; ADR decisions 1–4 and 6.

Concurrent recovery preserves exclusive ownership, including when an old observer resumes after the lease has changed owners.

### Acceptance Criteria

#### Happy Path
- Given two contenders observing the same dead owner and dead recoverer, when they attempt recovery concurrently, then at most one obtains a lease handle at a time, and after the winner releases the other can acquire within its remaining budget.
- Given a current owner and a valid leftover recovery record explicitly belonging to a previous owner, when the current owner releases, then release succeeds and a subsequent caller can acquire.

#### Negative Paths
- Given a contender paused after observing an old generation but before recording its recovery attempt, and a replacement owner that acquires meanwhile, when the paused contender resumes, then it neither releases nor quarantines the replacement lease and cannot prevent the replacement owner from releasing through the valid prior-generation record it creates.
- Given a live elected recoverer paused before quarantine, when another contender attempts recovery, then the second contender cannot replace its recovery authority or obtain a simultaneous lease handle.
- Given an acquisition attempt whose owner or claim identity changes before authority is confirmed, when that attempt resumes, then it abandons the stale attempt and retries only within its original budget without modifying the replacement owner's state.
- Given a current owner with an unbound legacy recovery record whose authority cannot safely be dismissed, when release is requested, then release refuses with a recovery diagnostic rather than deleting the lease as if the record belonged to another generation.

### Done When
- [ ] Deterministic interleaving fixtures record a maximum of one active ownership handle across competing acquire/release operations.
- [ ] Replacement-owner bytes remain intact and that owner remains able to release after a delayed prior-generation claimant resumes.

## Story 4: Bound recovery and describe the actual blocker

**Requirement:** Intake desired outcome 2; ADR decisions 5–6.

A caller receives a bounded and accurate acquisition result across changing recovery states.

### Acceptance Criteria

#### Happy Path
- Given the observed lease or recovery path disappears before the caller mutates it, when acquisition retries and the lease remains available, then the caller acquires within the original wait budget.
- Given the blocker changes from an owner to a recovery claimant during one acquisition attempt, when the budget expires, then the timeout identifies the most recently observed blocking state and retains the configured store label.

#### Negative Paths
- Given a dead owner and a live recovery claimant that outlasts the budget, when acquisition times out, then the result identifies recovery contention and never says the already-dead owner is live.
- Given a recovery history or repeated generation changes that consume the acquisition budget, when the budget expires, then the call terminates with a timeout identifying the last observed recovery state instead of restarting its deadline or traversing indefinitely.
- Given acquisition waiting is interrupted, when the interruption occurs, then it returns an interrupted result and no ownership handle or protected-state write.
- Given quarantine, identity confirmation after quarantine, or quarantine cleanup fails, when acquisition receives the failure, then it returns a recovery failure identifying the failed operation and does not report successful acquisition or remove a replacement lease.

### Done When
- [ ] Injected-clock fixtures show one deadline spanning traversal, contention, vanished paths, and generation changes.
- [ ] Returned result kinds and labelled messages identify the observed terminal failure, with no stale dead-owner-as-live diagnosis.

## Story 5: Apply recovered ownership at a persistent-store boundary

**Requirement:** Intake impact and desired outcome 1; existing mutation-port architecture.

An existing persistent-store caller benefits from the repaired lease without changing its public mutation API.

### Acceptance Criteria

#### Happy Path
- Given an existing filesystem-backed state store with known persisted fields and a recoverable dead claim, when a caller applies a valid field mutation through that store's normal API, then the mutation succeeds, the changed field persists, unrelated fields remain intact, and the lease is released for a later mutation.

#### Negative Paths
- Given the same store with a live recovery claimant or ambiguous claim metadata, when a caller applies the mutation, then it receives the lease failure and no persistence write occurs.
- Given two store callers attempting valid disjoint mutations after interrupted recovery, when their operations contend, then both committed field changes survive and the stores never execute their protected persistence operations concurrently.

### Done When
- [ ] A real store-entry-point integration observes the requested persisted field value and unchanged unrelated fields after recovered acquisition.
- [ ] Refusal fixtures observe zero persistence writes, and a contention fixture observes both final field values with maximum protected-write concurrency of one.

## Negative-category review

Invalid input: malformed/unsupported/identity-inconsistent records (Story 2). Permission and resource failures: unreadable or unwritable recovery state (Story 2). Timeout and interruption: Story 4. Concurrent access and partial failure: Stories 1, 3, and 4. Data integrity and side effects on alternate branches: Stories 3 and 5. Immutable authority and identity collision/replacement concerns: Story 3. Dependency unavailability: liveness/filesystem failures in Story 2. Error distinctions: Story 4 separates interruption, timeout, invalid authority, and filesystem failures.

No network/authentication interface, business-entity deletion, foreign-key cascade, or new deduplication API is introduced; those categories do not apply. Store cleanup is covered as ownership-sensitive filesystem behavior, not business-data deletion.

## Verify-claims ledger

Verified: the existing shared lease and persistent-store entry points and their injection seams, from the source and existing test fixtures named in the approved architecture review. Expected behavior comes from the approved ADR and operator-confirmed scope. No additional product policy, platform support, or recovery-by-age assumption is introduced. Runtime proof remains BUILD work.

Verdict: CLEAR. The operator accepted these five stories in composer on 2026-09-11.
