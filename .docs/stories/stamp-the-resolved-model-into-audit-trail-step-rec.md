**Status:** Accepted

# Stories: Stamp the resolved model into audit-trail step records (#640)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is attribution only: the audit-trail record for a completed step dispatch names the model that produced it and the provider that ran it. Nothing reads the stamp, no gate consumes it, and model selection is unchanged. The issue's optional commit-trailer extension remains outside this slice.

## Story 1: Attribute every completed dispatch to the model that produced it

### Acceptance Criteria

#### Happy Path

- Given a completed-step event carries a resolved model and no gate verdict has been recorded for that step, when the audit writer handles it, then it appends one positive-evidence pass record carrying that model.
- Given a completed-step event carries a resolved model for a step whose gate verdict was already recorded, when the audit writer handles it, then it appends one attribution record carrying that model instead of a duplicate pass record.

#### Negative Paths

- Given a completed-step event carries no model for a step whose gate verdict was already recorded, when the audit writer handles it, then it appends no record at all.
- Given a completed-step event carries no model and no gate verdict has been recorded for that step, when the audit writer handles it, then it appends the existing pass record with no model key present.

### Done When

- [ ] A writer fixture proves a resolved model reaches the appended record on both the first-pass and already-verdicted paths.
- [ ] A writer fixture proves the already-verdicted path with no model still appends nothing.
- [ ] A writer fixture proves the model key is absent, not empty or null, when the source event carries no model.

## Story 2: Qualify the recorded model with the provider that ran it

### Acceptance Criteria

#### Happy Path

- Given a completed-step event carries a resolved model and the provider that produced the result, when the audit writer handles it, then the appended record carries that provider alongside the model.

#### Negative Paths

- Given a completed-step event carries a resolved model but no provider that produced the result, when the audit writer handles it, then the appended record carries the model with no provider key present.

### Done When

- [ ] A writer fixture proves the producing provider is recorded verbatim beside the model.
- [ ] A writer fixture proves the provider key is absent when the source event names no producing provider.
- [ ] The audit-trail reference page documents both new optional fields and the attribution record the writer can now emit.

## Negative-category review

Input-integrity coverage is the absent-model and absent-provider cases, which are the only two shapes the source event can take for these fields; both prove key absence rather than a placeholder value, so a later reader can distinguish "unrecorded" from "recorded as empty". Idempotency is unchanged: the writer appends one line per handled event and holds no state beyond the existing per-step verdict set, and the already-verdicted case is exactly the duplicate-suppression path under test. Permission, network, dependency, deletion, queue, datastore, upload, and transaction categories are inapplicable: the change adds no I/O beyond the existing single append, contacts nothing, and removes nothing. Write-failure handling is already owned by the writer's existing marker-and-stderr path and is unaffected by two additional optional fields on the serialized record.
