**Status:** Accepted

# Stories: Post-rebase delta-aware gate invalidation (#655)

Technical track. Acceptance criteria derive from the technical intent + the APPROVED ADR
`adr-2026-07-20-post-rebase-delta-aware-invalidation.md`. "Runtime source" = a code path that is
not a test/docs/CHANGELOG path (per `isCodeOrTestPath`, minus test files). D = rebase delta
(`changedCodePaths`, `preTree..HEAD`); F = feature claimed surface (`changedPaths(mergeBase..
preTree)`); `D_featureSrc = D ∩ F ∩ runtime`; `D_foreignSrc = D ∩ runtime \ F`.

---

## Story: Compute the feature claimed surface and delta partition on a changed rebase

**Requirement:** ADR "Decision" — delta partition (`D_test` / `D_featureSrc` / `D_foreignSrc`)

As the conductor, I want a file-changing rebase to compute the feature's claimed surface `F` and
partition the rebase delta `D`, so downstream gate decisions can reason over what actually changed
relative to what the feature owns.

### Acceptance Criteria

#### Happy Path
- Given a clean rebase producing `RebaseOutcome.changed`, when `performRebase` completes, then the
  outcome carries both `changedCodePaths` (D) and the feature claimed surface `F` computed as the
  name-only diff `mergeBase..preTree`.
- Given `D` and `F`, when the delta partitioner runs, then it returns three disjoint sets —
  `D_test` (test paths in D), `D_featureSrc` (`D ∩ F ∩ runtime`), `D_foreignSrc`
  (`D ∩ runtime \ F`) — whose union of runtime members equals `D ∩ runtime` and whose test members
  equal `D_test`.

#### Negative Paths
- Given the `git merge-base HEAD base` call returns empty (no common ancestor), when `F` is
  computed, then `F` is treated as **uncomputable** and the fail-closed path is taken (see the
  fail-closed story) — `F` is never silently defaulted to the empty set (which would misclassify
  every changed path as foreign and preserve gates unsoundly).
- Given `changedPathsBetween` returns a non-zero git exit code for the `mergeBase..preTree` diff,
  when `F` is computed, then `F` is uncomputable and fail-closed is taken.

### Done When
- [ ] `RebaseOutcome` for `kind: 'changed'` exposes both `changedCodePaths` and the feature claimed
      surface path list.
- [ ] A pure function partitions `(D, F)` into `{ test, featureSrc, foreignSrc }` with a unit test
      asserting disjointness and the union property for a mixed delta.
- [ ] Empty/missing `mergeBase` and a git-error diff both yield the uncomputable signal (not `[]`).

---

## Story: Test-only rebase delta preserves prd_audit and architecture_review_as_built

**Requirement:** Acceptance (1) — headline #642 case

As an operator, I want a rebase whose only feature-relevant change is a reconciled test file (plus
unrelated main-side changes) to NOT re-run the judged audit tail, so ship latency and token cost are
not paid for deltas that cannot change the audit verdicts.

### Acceptance Criteria

#### Happy Path
- Given a `changed` rebase where `D_featureSrc = ∅` (the only feature-owned path in D is a `*.test.*`
  file, e.g. `autoheal.test.ts`, and all runtime changes in D are foreign main-side), when
  `applyRebaseVerdicts` and the tail run, then `prd_audit` and `architecture_review_as_built` are
  **preserved**: their state stays `done`, no `satisfied:false` kickback verdict is written for them,
  and neither is re-dispatched.
- Given the same rebase, when the audit trail is inspected, then a `rebase_gate_preserved` event is
  emitted for each of `prd_audit` and `architecture_review_as_built` carrying the surface and the
  (empty) `D_featureSrc` that justified preservation.

#### Negative Paths
- Given `D_featureSrc = ∅` but the `prd_audit` verdict file is absent/`satisfied:false` before the
  rebase, when the tail runs, then the gate is NOT falsely marked preserved-done — preservation only
  keeps an already-satisfied gate satisfied; a not-yet-passed gate is still selected to run.
- Given a delta that is test-only for the feature BUT also contains a feature-owned runtime path without valid unchanged-replay evidence,
  when the decision runs, then `D_featureSrc ≠ ∅` and the gates are NOT preserved (they re-run) —
  a feature runtime change without valid unchanged-replay evidence defeats preservation.

### Done When
- [ ] Integration/unit test: a rebase with delta = {foreign runtime paths} ∪ {one feature test file}
      leaves `prd_audit` and `architecture_review_as_built` `done` with no re-dispatch.
- [ ] The two `rebase_gate_preserved` events are emitted with a non-null surface and empty
      `D_featureSrc`.
- [ ] A pre-rebase unsatisfied judged gate is never marked preserved.

---

## Story: A change to the feature's own runtime source re-runs the judged audit gates

**Requirement:** Acceptance (2)

As the conductor, I want a rebase that changes the feature's contribution, or lacks proof of its preservation, to re-run
`prd_audit` and `architecture_review_as_built`, so a genuinely changed implementation is re-audited
against its FRs / APPROVED ADRs.

