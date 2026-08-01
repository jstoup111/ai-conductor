**Status:** Accepted

# Technical Stories: conduct-state mutation ownership

## Story TS-1: Preserve independent concurrent updates

**Requirement:** Technical intent — field-level mutation ownership

As a conductor state client, I want to submit only the field changes I own so that a concurrent update to another field cannot be silently erased.

### Acceptance Criteria

#### Happy Path

- Given two clients read the same initial state, when client A commits a mutation to field A and client B later commits its stale-snapshot mutation to field B, then the final state contains both changes.
- Given a logical transition changes multiple fields that form one invariant, when the client submits an atomic mutation batch, then readers observe either the complete prior invariant or the complete new invariant.

#### Negative Paths

- Given client B's expected value for field B no longer matches current state, when its mutation is evaluated, then the adapter does not overwrite field B merely because client A changed a different field.
- Given one operation in an atomic batch conflicts, when the batch is evaluated, then none of its operations persist and the prior state remains byte-valid and logically unchanged.

### Done When

- [ ] A deterministic two-client race proves disjoint mutations survive in both commit orders.
- [ ] A deterministic batch test proves all-or-nothing persistence for a named multi-field invariant.
- [ ] The ordinary client contract grants no authority to replace fields omitted from its mutation.

## Story TS-2: Resolve only domain-provable same-field conflicts

**Requirement:** Technical intent — accurate conflict resolution

As an operator, I want same-field races resolved only when the domain proves which value is more accurate so that concurrency cannot silently regress control-flow state.

### Acceptance Criteria

#### Happy Path

- Given a mutation requests the value already persisted, when the adapter evaluates it, then it returns idempotent success without treating the operation as a conflict.
- Given persisted `feature_status` is `complete`, when a stale writer attempts to remove or regress that terminal value through an ordinary mutation, then `complete` survives and the semantic-resolution disposition is recorded.
- Given an explicit step invalidation expects the current `done` value, when it changes that step to `stale`, then the mutation succeeds because step statuses have no generic terminal precedence.

#### Negative Paths

- Given expected, current, and requested values differ for a field with no registered precedence rule, when the mutation is evaluated, then it fails closed without changing any field and identifies the conflicting field.
- Given a caller assumes `done` always wins, when it races an authorized `done` to `stale` invalidation, then no generic ranking silently restores `done`; the expected-value contract determines whether the operation applies or conflicts.
- Given conflict diagnostics are emitted, when state values may contain sensitive or unbounded text, then logs contain the field, writer/intent, and disposition with safe value summaries rather than leaking raw secrets.

### Done When

- [ ] Conflict outcomes are typed and exhaustively handled by production clients.
- [ ] The semantic-policy registry contains the proven `feature_status: complete` rule and no catch-all status ordering.
- [ ] Tests pin idempotency, terminal completion, explicit invalidation, unresolved conflict, and redacted diagnostics.

## Story TS-3: Serialize local writers and persist atomically

**Requirement:** Technical intent — correct single-host filesystem adapter

As a local harness operator, I want state mutations serialized across processes and written atomically so that process overlap or failure cannot corrupt state.

### Acceptance Criteria

#### Happy Path

- Given two local processes target the same state file, when they mutate concurrently, then exactly one holds the lease at a time and the second evaluates against the first process's persisted result.
- Given a valid mutation is accepted, when persistence completes, then `conduct-state.json` is valid backward-compatible JSON with the complete committed snapshot.
- Given a lease owner is deterministically proven dead or stale under the approved recovery rule, when another writer recovers the lease, then recovery is logged and exactly one writer proceeds.

#### Negative Paths

- Given another live owner holds the lease beyond the bounded acquisition interval, when a writer cannot prove recovery is safe, then it fails closed with a typed lease error and does not touch state.
- Given the process fails during temporary-file creation, file sync, or atomic replacement, when persistence aborts, then the prior state remains valid and no success result is returned.
- Given lease metadata is corrupt or ownership is ambiguous, when recovery is attempted, then the adapter refuses to steal the lease and reports actionable diagnostics.
- Given two distinct worktrees run concurrently, when each uses its own `.pipeline` state path, then their leases and state mutations do not contend or cross-write.

### Done When

- [ ] Deterministic multi-process or faithfully isolated process-boundary tests prove serialization without real daemons or third-party calls.
- [ ] Failure-injection tests prove prior-file validity across every persistence boundary.
- [ ] Lease acquisition, bounded wait, conservative recovery, release, and diagnostic contracts are independently verified.

## Story TS-4: Preserve compatibility while making reset explicit

**Requirement:** Technical intent — intentional deletion and reset

As a harness operator, I want reset/start-over to remain able to clear state while ordinary mutations cannot erase omitted fields.

### Acceptance Criteria

#### Happy Path

- Given an existing flat `conduct-state.json`, when it is read through the new store, then all existing fields and migration behavior remain available to current readers.
- Given `--reset` or confirmed interactive start-over invokes the privileged replace operation, when it completes, then the intended state is cleared exactly as before.
- Given an ordinary mutation omits a field, when it commits, then omission has no deletion semantics and the field remains unchanged.

#### Negative Paths

- Given an ordinary client attempts whole-state replacement or deletion without explicit intent, when the request reaches the port, then the contract rejects it and state remains unchanged.
- Given the existing JSON is corrupt or empty, when a mutation or reset attempts to read it, then the operation fails closed and leaves the original bytes untouched.
- Given reset cannot acquire the state lease or atomic replacement fails, when reset returns, then it reports failure rather than claiming state was cleared.

### Done When

- [ ] Backward-compatibility tests load representative existing state documents unchanged.
- [ ] Reset and start-over acceptance tests prove explicit clearing, including `pr_url` and terminal completion.
- [ ] The interim `allowPrUrlClear`/sticky-field exception is removed only after equivalent general behavior is pinned.

## Story TS-5: Route every production writer through one authority

**Requirement:** Technical intent — complete wiring and future service adapter seam

As a maintainer, I want every production state mutation routed through the store port so that no bypass can reintroduce lost updates and a future service adapter can replace local storage centrally.

### Acceptance Criteria

#### Happy Path

- Given conductor transitions, finish-record, daemon/recovery commands, and state helpers mutate state, when their production paths run, then each reaches the configured `ConductStateStore` and no caller writes the JSON file directly.
- Given local/open-source execution starts without a hosted service, when production composition resolves the store, then it uses the persistent filesystem adapter rather than an in-memory implementation.
- Given a replacement adapter implements the port, when it is injected at the composition boundary, then state clients submit the same mutation commands without filesystem knowledge.

#### Negative Paths

- Given a new or existing production module directly imports file-writing primitives for `conduct-state.json` outside the filesystem adapter, when the deterministic bypass audit runs, then validation fails and identifies the bypass.
- Given a store returns a typed conflict, lease failure, corruption error, or persistence error, when a production client receives it, then the failure is propagated or explicitly handled and is not swallowed as success.
- Given tests execute state flows, when third-party and daemon boundaries are exercised, then they use faithful fakes or isolated temporary paths and never launch a real daemon, call a real provider, or mutate operator state.

### Done When

- [ ] Every current production `writeState` caller is inventoried and migrated or proven read-only.
- [ ] A deterministic structural audit permits raw state-file persistence only inside the filesystem adapter.
- [ ] Production dependency injection defaults to the persistent local adapter and supports replacement by a future hosted adapter.
- [ ] Canonical user-facing state/operations documentation describes the local single-host boundary, conflict behavior, and explicit reset contract.
