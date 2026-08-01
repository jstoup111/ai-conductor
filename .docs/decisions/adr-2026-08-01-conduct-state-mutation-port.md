# ADR: Own conduct-state changes through an intent-bearing mutation port

**Date:** 2026-08-01
**Status:** APPROVED
**Deciders:** Operator and architecture review

## Context

`conduct-state.json` is a flat backward-compatible state document with multiple in-process and out-of-process writers. The conductor loads it once and later performs whole-object rewrites. A writer that changes the persisted file after that load can therefore have its update silently erased. The current `pr_url` preservation rule fixes one field but cannot distinguish stale omission from intentional deletion for the general case.

The long-term direction is an authoritative state service whose normal request is a field mutation. This change must create that service boundary without building the hosted service now. The local open-source implementation may remain single-host and filesystem-backed, but it must be correct within that boundary.

Step statuses do not form a universal monotonic ordering: `done` may intentionally become `stale`. Semantic precedence must therefore be explicit per field and cannot be inferred from generic status ranking. The current `feature_status` contract, by contrast, has one terminal value: `complete`.

## Options Considered

### Option A: Intent-bearing mutation port with a serialized local adapter

- **Pros:** makes set/delete/reset intent explicit; preserves unrelated concurrent fields automatically; detects same-field races; maps directly to a future service API; keeps one coherent state snapshot and backward-compatible file.
- **Cons:** requires migration of all state writers; needs a robust single-host lease and atomic file replacement; atomic batches remain necessary for multi-field invariants.

### Option B: Partition fields into writer-owned files

- **Pros:** removes cross-writer contention where ownership is exclusive; individual files are mechanically simple.
- **Cons:** readers can observe incoherent moments across files; reset spans multiple stores; existing readers require migration or a risky derived compatibility copy; a future service migration must collapse storage-aware callers.

### Option C: Versioned compare-and-swap over whole snapshots

- **Pros:** detects every stale whole-object writer and retains one file.
- **Cons:** callers still express more authority than they need; retrying a stale snapshot requires field-level intent anyway; conflict handling and resets remain ambiguous.

## Decision

Introduce an engine-owned `ConductStateStore` port. Clients submit an explicit mutation containing the target field, expected prior value or revision, next value, and intent. The port also supports an atomic batch when multiple fields constitute one invariant. Whole-state replacement is not a normal save operation; it is a separate privileged operation used only for deliberate reset/start-over.

The initial local adapter is filesystem-backed and single-host. It serializes all writers with a bounded cross-process lease, reads the latest snapshot while holding that lease, evaluates the mutation against current state, and persists with an atomic temporary-file replacement. Lock acquisition, stale-owner recovery, and release are deterministic and observable; an unacquired or unrecoverable lease fails closed rather than writing concurrently.

Conflict resolution is exhaustive and field-specific:

1. Expected current value matches: apply the mutation.
2. Current value already equals the requested value: return idempotent success.
3. A registered domain rule proves one value more accurate: keep/persist that value and log the disposition. The initial proven rule is terminal `feature_status: complete`.
4. Otherwise: refuse the same-field conflict and log the field, expected value, current value, requested value, writer/intent, and disposition without exposing secrets.

No generic ordering is assigned to step statuses. Explicit invalidation such as `done` to `stale` is expressed as an authorized mutation with the current expected value, rather than treated as a lower-priority overwrite.

The persisted JSON remains readable through the existing `readState` contract during migration. Production writers may not bypass the port after migration. The hosted service and network protocol are out of scope; a future adapter implements this port and becomes the authoritative mutation owner.

## Consequences

### Positive

- Disjoint concurrent updates cannot clobber one another because clients mutate only owned fields.
- Same-field ambiguity becomes an explicit, logged failure unless the domain proves a winner.
- Reset and deletion are distinguishable from omission.
- The future hosted state authority can replace the local adapter without rewriting clients.
- Atomic batches preserve the few multi-field invariants without returning to whole-object authority.

### Negative

- All production writers must be inventoried and migrated; leaving one direct write bypasses correctness.
- The local adapter needs lease recovery, time bounds, atomic replacement, and failure-path tests.
- Callers must handle typed conflict and lease failures rather than assuming saves cannot conflict.
- The open-source adapter is intentionally limited to one host/shared filesystem boundary; multi-host authority requires the future service.

### Follow-up Actions

- [ ] Define typed single-field mutation, atomic batch, replace/reset, success, conflict, and lease-failure results.
- [ ] Implement the filesystem adapter with bounded cross-process serialization and atomic replacement.
- [ ] Migrate every production state writer and add a deterministic bypass audit.
- [ ] Pin disjoint-writer, same-field conflict, semantic precedence, explicit invalidation, reset, corrupt-file, lease-recovery, and atomicity behavior with isolated tests.
- [ ] Update the canonical conductor state/operations documentation and remove the `pr_url`-only interim rule.