### Acceptance Criteria

#### Happy Path
- Given a `changed` rebase where `D_featureSrc ≠ ∅` (a conflict resolution modified a feature-owned
  `src/**` runtime file and unchanged replay is not proved), when the tail runs, then `prd_audit` and `architecture_review_as_built`
  are **invalidated**: a `satisfied:false` `kickback:{from:'rebase'}`-shaped invalidation is applied
  and each is re-selected to run.
- Given the same rebase, when the audit trail is inspected, then a `rebase_gate_invalidated` event is
  emitted for each re-run judged gate carrying the matched feature-source paths.

#### Negative Paths
- Given `D_featureSrc` contains only a `.docs/**` path from the feature (docs excluded from D by
  `isCodeOrTestPath`), when the decision runs, then the judged gates are NOT invalidated on that
  basis alone (docs are not runtime source); changed active review inputs still invalidate their owning reviews through the document-input policy.
- Given `D_featureSrc ≠ ∅` and unchanged replay is not proved, when invalidation is applied, then the gate is reset to be re-run and its
  prior (now stale) `done`/verdict is not left in place to satisfy the gate.

### Done When
- [ ] Test: a changed or unproved feature replay touching a feature-owned runtime file re-runs both judged gates; valid unchanged-replay evidence may preserve them when their review inputs are unchanged.
- [ ] `rebase_gate_invalidated` events name the matched feature-source paths.
- [ ] Docs-only feature paths never appear in `D_featureSrc` (excluded upstream).

---

## Story: Foreign main-side runtime change re-runs manual_test/wiring_check but preserves the audits

**Requirement:** Acceptance (3)

As the conductor, I want a rebase that pulls in foreign main-side runtime changes to re-run the
whole-tree-behavior gates (`manual_test`, `wiring_check`) while preserving the feature-scoped audit
gates, so runtime behavior is re-validated without paying for a re-audit that cannot change.

### Acceptance Criteria

#### Happy Path
- Given a `changed` rebase where `D_foreignSrc ≠ ∅` and `D_featureSrc = ∅`, when the tail runs, then
  `manual_test` (if it had run) and `wiring_check` are **invalidated** (surface = whole runtime tree,
  which foreign changes touch), while `prd_audit` and `architecture_review_as_built` are **preserved**.
- Given the same rebase, when the audit trail is inspected, then `rebase_gate_invalidated` events are
  emitted for `manual_test`/`wiring_check` and `rebase_gate_preserved` events for the two audit gates.

#### Negative Paths
- Given `manual_test` did not run for this feature (`ranManualTest = false`), when the decision runs,
  then `manual_test` is not invalidated (nothing to invalidate) and no event is emitted for it —
  matching today's `ranManualTest` gating.
- Given `D` contains only test/docs paths (no runtime at all), when the decision runs, then
  `manual_test` and `wiring_check` are ALSO preserved (a test-only delta cannot change runtime
  behavior or reachability).

### Done When
- [ ] Test: delta = {foreign `src/**`} preserves both audit gates but invalidates `wiring_check`
      (and `manual_test` when it ran).
- [ ] Test: delta = {`*.test.*` only} preserves `manual_test`, `wiring_check`, `prd_audit`, and
      `architecture_review_as_built` together.
- [ ] `manual_test` decision respects `ranManualTest` (no event / no invalidation when it never ran).

---

## Story: A preserved judged gate is not swept stale by the downstream cascade

**Requirement:** Acceptance (4)

As the conductor, I want the explicit post-rebase decision applied without positional downstream staleness so preserved work stays complete.

### Acceptance Criteria

#### Happy Path
- Given manual_test is invalidated and the audit gates are validly preserved, when the rebase decision is applied, then the preserved audits remain done and are not redispatched.
- Given a gate is explicitly invalidated, when the post-rebase transition applies, then that gate is reopened through the shared mutation authority.

#### Negative Paths
- Given a gate has an outstanding ordinary repair failure, when rebase preservation is considered, then it cannot be restored to PASS.
- Given an ordinary completed step is not explicitly invalidated, when another gate reopens, then that step is not marked stale merely because of its position; required publication continuation remains explicitly selected.

### Done When
- [ ] The production rebase transition preserves valid audits while reopening exactly the requested checks.
- [ ] Completed acceptance authoring, BUILD, and unrelated steps are not swept stale by adjacency.
- [ ] Ordinary non-rebase repair still follows its existing downstream invalidation behavior.

---

## Story: Uncomputable delta fails closed to invalidate-all

**Requirement:** Acceptance (5)

As an operator, I want unavailable delta or replay evidence to prevent unsupported preservation while keeping completed work out of a blind positional replay.

### Acceptance Criteria

#### Happy Path
- Given the rebase delta or feature surface cannot be computed, when revalidation is selected, then applicable reviews are conservatively reopened without claiming unchanged replay.
- Given completion evidence remains valid, when conservative review revalidation proceeds, then completed acceptance authoring and BUILD are not reopened by position.

