# Conflict Check: Provider Preparation Lifecycle Supervision

**Date:** 2026-07-30
**Stories scanned:** 270 files
**Specs scanned:** 42 files
**Prior conflict reports reviewed:** 143 files
**Result:** PASS — zero blocking conflicts, zero degrading conflicts

## Interaction Review

| New behavior | Existing contract checked | Verdict |
|---|---|---|
| Unsupported lifecycle capability fails before invocation | `first-class-codex-harness-parity-904`, ST-904-12 | Compatible: both require provider, missing capability, and recovery action with no false success |
| Provider fallback remains inside one lifecycle attempt | `per-step-provider-routing-927`, ST-927-7 | Compatible: fallback still receives isolated provider-native session state and attribution |
| Exhausted lifecycle recovery writes `needs-human` | `main-advance-re-kick-sweep-wipes-needs-human-decid` | Compatible: needs-human survives sweeps; mechanical and legacy behavior remains unchanged |
| One recovery replacement is distinct from provider/model retry | Existing retry, model-availability, auth-park, and rate-limit stories | Compatible: the new stories explicitly preserve those budgets and precedence |
| Activity heartbeat loses termination authority after spawn | No accepted story requires output silence to kill a running provider | No story contradiction; current runtime/docs behavior is intentionally superseded by the approved ADR |
| Lifecycle state is feature-local and observational | Existing evidence, completion, and worktree-isolation stories | Compatible: no lifecycle record is allowed to prove step completion |

## Five-Type Scan

- **Contradiction:** none. No accepted story requires a spawned provider to be terminated from
  stdout/stderr silence.
- **Behavioral overlap:** compatible. Provider fallback, fresh sessions, diagnostics, and HALT
  classification retain their existing outcomes.
- **State conflict:** none. The discriminated lifecycle state prevents simultaneous preparing and
  running authority; fallback candidates remain children of one lifecycle attempt.
- **Resource contention:** none. Evidence is scoped to the existing feature worktree; no shared
  port, database, queue, or global mutable file is introduced.
- **Sequencing conflict:** none. Permit revocation precedes replacement, and permit validation
  precedes spawn; clean settlement resets the episode only after the authoritative attempt returns.

## Resolution

No story edits, compromises, or superseding ADRs are required.
