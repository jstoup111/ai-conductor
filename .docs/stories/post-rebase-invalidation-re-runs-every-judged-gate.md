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
- Given a delta that is test-only for the feature BUT also contains a feature-owned runtime path,
  when the decision runs, then `D_featureSrc ≠ ∅` and the gates are NOT preserved (they re-run) —
  a single feature runtime path defeats preservation.

### Done When
- [ ] Integration/unit test: a rebase with delta = {foreign runtime paths} ∪ {one feature test file}
      leaves `prd_audit` and `architecture_review_as_built` `done` with no re-dispatch.
- [ ] The two `rebase_gate_preserved` events are emitted with a non-null surface and empty
      `D_featureSrc`.
- [ ] A pre-rebase unsatisfied judged gate is never marked preserved.

---

## Story: A change to the feature's own runtime source re-runs the judged audit gates

**Requirement:** Acceptance (2)

As the conductor, I want any rebase that touches the feature's own runtime source to re-run
`prd_audit` and `architecture_review_as_built`, so a genuinely changed implementation is re-audited
against its FRs / APPROVED ADRs.

### Acceptance Criteria

#### Happy Path
- Given a `changed` rebase where `D_featureSrc ≠ ∅` (a conflict resolution modified a feature-owned
  `src/**` runtime file), when the tail runs, then `prd_audit` and `architecture_review_as_built`
  are **invalidated**: a `satisfied:false` `kickback:{from:'rebase'}`-shaped invalidation is applied
  and each is re-selected to run.
- Given the same rebase, when the audit trail is inspected, then a `rebase_gate_invalidated` event is
  emitted for each re-run judged gate carrying the matched feature-source paths.

#### Negative Paths
- Given `D_featureSrc` contains only a `.docs/**` path from the feature (docs excluded from D by
  `isCodeOrTestPath`), when the decision runs, then the judged gates are NOT invalidated on that
  basis (docs are not runtime source) — confirming docs-only feature changes do not force a re-audit.
- Given `D_featureSrc ≠ ∅`, when invalidation is applied, then the gate is reset to be re-run and its
  prior (now stale) `done`/verdict is not left in place to satisfy the gate.

### Done When
- [ ] Test: a rebase whose delta includes a feature-owned `src/**` file re-runs both judged gates.
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

As the conductor, I want the `markDownstreamStale` sweep to be delta-gated, so re-opening
`manual_test` does not mark a preserved downstream judged gate stale (the current blanket cascade is
exactly why the audit tail re-runs today).

### Acceptance Criteria

#### Happy Path
- Given `manual_test` is invalidated and re-opened via `navigateBack`, and `prd_audit` /
  `architecture_review_as_built` were decided **preserved** for this rebase, when the downstream-stale
  sweep runs in the `advanceTail` rebase branch, then the preserved judged gates are left/restored to
  `done` (not marked `stale`), while genuinely-invalidated downstream steps are marked stale as today.
- Given the sweep completes, when the loop selects the next step, then no preserved judged gate is
  re-selected for dispatch.

#### Negative Paths
- Given a judged gate was **invalidated** (not preserved) this rebase, when the sweep runs, then it IS
  marked stale/re-run — the delta-gating must not accidentally preserve a gate the decision invalidated.
- Given a downstream step that is neither a judged gate nor rebase-decided (an ordinary tail step
  after `manual_test`), when the sweep runs, then its existing stale behavior is unchanged — the
  gating narrows only the specific preserved gates, not the whole sweep.

### Done When
- [ ] Test: with `manual_test` re-opened and the audits preserved, the audits remain `done` after the
      sweep and are not re-dispatched.
- [ ] Test: an invalidated judged gate is still marked stale by the sweep.
- [ ] Non-gate downstream steps retain today's stale semantics.

---

## Story: Uncomputable delta fails closed to invalidate-all

**Requirement:** Acceptance (5)

As an operator, I want the system to fall back to today's invalidate-everything behavior whenever the
rebase delta or feature surface cannot be computed, so the optimization never trades away correctness.

### Acceptance Criteria

#### Happy Path
- Given `F` is uncomputable (missing `mergeBase` or a git-error diff) on a `changed` rebase, when the
  invalidation decision runs, then the system invalidates the **full fixed set**
  `{build (per its pre-verify), build_review, wiring_check, (+manual_test if it ran)}` and applies the
  blanket downstream-stale cascade — byte-for-byte today's behavior — and NO judged gate is preserved.
- Given the fail-closed path is taken, when the audit trail is inspected, then a single event/reason
  records that delta-aware invalidation was skipped (fail-closed) with the cause.

#### Negative Paths
- Given `D` itself is uncomputable (the `preTree..HEAD` diff errors), when the decision runs, then
  fail-closed invalidate-all is taken — the decision never proceeds on a partial/empty delta that
  would preserve gates unsoundly.
- Given fail-closed is taken, when downstream runs, then `prd_audit` / `architecture_review_as_built`
  DO re-run (via the unchanged blanket cascade) — preservation is never applied under uncertainty.

### Done When
- [ ] Test: forcing `mergeBase` empty on a changed rebase yields the full legacy invalidation set +
      cascade with zero preservations.
- [ ] Test: a git-error on either diff (`D` or `F`) triggers fail-closed.
- [ ] A fail-closed reason is recorded in the event/verdict trail.

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

As the conductor, I want the existing `build` mechanical pre-verify (ADR-2026-07-08) to keep working
unchanged, so this feature composes with, rather than regresses, the prior optimization.

### Acceptance Criteria

#### Happy Path
- Given a `changed` rebase where the build evidence is intact, when the tail runs, then `build` is
  re-verified mechanically and preserved via its existing pre-verify path (emitting
  `rebase_gate_reverified`), independent of the new delta-aware decision for the other gates.
- Given the new delta partition, when the decision runs, then `build` is excluded from the
  preserve/invalidate surface map (it is governed solely by its pre-verify).

#### Negative Paths
- Given build evidence is genuinely missing post-rebase, when the pre-verify runs, then `build` is
  invalidated and re-dispatched exactly as today — the delta-aware layer does not suppress a real
  build re-run.
- Given the delta-aware decision preserves the judged gates, when `build`'s pre-verify fails, then
  `build` re-running does NOT force the preserved judged gates to re-run beyond what the delta
  decision and the (delta-gated) downstream sweep dictate.

### Done When
- [ ] Existing build pre-verify tests (`rebase-loop.test.ts` buildRuns cases) still pass unchanged.
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