#### Negative Paths
- Given a Git error prevents computing the delta, when preservation is evaluated, then the error cannot be interpreted as an empty unchanged delta.
- Given BUILD completion evidence is also unavailable, when continuation is evaluated, then evidence recovery or halt blocks publication without blindly redispatching completed tasks.

### Done When
- [ ] Missing-base and Git-error fixtures report unproved preservation and conservatively required reviews.
- [ ] Missing completion evidence blocks with recovery diagnostics, not a positional task replay.
- [ ] The event/verdict trail names the actual conservative disposition.

---

## Story: Every preserve/re-run decision emits an auditable event

**Requirement:** Acceptance (6)

As an operator, I want each per-gate invalidation decision logged with the delta that justified it,
so the preserve/re-run behavior is transparent and debuggable.

### Acceptance Criteria

#### Happy Path
- Given any `changed` rebase decision, when a gate is preserved, then a `rebase_gate_preserved`
  event is emitted `{ gate, surface, deltaConsidered }`; when a gate is invalidated, then a
  `rebase_gate_invalidated` event is emitted `{ gate, matchedPaths }`.
- Given the two event types, when they are added to the events module, then they are typed members of
  the conductor event union (alongside `rebase_gate_reverified`) and are emitted through the existing
  event bus so the kickback-log surface renders them.

#### Negative Paths
- Given a gate that is neither preserved nor invalidated this rebase (e.g. `build`, handled by its
  own pre-verify), when the decision runs, then NO spurious preserve/invalidate event is emitted for
  it (no double-accounting with `rebase_gate_reverified`).
- Given the emitter throws while emitting a decision event, when the tail proceeds, then the gate
  decision itself is not lost (the verdict/state is authoritative; event emission is best-effort and
  never flips a preserve to a re-run or vice versa).

### Done When
- [ ] `types/events.ts` declares `rebase_gate_preserved` and `rebase_gate_invalidated` with the
      fields above; the union compiles.
- [ ] Test: a mixed rebase emits exactly one decision event per decided gate with the justifying
      delta; `build` gets none from this path.

---

## Story: The build gate's mechanical pre-verify is unaffected

**Requirement:** Acceptance (7)

As the conductor, I want the existing `build` mechanical pre-verify (ADR-2026-07-08) to retain evidence derivation, so this feature composes with, rather than regresses, the prior optimization.

### Acceptance Criteria

#### Happy Path
- Given a `changed` rebase where the build evidence is intact, when the tail runs, then `build` is
  re-verified mechanically and preserved via its existing pre-verify path (emitting
  `rebase_gate_reverified`), independent of the new delta-aware decision for the other gates.
- Given the new delta partition, when the decision runs, then `build` is excluded from the
  preserve/invalidate surface map (it is governed solely by its pre-verify).

#### Negative Paths
- Given build evidence is genuinely missing post-rebase, when the pre-verify runs, then continuation blocks for evidence recovery or halt rather than blindly redispatching completed tasks; independently established repair obligations still retain their ordinary owner.
- Given the delta-aware decision preserves the judged gates, when `build`'s pre-verify fails, then continuation cannot publish on those preserved reviews alone; a later concrete test/review failure enters ordinary BUILD repair and downstream validation.

### Done When
- [ ] Evidence-intact build preverification stays covered; missing-evidence cases assert recovery/halt rather than blind BUILD redispatch.
- [ ] `build` never appears in a `rebase_gate_preserved`/`rebase_gate_invalidated` event.

---

## Story: A non-rebase kickback is never affected by the delta-gated sweep

**Requirement:** Acceptance (8)

As the conductor, I want the delta-gating to apply ONLY to rebase-origin invalidation, so a
`build_review` or `prd_audit` rework kickback (`from !== 'rebase'`) is never swallowed or altered by
the preservation logic (the oscillation hazard the 2026-07-08 ADR guards against).

### Acceptance Criteria

#### Happy Path
- Given a downstream kickback with `kickback.from !== 'rebase'` (e.g. `build_review` requesting
  rework), when the tail runs, then the delta-aware preserve/invalidate decision and the delta-gated
  sweep do NOT apply — the requested rework proceeds exactly as today.
- Given the delta-gated sweep, when it decides whether to preserve a judged gate, then it keys strictly
  on `kickback.from === 'rebase'` for the current invalidation origin.

#### Negative Paths
- Given a `prd_audit` impl-gap kickback routes back to BUILD outside a rebase, when the loop proceeds,
  then no `rebase_gate_preserved` event is emitted and no judged gate is preserved on that basis.
- Given both a rebase invalidation and a pending non-rebase kickback exist, when decisions are applied,
  then the non-rebase kickback's target is never marked preserved by the rebase delta logic.

### Done When
- [ ] Test: a non-rebase `build_review` rework kickback re-runs normally with no preservation applied.
- [ ] The preservation/sweep code paths are guarded on `kickback.from === 'rebase'`.
- [ ] No `rebase_gate_preserved`/`invalidated` event fires for a non-rebase kickback.
