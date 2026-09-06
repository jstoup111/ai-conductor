**Status:** Accepted

# Stories: Provider-free step completions are not dispatches (#1906)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the shared dispatch-metering projection and the two readers that consume it: the committed per-feature cost rollup and the exported OTel dispatch counter. Emitter payload changes, KPI aggregate policy, and the partial-feature exclusion rule remain outside this slice.

## Story 1: A step that invoked no provider leaves the dispatch ledger untouched

As an operator reading a feature's cost record, I want the dispatch and unmetered counts to describe only real provider calls so that a fully measured feature is not presented as partially unmetered.

### Acceptance Criteria

#### Happy Path

- Given a retained event ledger carrying fourteen invoked provider attempts that all report usage and nine step completions that carry no provider attribution, when the per-feature cost rollup is computed, then it reports fourteen dispatches, fourteen metered dispatches, zero unmetered dispatches, and the same token and cost totals as its fourteen attempts.
- Given a successful invoked provider attempt reporting usage followed by the completion of the same step by the same provider, when the rollup is computed, then that step contributes exactly one dispatch carrying that usage once.

#### Negative Paths

- Given a step completion that has no matching provider attempt and carries no token usage, no actual provider, no preferred provider, and no model, when the rollup is computed, then it increases neither the dispatch count nor the unmetered-dispatch count, whether or not it is marked unmetered.
- Given a provider attempt recorded as invoked whose usage is absent or unusable, when the rollup is computed, then it still contributes one dispatch and that dispatch is still counted as unmetered.
- Given a step completion with no matching provider attempt that carries provider or model attribution but no token usage, when the rollup is computed, then it still contributes one unmetered dispatch.

### Done When

- [ ] A fixture ledger shaped like the retained nine-completion case yields fourteen dispatches, fourteen metered and zero unmetered, with token and cost sums equal to its attempts.
- [ ] A fixture of attribution-free completions alone yields zero dispatches and zero unmetered dispatches.
- [ ] A fixture of attribution-bearing completions with no attempts keeps one unmetered dispatch for each completion.
- [ ] An invoked attempt with unusable usage still yields one dispatch counted as unmetered.

## Story 2: Exported dispatch counters agree with the committed rollup

As an operator comparing a dashboard against a shipped record, I want the exported dispatch counter to select the same dispatches the committed rollup selects so that the two surfaces cannot disagree about how many provider calls a feature made.

### Acceptance Criteria

#### Happy Path

- Given one event sequence containing invoked provider attempts, matching completions, and provider-free completions, when that sequence is exported through the observability visualizer and rolled up from the same persisted ledger, then the exported dispatch-counter total equals the rollup's dispatch count.

#### Negative Paths

- Given a step closes with no provider attempt and no provider attribution on its completion, when the visualizer records that step close, then it records the step's duration and records no dispatch data point for that step.

### Done When

- [ ] An in-memory export over one mixed fixture reports a dispatch-counter total equal to the rollup's dispatch count for the same events.
- [ ] A provider-free step close produces a duration data point and no dispatch data point for that step.

## Negative-category review

Invalid and incomplete input is covered by the attribution-free completion, the attribution-bearing completion with no usage, and the invoked attempt with unusable usage — the three shapes the projection must tell apart. Partial-failure and degraded-mode behavior is covered by the invoked-attempt-without-usage criterion, which keeps a genuinely unmeasured provider call visible rather than silently dropping it. Backward compatibility with ledgers written before provider-attempt metering existed is covered by the attribution-bearing legacy criterion. Data integrity across surfaces is covered by Story 2's equality criterion between the exported counter and the committed rollup. The projection is a pure in-memory selection over an already-persisted append-only ledger, so auth, permission, timeout, network, concurrency, resource-exhaustion, deletion-cascade, and rollback categories are inapplicable; no datastore, queue, upload, transaction, or external call is introduced or changed.
