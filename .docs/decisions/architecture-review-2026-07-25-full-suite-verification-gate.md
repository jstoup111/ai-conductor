# Architecture Review: Full-suite verification gate

**Date:** 2026-07-25
**Tier:** Medium (lightweight review)
**Requirements reviewed:** FR-1 through FR-17 in
`.docs/specs/2026-07-25-full-suite-verification-gate.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

The feature is feasible in the current TypeScript engine without new packages,
external services, schema changes, or shared runtime infrastructure.

- **Stack compatibility:** Node's existing filesystem, crypto, child-process,
  and Git seams can implement content fingerprints, atomic sidecars, timeout
  handling, and process output capture.
- **Prerequisites:** the project config schema must gain a required-at-gate
  aggregate `test_suite` declaration. This repository needs its own declaration in the
  same change. Consumer migration/bootstrap documentation is mandatory because
  missing configuration intentionally blocks.
- **Integration surface:** the work crosses the step registry, config loader,
  conductor tail loop, evidence/completion layer, CLI dispatch, rebase
  invalidation, status reporting, and direct-Claude skills. The shared verifier
  keeps the decision logic in one module rather than duplicating it across
  these adapters.
- **Data:** no persistent application data. The only new state is a versioned,
  atomic, gitignored evidence sidecar.
- **Performance:** input hashing is linear in relevant project content and runs
  on each proof check. It is cheaper than a full suite, excludes ignored files
  unless explicitly declared, and is deterministic. Tests must cover large
  output bounding and timeout cleanup.
- **Worktree isolation:** evidence lives under each worktree's `.pipeline/`.
  No ports, databases, queues, or shared files are introduced.

## Alignment

- The gate follows the APPROVED `wiring_check` pattern: built-in, mechanical,
  non-disableable, loop-gating, and capable of reopening BUILD with named
  evidence.
- Content validity refines the APPROVED gate-evidence principle without
  weakening it. Unlike judged gates, the full-suite proof must observe
  uncommitted inputs and survive byte-identical SHA changes; therefore a
  content fingerprint is the sound reuse identity and `HEAD` is provenance
  only.
- Placement before `manual_test` preserves the APPROVED validation group's
  membership and fan-out. `test_suite` is a serial prerequisite, not a fourth
  parallel member, so no SHIP validator begins on an unverified tree.
- The current story
  `.docs/stories/reduce-redundant-full-test-suite-runs-in-build-shi.md`
  describes finish as the sole local checkpoint. That is superseded product
  intent, not architecture precedent; the new stories must explicitly replace
  that behavior and conflict-check must report the resolution.
- The architecture diagrams accurately show the planned new gate, shared core,
  direct-Claude adapter, finish fallback, and independent CI boundary.

## Wiring Surface

- **`test_suite` step name and definition** — added to the `StepName` union,
  built-in registries, provider/review metadata where exhaustive maps require
  it, and `ALL_STEPS`; selected by the existing conductor loop after
  `wiring_check`.
- **`FullSuiteVerifier`** — called from the conductor's engine-native step path
  and from the new CLI adapter; it is the only component that calculates
  freshness, launches the project command, or writes suite evidence.
- **`test_suite` config block** — parsed and validated by the existing project
  config loader, consumed by `FullSuiteVerifier`, documented in project config
  references/bootstrap output, and declared by this repository.
- **`.pipeline/test-suite-evidence.json`** — written atomically by
  `FullSuiteVerifier`; consumed by verifier freshness checks, the `test_suite`
  completion path, finish fallback, and status/event presentation.
- **`conduct-ts test-suite` subcommand** — detected and dispatched in
  `src/conductor/src/index.ts`; invoked by the direct `/test-suite` skill and
  by any pipeline/TDD full-suite fallback.
- **`/test-suite` skill** — linked/installed through the existing skill
  registry and invoked in direct-Claude guidance after BUILD and before
  `/manual-test`.
- **test-suite status/invalidation events** — emitted through the existing
  conductor event bus and shown by existing CLI/dashboard consumers.
- **rebase/kickback invalidation membership** — consumed by the existing tail
  rewind machinery, which reevaluates `test_suite` before validation-group
  dispatch.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Existing consumer has no aggregate suite declaration and blocks after upgrade. | Integration | High | High | Intentional fail-closed migration; add bootstrap/migration docs, actionable error, and self-host declaration in the same release. |
| A project omits an ignored file or environment value that affects its suite. | Correctness | Medium | High | Broad tracked/untracked defaults; explicit `inputs` and `environment`; require documentation and acceptance tests; indeterminate declared inputs fail closed. |
| Fingerprint uses SHA or ignores dirty files, causing redundant reuse or stale proof. | Technical | Low | High | Binding ADR requires content-derived identity including dirty/untracked inputs; SHA is provenance only; acceptance coverage for rebase and dirty-tree paths. |
| Central registry/tail files overlap concurrent work. | Integration | High | Medium | Keep new behavior behind one verifier module and narrowly edit exhaustive maps; rebase before finish; rerun scoped registry/tail tests after conflict resolution. |
| Test process times out but leaves children running. | Technical | Medium | Medium | Process-group termination with bounded grace period; integration test leaked-child cleanup. |

The advisory overlap scan found the expected broad contention on
`src/conductor/src/types/steps.ts`, including this feature's own spec branch and
many historical/open specs. It found no more specific second implementation of
the proposed verifier/config/skill surfaces. Renames and name-only diffs remain
outside the scanner's guarantees.

## ADRs Created

- `adr-2026-07-25-content-addressed-full-suite-proof.md` — **APPROVED**.

## Conditions

1. The implementation plan must include consumer migration/bootstrap guidance
   and this repository's explicit aggregate `test_suite` configuration.
2. Reuse equality must be based on the content fingerprint, never raw HEAD/SHA
   equality.
3. `test_suite` must remain outside the parallel SHIP validation group and must
   gate all of its members.
4. Environment values must never be persisted in plaintext evidence.

## Blocking Issues

None. The operator aligned with the architecture and delegated the
single-versus-multiple-command choice to repository evidence. The existing
Vitest aggregate includes both ordinary and acceptance tests, so the approved
design retains one project-owned command.
