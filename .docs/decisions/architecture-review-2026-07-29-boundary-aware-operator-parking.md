# Architecture Review: Boundary-aware operator parking

**Date:** 2026-07-29
**Tier:** Medium (lightweight review)
**Input reviewed:** approved Boundary-aware operator parking PRD, approved component and sequence diagrams, existing operator-park and concurrent-group ADRs, relevant daemon/conductor source, and the live deterministic BUILD verification sibling spec
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** Feasible in the existing TypeScript engine with local filesystem reads and typed in-process results; no package, external service, schema, or infrastructure is required.
- **Prerequisites:** Existing repo-root operator park state, conductor scheduler, feature runner, daemon pool, persisted lifecycle state, and approved concurrent-group core all exist.
- **Integration surface:** Conductor scheduling boundary, daemon construction/wrapper, feature runner outcome classification, pool parked bookkeeping, provider-neutral events, reporting, tests, and operator documentation.
- **Data implications:** No application data or migration. Lifecycle state remains in the existing feature worktree; no second park state is introduced.
- **Performance:** One bounded local park read before each pending scheduling unit. No continuous polling and no work inside model/test execution.
- **Worktree isolation:** The predicate resolves park authority from the main repo root while all feature state and active work remain in the feature worktree, matching the approved park-marker boundary.

## Alignment

- Supersedes the exact incompatible part of `adr-2026-07-04-operator-park-marker` while carrying forward its marker, fail direction, dashboard, and canonical-module decisions.
- Reuses `adr-2026-07-10-concurrent-group-core`: active branches settle and the single-writer join completes before the next shared boundary check.
- Does not modify group membership, branch cancellation, concurrency, failure joins, or retry budgets.
- Uses a discriminated intentional result rather than a boolean state file, preventing contradictory durable state and preserving exhaustive outcome handling.
- Keeps interactive runs unchanged through optional daemon-only dependency injection.
- Approved architecture diagrams match the proposed scheduler, state, and runner flow.
- The sibling deterministic BUILD verification ADR is semantically compatible because it uses the same conductor scheduler and group core. Both specs overlap in `conductor.ts`; this is a merge/rebase risk, not a behavioral contradiction.

## Wiring Surface

- **Daemon boundary predicate** — created in `daemon-cli.ts` from the existing main-root operator-park reader and feature slug; injected only into daemon-mode conductor construction.
- **Shared pre-unit boundary gate** — invoked from `Conductor.run()` after completed/skipped traversal and immediately before any serial or parallel scheduling unit can dispatch.
- **Typed conductor termination** — returned by `Conductor.run()` and propagated by `runConductorInWorktree` through `RealDepsConfig` and `FeatureRunnerDeps`; ordinary callers may ignore non-park results.
- **Parked feature outcome** — consumed by `makeRunFeature` before missing-marker error classification, then handled by the daemon pool's collection path to keep the worktree and make unpark resumable.
- **Boundary event** — emitted by the shared gate, registered in the event sink policy, persisted with feature events, and rendered by the daemon/reporting path with the last settled unit.
- **Operator documentation** — the daemon guide and emergency-stop runbook replace the attempt-level limitation with serial-step/parallel-group boundary semantics.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Boundary stop is inferred from absent markers and becomes a false HALT after a fast unpark. | Data | Medium | High | Propagate one typed result; never classify by a second park read or missing evidence. |
| A current or future parallel path bypasses the boundary. | Integration | Medium | High | Gate the scheduler before units, not group members; acceptance-test configured, SHIP, and deterministic BUILD groups. |
| Group/member statuses are not durable before park reporting. | Data | Low | High | Preserve the concurrent core's settle-all, single-writer join; emit the park result only after join control returns. |
| Genuine active-work failure is overwritten by park presentation. | Data | Low | High | Existing failure/kickback/HALT paths remain authoritative; park controls only later dispatch. |
| Concurrent specs conflict textually in the central scheduler. | Integration | High | Medium | Rebase before implementation, preserve both approved ADRs, and rerun conflict/architecture amendment checks on semantic drift. |
| A park-state read fails. | Technical | Low | Medium | Existing fail-toward-parked contract; typed intentional stop with an indeterminate-read diagnostic. |

