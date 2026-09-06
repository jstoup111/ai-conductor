**Status:** Accepted

# Stories: Stamp released harness version on OTel trace resource (#2235)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is one released-harness-version attribute on the trace Resource, its resolution at the two supported OTel start boundaries, and an unchanged metric Resource identity. Publish-time sidecar capture, dist backfill, backend configuration, and dashboards remain outside this slice.

## Story 1: Traces carry the released harness version beside the engine dist id

As an operator reading telemetry, I want every exported trace to name the harness release it ran on, so that runs from several engine builds of one release aggregate under one label.

### Acceptance Criteria

#### Happy Path

- Given a trace resource context supplies a resolved released harness version, when the trace resource is built, then it carries `service.version` set to that value alongside the existing `conductor.engine.version` dist id.
- Given two runs execute on different engine dist ids built from one harness release, when their `conductor.run` spans are exported, then both span resources carry the same `service.version` value, so a backend groups them under one release label.

#### Negative Paths

- Given the trace resource context omits the released-harness-version property entirely, when the trace resource is built, then `service.version` is `not-supplied` and building does not throw.
- Given the trace resource context supplies the released-harness-version property as undefined or empty, when the trace resource is built, then `service.version` is `unresolved` and building does not throw.

### Done When

- [ ] A trace-scope case asserts `service.version` holds the supplied release value while `conductor.engine.version` keeps its supplied dist id.
- [ ] Two trace resources sharing one release value but different dist ids expose an identical `service.version`.
- [ ] Omitted and unresolved release inputs expose `not-supplied` and `unresolved` respectively, and neither build throws.
- [ ] An exported `conductor.run` span resource carries the release value supplied to the supported start context.

## Story 2: Both supported start boundaries report the running engine's release

As an operator, I want interactive runs and daemon-dispatched features to report the same release identity the CLI prints, so that no run is silently unlabelled and no second version probe can drift from the first.

### Acceptance Criteria

#### Happy Path

- Given an interactive run starts its visualizers, when the OTel start context is created, then it carries the released harness version resolved from the running engine module directory.
- Given the daemon dispatches a feature, when that feature's span is exported, then the span resource carries the released harness version resolved from the running daemon module directory.

#### Negative Paths

- Given no candidate `VERSION` source for the running module holds a semver-shaped value, when a run exports a trace, then `service.version` is the explicit `0.0.0` unknown marker rather than an absent attribute, and the run still reaches its terminal export.

### Done When

- [ ] A daemon dispatch exports span resources whose `service.version` matches each of two injected release values, and the resolver receives the daemon module directory.
- [ ] The interactive start-context builder returns the release value it was given, and a compile-time fixture rejects a supported start context that omits the property.
- [ ] An unresolvable version source exports `service.version` as `0.0.0` and the dispatch still produces its terminal export.

## Story 3: Metric identity and backend series count are unchanged

As an operator, I want the metric Resource to stay exactly as it is, so that adding a release label to traces mints no new `target_info` series.

### Acceptance Criteria

#### Happy Path

- Given a resource context supplies a released harness version, when the metric resource is built, then its attribute set is exactly the five feature-stable attributes and contains no `service.version`.

#### Negative Paths

- Given two metric resources are built for one feature under different released harness versions, when their attribute sets are compared, then the sets are identical, so `target_info` gains no series.

### Done When

- [ ] The metric-scope exact-key assertion supplies a release value and still lists exactly the five feature-stable keys.
- [ ] Metric resources built under two different release values compare equal.

## Negative-category review

Invalid and absent input is covered three ways: an omitted property, an explicitly unresolved property, and an unreadable or non-semver version source. Dependency unavailability reduces to that same unreadable-source case, because the only dependency is a file read that the existing resolver already swallows into the `0.0.0` marker; the assertions require the run to continue rather than degrade silently to a missing attribute. Data integrity is covered by the metric exact-key and cross-version equality assertions, which are the guard against uncontrolled backend series growth. Resource construction stays synchronous and total and the resolver never rejects, so timeout, partial-failure, and rollback categories reduce to the never-throw and still-exports assertions above. No authentication surface, concurrent mutable state, deletion, cascade, queue, upload, or transaction is introduced, so those categories are inapplicable. Idempotency is inapplicable: the attribute is derived, never written back.
