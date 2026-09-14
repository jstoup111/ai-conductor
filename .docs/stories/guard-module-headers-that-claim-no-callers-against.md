**Status:** Accepted

# Stories: Guard module headers that claim no callers (#1646)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the structural guard that resolves leading-comment-block no-caller claims against the import graph, and the engine headers that guard rejects today. Wording style, dead-code detection, and claims made below a module's leading comment block remain outside this slice.

## Story 1: Reject a header claim the import graph contradicts

### Acceptance Criteria

#### Happy Path

- Given a module's leading comment block claims nothing imports it and another module in the scanned tree imports it, when the guard runs, then it fails and names the claiming file, the claim line, and every importing module.
- Given a leading comment block claims nothing calls a backticked export and another module in the scanned tree references that identifier, when the guard runs, then it fails and names the claiming file, the identifier, and every referencing module.

#### Negative Paths

- Given a module's leading comment block claims nothing imports it and no other module in the scanned tree imports it, when the guard runs, then it reports no violation for that module.
- Given the same no-caller wording appears below a module's leading comment block, when the guard runs, then it reports no violation for that module.

### Done When

- [ ] Known-bad fixtures for a module-level claim and a symbol-level claim each produce exactly one violation naming the real consumers.
- [ ] A known-good fixture whose no-caller claim is true produces no violation.
- [ ] A fixture whose matching phrase sits below the leading comment block produces no violation.

## Story 2: Engine headers say where their exports are consumed

### Acceptance Criteria

#### Happy Path

- Given the engine source tree as committed, when the guard runs over it, then it reports zero unsupported no-caller claims.
- Given the four engine modules whose headers assert they are inert or uncalled, when a reader opens each header, then it names the modules that consume its exports instead of claiming there are none.

#### Negative Paths

- Given a header is later edited to re-assert a claim the import graph contradicts, when the aggregate test suite runs, then the guard fails and names that header rather than passing silently.

### Done When

- [ ] The armed guard reports zero violations across the engine tree, and it reported the four known stale headers before they were corrected.
- [ ] Each corrected header names at least one module that consumes its exports.
- [ ] The contributor testing page lists the new guard alongside the existing structural meta-tests.

## Negative-category review

Input integrity is covered by the truthful-claim and below-the-header fixtures, which are the two ways a naive phrase lint would produce a false positive. Absence is covered by a scanned file with no leading comment block and by a claim whose backticked identifier appears nowhere else. Idempotency is inherent: the guard only reads files and derives its verdict from their bytes, so repeated runs on unchanged input give the same result. Permission, network, dependency, deletion, queue, datastore, upload, and transaction categories are inapplicable — the guard performs no writes, spawns no process, and contacts no service. Performance is bounded by a single pass over the engine tree, which the existing structural guards already demonstrate is cheap enough for the ordinary suite.