## Early Overlap Scan

The advisory scan reports broad historical overlap on `src/conductor/src/engine/conductor.ts`. Direct live-worktree inspection identified the material active overlap: `spec/replace-the-test-suite-skill-with-a-deterministic-` adds the deterministic BUILD group through the same scheduler and shared concurrent-group core. No semantic conflict exists in the approved designs; implementation ordering still requires a rebase.

## ADRs Created

- `adr-2026-07-29-operator-park-scheduling-unit-boundary` — **APPROVED**, superseding `adr-2026-07-04-operator-park-marker`.

## Conditions

1. Use one typed in-process boundary result; do not add a second durable park or HALT marker.
2. Enforce parking at the shared scheduler boundary, never with group-specific member checks or a second parallel executor.
3. Preserve every natural failure, kickback, remediation, and status-persistence path; parking controls only whether later work starts.
4. Acceptance coverage must include serial work, configured parallel groups, the SHIP validation group, and the deterministic BUILD verification group from the sibling spec.
5. Rebase implementation work onto the sibling deterministic-group change if it lands first; if its approved scheduler/core contract changes, run a scoped architecture amendment and conflict-check before building.
6. On ADR approval, mark the superseded 2026-07-04 ADR accordingly and update canonical daemon/runbook documentation in the implementation PR.

## Blocking Issues

None.

## Amendment Review — 2026-07-31 build-review completeness remediation

**Input reviewed:** approved remediation plan commit `4c72ae3e7`, Story 8, the current scheduler
dispatch seams, the approved operator-park ADR, and the existing sequence diagram

**Verdict:** APPROVED WITH CONDITIONS — unchanged from the original review

**Operator approval:** Approved 2026-07-31.

### Feasibility

- The three `rem-test-*` tasks add focused Vitest coverage in the existing
  `operator-park-boundary.test.ts` suite. They require no package, service, schema, shared resource,
  or production-code prerequisite.
- The mechanical inventory can enumerate the three existing dispatch shapes without adding a
  runtime registry or changing scheduler behavior.
- Zero-member and one-member fixtures exercise the current membership and serial-degradation paths
  with injected runners, so they retain worktree isolation and third-party test boundaries.

### Alignment

- `rem-test-001` directly enforces ADR Decision 3 (one shared pre-unit gate) and Decision 10 (every
  parallel group inherits it).
- `rem-test-002` pins the existing all-skipped path without treating skipped members as dispatched
  work or adding a group-specific park branch.
- `rem-test-003` pins width-one degradation through the ordinary serial gate without introducing a
  second executor.
- All three tasks are verify-only and add no production surface; the existing Wiring Surface remains
  complete. The sequence diagram remains accurate because runtime flow is unchanged.

### Verify-Claims Ledger

#### Claims

- [verified] The approved ADR requires one shared pre-unit gate and explicitly covers zero/one
  applicable group membership through the ordinary scheduler contract.
- [verified] The revised plan limits all three remediation tasks to
  `src/conductor/test/engine/operator-park-boundary.test.ts`.
- [verified] Current scheduler control flow has distinct configured-group, built-in-group, and
  ordinary serial dispatch seams, with all-skipped and width-one branches before fan-out.
- [verified] The focused advisory overlap scan reports no open blocker for the remediation test file.

#### Assumptions

- None. The approved ADR, accepted story, current plan, and inspected scheduler paths settle the
  architecture and test boundaries.

**Verify-claims verdict:** CLEAR

### Risks and ADRs

No new risks and no new or superseded ADRs. The original risk register and six implementation
conditions remain authoritative.
