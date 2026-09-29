**Status:** Accepted

# Stories: Clear kickback raise halts without a halt record (#2752)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). Scope is the committed-record step of the kickback-budget halt clear. Authorization selection (#2595) and halt-record recordability remain outside this slice.

## Story 1: A consumed raise clears a halt that has no committed record

### Acceptance Criteria

#### Happy Path

- Given a halted feature worktree whose branch has no committed halt record, when a consumed kickback-budget raise clears its halt, then the clear reports confirmed and the halt marker is removed.

#### Negative Paths

- Given a feature worktree whose branch has no committed halt record, when the committed-record step of the clear runs, then it reports noop, no halt record file is created, and no commit is added to the branch.

### Done When

- [ ] A real-repository fixture with no halt record shows the clear confirmed and the marker-removal dependency invoked.
- [ ] The same fixture shows no halt record file and an unchanged commit count after the clear.

## Story 2: Existing records are still resolved and genuine failures still keep the halt

### Acceptance Criteria

#### Happy Path

- Given a feature worktree whose committed halt record is in halted state, when a consumed kickback-budget raise clears its halt, then the record is rewritten to resolved with resolution cause kickback-budget in exactly one new commit and the clear reports confirmed.

#### Negative Paths

- Given the halt record path exists but cannot be read as a file, when a consumed kickback-budget raise clears its halt, then the committed-record step reports failed, the clear reports partial, the halt marker is not removed, and the logged retention line names the failure reason.

### Done When

- [ ] A real-repository fixture with a halted record shows it resolved with cause kickback-budget in one commit and the clear confirmed.
- [ ] A real-repository fixture whose record path is a directory shows failed, partial, no marker removal, and a log line containing the read error.

## Negative-category review

Absent record (Story 1) and unreadable record (Story 2) cover input integrity and missing-state handling; the distinction between them is the core of the fix. Repeated supersession of an already-resolved record keeps its existing `noop` idempotency coverage. Git commit failures on an existing record keep their existing `failed` result and remain retained by the clear; push failures keep returning `pushFailed`, which the clear already does not treat as blocking. No new failure mode is introduced there. Authorization mismatch, park, and processed checks belong to `consumeResumeAuthorizations` and are unchanged. No deletion, queue, datastore, upload, permission, or concurrency surface is added; those categories are inapplicable.
