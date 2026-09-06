**Status:** Accepted

# Stories: Report the PRD-input gate surface accurately in rebase events (#2211)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the preserved and invalidated gate-decision event payloads emitted after a file-changing rebase. Gate preserve/invalidate decisions, event field names, and the delta the engine feeds the classifier are unchanged.

## Story 1: A PRD-input gate explains its own preservation and invalidation

As an operator reading rebase telemetry, I want a gate whose surface combines the feature's own runtime source with declared stories and PRD inputs to report that surface and the delta that was weighed against it, so that a preserved verdict is explained by the reason it was actually preserved.

### Acceptance Criteria

#### Happy Path

- Given a delta that touches only foreign runtime source while the feature owns other runtime source, when the preserved events are emitted, then each PRD-input gate's declared surface names the feature's own runtime paths together with a single declaration of the stories and PRD document inputs, and never the broad all-runtime declaration.
- Given that same foreign-only delta, when the preserved events are emitted, then each PRD-input gate's considered delta is empty.
- Given a delta that changes a declared stories or PRD document input, when the invalidated events are emitted, then that PRD-input gate's matched paths are exactly the changed document inputs and the feature's own changed runtime paths.

#### Negative Paths

- Given a delta carrying a foreign runtime path and a document path outside the declared stories and PRD input prefixes, when the preserved events are emitted, then neither path appears in a PRD-input gate's considered delta.

### Done When

- [ ] A foreign-only runtime fixture emits both PRD-input gates preserved with a declared surface containing the feature's own runtime paths and the document-input declaration, and without the broad all-runtime declaration.
- [ ] That same fixture emits an empty considered delta for both PRD-input gates, including for a document path outside the declared input prefixes.
- [ ] A declared-document-input fixture emits the PRD-input gates invalidated with matched paths limited to the changed document inputs and the feature's own changed runtime paths.

## Story 2: Every gate-surface kind keeps its payload bound to its classification

As a maintainer adding a future gate surface kind, I want the payload projection and the preserve/invalidate decision to be one computation, so that a new kind cannot silently borrow an unrelated kind's explanation.

### Acceptance Criteria

#### Happy Path

- Given the gate surface map assigns a kind to each judged gate, when payloads are projected, then every kind the map uses has its own declared surface and matched paths rather than a shared fallback.
- Given a test-suite verdict preserved within its drift budget, when its preserved event is emitted, then the event still carries the drift-budget basis and stays distinguishable from an ordinary delta-based preservation.

#### Negative Paths

- Given a delta matrix covering feature runtime, foreign runtime, feature test, document input, and empty deltas, when gates are classified and their payloads projected, then every preserved gate reports an empty considered delta, every invalidated gate reports non-empty matched paths, and each gate's preserve or invalidate decision is the one the classifier produced before this change.
- Given a rebase outcome whose feature surface is uncomputable, when the emitter runs, then it still emits only the pre-verified preservation with its uncomputable declaration and invents no classification-derived payload.

### Done When

- [ ] A projection test proves the projection's kind set is exactly the kind set the gate surface map uses, with no fallback branch serving an unnamed kind.
- [ ] Across the delta matrix, every preserved gate event carries an empty considered delta and every invalidated gate event carries non-empty matched paths.
- [ ] The existing classification expectations for the delta matrix pass unchanged, the drift-budget preserved event still carries its basis, and the uncomputable-surface path still emits only the pre-verified preservation.

## Negative-category review

Invalid and out-of-scope input is covered by the document path outside the declared prefixes and by the empty delta in the matrix. Data integrity is covered by the requirement that a payload agree with its own classification for every kind and that prior decisions are unchanged. Dependency unavailability is covered by the uncomputable feature surface, which is the emitter's only degraded input; partial failure is covered by the drift-budget preservation retaining its distinct basis alongside ordinary preservation. The change is pure in-process path arithmetic over values already computed: it opens no file, no socket, no queue, no datastore, and no transaction, so timeout, permission, concurrency, resource-exhaustion, cascade-deletion, and idempotency categories are inapplicable. Existing rebase-outcome and gate-verdict tests remain authoritative for the surrounding kickback behavior.
