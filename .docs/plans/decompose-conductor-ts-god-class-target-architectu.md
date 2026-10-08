# Implementation Plan: Move conductor.ts module-level code into topical engine modules (#1481, feature 1)

**Date:** 2026-10-07
**Design:** .docs/decisions/adr-2026-10-07-conductor-decomposition-target-architecture.md (D8)
**Stories:** .docs/stories/decompose-conductor-ts-god-class-target-architectu.md
**Conflict check:** No blocking conflicts as of 2026-10-07; 2 degrading conflicts resolved (.docs/conflicts/decompose-conductor-ts-god-class-target-architectu.md)

## Summary

Move every declaration outside `class Conductor` in `src/conductor/src/engine/conductor.ts` into
13 topical engine modules. The class's file keeps the class, six class-only tunables and a
re-export of exactly the names it exports today. Production importers migrate to the defining
modules. A test-side shape guard and an export-surface test lock the result in. There are 12
tasks.

## Technical Approach

- **Verbatim moves.** Each move task cuts a cohesive group of module-level declarations out of
  `conductor.ts` and pastes them unchanged into a new module under `src/conductor/src/engine/`.
  Only the following may change:
  - an `export` keyword added to a previously private helper (exported from its new module only);
  - import paths and import lists (pruned for `noUnusedLocals`);
  - the one recorded rename.

  `class Conductor` imports what it uses from the new modules. No new module imports
  `conductor.ts`. Shared constants travel with their non-class users: `MAX_KICKBACKS_PER_GATE`
  moves to `remediation-caps.ts`.
- **The shim.** `conductor.ts` keeps `export { … } from` and `export type { … } from` (required by
  `isolatedModules`) for **only** the names it exports at BUILD's base. Private helpers that move
  never join the `conductor.js` surface. The roughly 197 test files that import `conductor.js`
  stay untouched; Task 11's retargets are the only exceptions.
- **Inventory is derived at BUILD, not frozen here.** The in-flight
  `remediation-dispositions-honor-the-engine-owned-in` build changes module-level code in
  `conductor.ts`: it adds `remediationProjectionSource`, `remediationGapsFromTypedPlan` and
  `remediationDispositionRejectionsFromDispatchOutput`, and it deletes
  `formatRejectedDispositions`.
  - The group lists below are the 2026-10-07 inventory and serve as **routing rules by topic**.
  - At each move task, BUILD re-lists the module-level declarations at its rebased base and
    routes each one to the group whose topic it serves.
  - Task 10 sweeps any declaration no group claimed.
- **Destination modules** (2026-10-07 inventory; names confirmed):

  | # | Module | Declarations |
  |---|---|---|
  | 1 | `step-runner-types.ts` | `StepRunResult`, `buildOutcomeRung`, `SpotAuditDispatchResult`, `toSpotAuditVerifierResult`, `AuthRecoveryDisposition`, `formatProbeFailureClassification`, `graderDispatchBackoffMs`, `ComplexityAssessment`, `StepRunOptions`, `StepRunner` |
  | 2 | `conductor-options.ts` | `CheckpointResponse`, `OperatorParkedTermination`, `NavigableStep`, `ArtifactReviewResult`, `FinishPublicationCoordinator`, `ConductorOptions` |
  | 3 | `remediation-caps.ts` | `MAX_KICKBACKS_PER_GATE`, `remediationLapCapForGate`, `validationJoinRemediationRoundCap`, `prdAuditAppendCap`, `RemediationLedgerGate`, `RemediationGateAppendBudget`, `readRemediationGateAppendBudget` |
  | 4 | `prd-audit-routing.ts` | `RecordedPrdAuditFinding`, `RecordedAsBuiltRemediationFinding`, `RecordedReviewFinding`, `PrdAuditPlanGapRoute`, `criterionStorySection`, `PrdAuditOverScopeRoute`, `CurrentPrdAuditRoute`, `buildRefusalReworkEvidence`, `routeTypedPrdAuditOverScope`, `prdAuditScopeProjection`, `withRefusalReworkContext` |
  | 5 | `as-built-routing.ts` | `AsBuiltGoverningClauseResolution`, `renderAsBuiltGoverningReference`, `typedAsBuiltResolution`, `renderAsBuiltBlockedFindingDetail`, `readAsBuiltRoutingOutcome` |
  | 6 | `remediation-hints.ts` | `RemediationGateProvenance`, `RemediationHintSource`, `formatRejectedDispositions` (if still present), `earliestRemediationTarget`, `ExistingTaskBindingResolution`, `resolveExistingTaskBindingsForAdmission`, `remediationGapTargetsAnotherFeatureSealedArtifact`, `directedProtectedTarget`, `normalizeDirectingClause`, `buildRemediationHint`, `buildRetryHint`, plus the in-flight remediation-disposition helpers if they are present at base |
  | 7 | `remediation-task-append.ts` | conductor's `appendRemediationTasks`, **renamed `appendConductorRemediationTasks`** to resolve the clash with `remediation-append.ts`. The shim re-exports it as `appendRemediationTasks`. This is the only rename. |
  | 8 | `resume-entry.ts` | `resolveLastStep`, `findResumeIndex`, `clampToRunnablePrerequisite`, `earliestResolvablePrerequisiteIndex`, `resolveRunnableResumeEntry`, `resolveGroupMembership`, `navigateBack`, `getNavigableSteps`, `deriveGateTopology`, `GateTopology` |
  | 9 | `build-review-halt-render.ts` | `rawBuildReviewFailIsEffectivelyAccepted`, `renderExhaustedMechanicalBuildReviewHalt`, `renderReadOnlyReviewUnavailableBuildReviewHalt`, `testSuiteBudgetVerdict`, `projectExecutionSummaryEntries`, `isNoTaskProgressBuildStall`, `seedBuildTaskTelemetry`, `parseNameStatus` |
  | 10 | `step-completion.ts` | `AGENT_DISPATCHING_ENGINE_NATIVE_STEPS`, `isEngineComputedStep`, `hasCompletionContract`, `stepDeclaresReviewableArtifacts`, `stepHasCompletionCheck`, `writeFenceInstalledForProvider` |
  | 11 | `artifact-approvals.ts` | `snapshotArtifactMtimes`, `selectChangedArtifacts`, `hashFile`, `approvalKey`, `filterUnapprovedArtifacts`, `recordApprovals`, `recordActivePlanPath` |
  | 12 | `finish-presentation-repair.ts` | `createFinishPresentationRepair`, `createProvenanceGuardedFinishPresentationRepair` |
  | 13 | `post-finish-shipped-record.ts` | `PostFinishShippedRecordRefreshOptions`, `refreshPostFinishShippedRecord`, `pushPostFinishShippedRecord`, `remoteFailure` |

  `writeBuildOutcomeBestEffort`, which sits among the imports, goes to whichever module holds its
  only non-class caller; if it has none, it goes to `build-review-halt-render.ts`.
- **What stays in `conductor.ts`:** the tunables `MAX_RECOVERY_RETRIES` (exported),
  `MAX_RATE_LIMIT_DEADLINE_MS`, `PUBLICATION_REDISPATCH_BUDGET`, `MAX_GATE_SELECTIONS`,
  `DONE_MARKER` and `LOOP_HALT_MARKER`.
- **Guards are test-side, not production.**
  - The conductor-shape guard lives in `src/conductor/test/structural/conductor-shape-guard.ts`.
    It is a pure TypeScript-compiler-API checker over source text, which keeps it fixture-testable.
    The real-file assertions sit in `src/conductor/test/structural/conductor-shape.test.ts`.
  - The export-surface check uses `ts.createProgram` plus `checker.getExportsOfModule`.
  - Neither adds a pipeline gate (review C4).
- **Ordering.** Every move edits `conductor.ts`, so the move tasks form one serial chain to avoid
  same-file merge collisions inside the build. The two guard tasks have no dependencies and run
  first.
- **File-name-keyed references.** `MANAGED_DISPATCH_PROMPT_SURFACES` in
  `src/conductor/src/engine/session-command-audit.ts` is the only gate keyed on the `conductor.ts`
  file name (verified by `grep -rn "'conductor.ts'" src/conductor/src`). Task 5 re-points it. The
  `prd_audit.*` and `kickback_escalation` consumer entries in
  `src/conductor/test/engine/config-consumer-registry.ts` move in Task 4.
- **Tunables are class-only (verified).** A grep of the module-level regions on 2026-10-07 shows
  the six tunables are declared there and referenced by no module-level code, so no moved helper
  needs one.
- **Module headers.** New modules' header comments must not claim "no callers" or "nothing
  imports this module", because `test/structural/module-header-caller-claims.test.ts` rejects
  false claims.
- **Historical Done-When greps.** Some shipped stories carry greps scoped to `conductor.ts` only:
  `conductor-test-suite-leaks-a-real-pipeline-halt-in.md:41`, `wave-c-telemetry-event-log.md:86`
  and `audit-trail-write-completeness-for-retro-under-fre.md:58`. From now on they hold across
  `conductor.ts` plus the destination modules. This is recorded here only; no task edits those
  stories.

## Prerequisites

- None. No migration, config, or dependency changes. `typescript` is already a dependency.

## Tasks

### Task 1: Conductor-shape guard with fixture coverage
**Story:** Story 1 negative paths 1–4; Story 3 negative paths 1–3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/structural/conductor-shape.test.ts` that call the
   guard on in-memory source-text fixtures:
   - **Shape check:**
     - a top-level `function` is rejected, naming it and its line;
     - a `const` outside the tunables list is rejected, naming it;
     - `export * from './x.js'`, `export default 1`, `export = x` and a local `export { X }`
       without `from` are rejected;
     - a top-level `type`, `interface`, `enum`, `namespace`, `declare`, `let`/`var`, a second
       `class` other than `Conductor`, and a bare expression statement are each rejected, naming
       the kind and its line;
     - a fixture containing only imports, named `export {…} from` / `export type {…} from`
       re-exports, the six listed tunables (one exported) and `class Conductor` is accepted.
   - **Import check:**
     - a fixture tree where `engine/foo.ts` imports `./conductor.js` is rejected naming
       `engine/foo.ts`. Cover value, `import type`, and double-quote forms.
     - a fixture where `index.ts` imports `{ Conductor, buildRetryHint }` is rejected, naming
       `buildRetryHint`; likewise `daemon-cli.ts` importing
       `{ Conductor, OperatorParkedTermination }`, naming `OperatorParkedTermination`.
     - a fixture destination module with `import type { X } from './conductor.js'` is rejected.
     - a fixture with only `index.ts` and `daemon-cli.ts` importing `{ Conductor }` is accepted.
2. Verify RED.
3. Implement `src/conductor/test/structural/conductor-shape-guard.ts` using the TypeScript
   compiler API (`ts.createSourceFile`), walking `sourceFile.statements`:
   - `checkConductorShape(source, allowedTunables)` returns violations of
     `{ kind, name, line }`.
   - `checkConductorImports(files, allowedImporters)` returns violations of
     `{ file, specifier, names }`.
   - Use the AST, not regexes, so inline `type` specifiers, quote styles and re-exports are all
     handled.
4. Verify GREEN and commit.

**Done when:**
- [test] `checkConductorShape` returns a violation naming the function and its line for a top-level `function` fixture, and one naming the const for a non-listed `const` fixture, as asserted in `conductor-shape.test.ts`.
- [test] `checkConductorShape` returns violations for `export *`, `export default`, `export =`, a local `export { X }` without `from`, `type`, `interface`, `enum`, `namespace`, `declare`, `let`/`var`, a second top-level `class`, and expression-statement fixtures, each naming the statement kind and line, and none for the allowed-statements fixture.
- [test] `checkConductorImports` returns a violation naming the importing file for value, `import type` and double-quoted imports of `conductor.js` from a non-allowed module, including a destination-module fixture importing it type-only.
- [test] `checkConductorImports` returns a violation naming the extra name for an `index.ts` fixture importing `{ Conductor, buildRetryHint }` and for a `daemon-cli.ts` fixture importing `{ Conductor, OperatorParkedTermination }`, and none when both allowed importers import only `Conductor`.

**Files likely touched:**
- `src/conductor/test/structural/conductor-shape-guard.ts` — new guard
- `src/conductor/test/structural/conductor-shape.test.ts` — fixture tests

**Dependencies:** none

### Task 2: Export-surface lock for conductor.js
**Story:** Story 2 happy path 1; Story 2 negative paths 1, 2, 3
**Type:** infrastructure

**Steps:**
1. At BUILD's rebased base, derive the names `src/conductor/src/engine/conductor.ts` exports
   (values and types) using the TypeScript checker. Commit them sorted to
   `src/conductor/test/structural/conductor-exports.json`.
2. Write failing tests in `src/conductor/test/structural/conductor-export-surface.test.ts`:
   - a pure `diffExportSurface(expected, actual)` returns `{ missing, extra }`;
   - a synthetic drop yields `missing: ['X']`;
   - a synthetic addition yields `extra: ['Y']`;
   - the real check builds a `ts.Program` over `conductor.ts`, calls
     `checker.getExportsOfModule`, and asserts `missing` and `extra` are both empty;
   - for each module-level name that is **not** in the committed list but is declared in
     `conductor.ts` at base (for example `formatRejectedDispositions`, or whichever non-exported
     helper exists), assert it is absent from the resolved exports. Store those names alongside
     the list as `nonExportedAtBase`.
3. Verify RED (the helper does not exist yet).
4. Implement the helper, verify GREEN, and commit. The real check passes at base, before any
   move.

**Done when:**
- [test] `diffExportSurface` reports a dropped name in `missing` and an added name in `extra`, naming each, as asserted in `conductor-export-surface.test.ts`.
- [test] The checker-resolved export set of `engine/conductor.ts` equals `conductor-exports.json` exactly (empty `missing` and `extra`).
- [test] Every name in `nonExportedAtBase` is absent from the checker-resolved exports of `engine/conductor.ts`.
- `conductor-exports.json` equals the checker-resolved value and type exports of `git show $(git merge-base HEAD origin/main):src/conductor/src/engine/conductor.ts`, and the commit body records that command and the generated list.

**Files likely touched:**
- `src/conductor/test/structural/conductor-exports.json` — committed export list derived at base
- `src/conductor/test/structural/conductor-export-surface.test.ts` — surface test

**Dependencies:** none

### Task 3: Move step-runner and conductor-option types
**Story:** Story 2 negative path 4; Story 3 happy path 1 (type importers)
**Type:** refactor

**Steps:**
1. Move the group 1 and group 2 declarations verbatim into
   `src/conductor/src/engine/step-runner-types.ts` and
   `src/conductor/src/engine/conductor-options.ts`. Route any base-only declarations that share
   their topic to the same modules.
2. In `conductor.ts`, import them for the class and re-export the names exported at base: types
   via `export type { … } from`, values (`toSpotAuditVerifierResult` and the like) via
   `export { … } from`.
3. Migrate type and value imports of these names from `conductor.js` to the new modules in:
   - `src/conductor/src/engine/step-runners.ts`
   - `src/conductor/src/engine/group-core.ts`
   - `src/conductor/src/engine/finish-publication-production.ts`
   - `src/conductor/src/engine/self-host/build-auth-preflight.ts`
   - `src/conductor/src/daemon-deps.ts`
   - `src/conductor/src/daemon-runner.ts`
   - `src/conductor/src/ui/types.ts`
   - `src/conductor/src/ui/terminal/prompt-host.ts`
   - `src/conductor/src/daemon-cli.ts` (`OperatorParkedTermination`)
4. Run `tsc --noEmit` and the scoped tests for step-runners, group-core and the export surface.

**Done when:**
- `npm run typecheck` (tsc with `noUnusedLocals` and `isolatedModules`) exits 0, which shows every moved type-only name is re-exported with `export type`.
- [test] The Task 2 export-surface test still reports empty `missing` and `extra` for `engine/conductor.ts`.
- `grep -rnE "from ['\"].*conductor(\.js)?['\"]" src/conductor/src/engine/group-core.ts src/conductor/src/engine/finish-publication-production.ts src/conductor/src/engine/self-host/build-auth-preflight.ts src/conductor/src/daemon-deps.ts src/conductor/src/daemon-runner.ts src/conductor/src/ui/types.ts src/conductor/src/ui/terminal/prompt-host.ts` prints nothing.
- [test] The existing step-runners and group-core test files pass; the only edits allowed are extending a whole-module `vi.mock` factory, or retargeting it to the module the production consumer now imports from (Story 5 negative 3).

**Files likely touched:**
- `src/conductor/src/engine/step-runner-types.ts`, `src/conductor/src/engine/conductor-options.ts` — new
- `src/conductor/src/engine/conductor.ts` — remove the moved declarations; import and re-export
- `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/group-core.ts`, `src/conductor/src/engine/finish-publication-production.ts`, `src/conductor/src/engine/self-host/build-auth-preflight.ts`, `src/conductor/src/daemon-deps.ts`, `src/conductor/src/daemon-runner.ts`, `src/conductor/src/ui/types.ts`, `src/conductor/src/ui/terminal/prompt-host.ts`, `src/conductor/src/daemon-cli.ts` — import paths

**Verify-only:** yes

**Dependencies:** Task 2

### Task 4: Move remediation caps and PRD-audit routing; migrate cap consumers
**Story:** Story 3 happy path 3; Story 7 negative path 2; Story 5 happy path 4
**Type:** refactor

**Steps:**
0. First, before any code moves, capture the base values as described in step 5 and commit the
   new test with them. That test fails until the move lands.
1. Move group 3 (including `MAX_KICKBACKS_PER_GATE`) into
   `src/conductor/src/engine/remediation-caps.ts`, and group 4 into
   `src/conductor/src/engine/prd-audit-routing.ts`, verbatim.
2. `conductor.ts` imports `MAX_KICKBACKS_PER_GATE` and the cap functions from
   `remediation-caps.ts` and re-exports the names exported at base.
3. Migrate `src/conductor/src/engine/step-runners.ts` (`prdAuditScopeProjection`,
   `remediationLapCapForGate`), `src/conductor/src/engine/kickback-budget-cli.ts` and
   `src/conductor/src/engine/daemon-observe-cli.ts` (`prdAuditAppendCap`) to the defining
   modules.
4. In `src/conductor/test/engine/config-consumer-registry.ts`, re-point the `prd_audit.*` and
   `kickback_escalation` consumer entries from `conductor.ts` to the module that now reads each
   key.
5. Before moving anything, run the base `prdAuditAppendCap` (imported from `conductor.js` at base)
   for the default config and for a config overriding every `prd_audit.*` cap key, and record
   what each CLI's cap-reporting path reports for those configs. Store the values as expected
   constants in a new `src/conductor/test/engine/remediation-caps.test.ts`. That test drives both
   CLIs' cap-reporting paths against the real `remediation-caps.ts`, with no mock.

**Done when:**
- `src/conductor/src/engine/step-runners.ts` has zero import declarations whose specifier ends in `conductor.js`.
- `remediation-caps.ts` declares `MAX_KICKBACKS_PER_GATE` and `prdAuditAppendCap`, `conductor.ts` imports `MAX_KICKBACKS_PER_GATE` from `./remediation-caps.js` so no cycle runs through `conductor.ts`, and `kickback-budget-cli.ts` and `daemon-observe-cli.ts` import `prdAuditAppendCap` with the specifier `./remediation-caps.js`.
- [test] `remediation-caps.test.ts` runs the cap-reporting path of `kickback-budget-cli.ts` and of `daemon-observe-cli.ts` with the real `remediation-caps.ts` (no mock), for the default config and for a config overriding every `prd_audit.*` cap key, and asserts each CLI reports exactly the PRD-audit append cap values recorded from the base in step 5; the existing CLI tests pass, edited only to extend a whole-module mock factory or retarget it to the module the CLI now imports from.
- [test] `config-consumer-registry.test.ts` passes with the `prd_audit.*` and `kickback_escalation` entries naming the modules that now consume them.

**Files likely touched:**
- `src/conductor/src/engine/remediation-caps.ts`, `src/conductor/src/engine/prd-audit-routing.ts` — new
- `src/conductor/src/engine/conductor.ts` — remove, import, re-export
- `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/kickback-budget-cli.ts`, `src/conductor/src/engine/daemon-observe-cli.ts` — import paths
- `src/conductor/test/engine/config-consumer-registry.ts` — consumer entries
- `src/conductor/test/engine/remediation-caps.test.ts` — new parity test

**Dependencies:** Task 3

### Task 5: Move remediation hints and re-point the managed-dispatch prompt audit
**Story:** Story 4 happy paths 1–2; Story 4 negative paths 1–2
**Type:** refactor

**Steps:**
1. Move group 6 into `src/conductor/src/engine/remediation-hints.ts` verbatim, keeping the
   `=managed` session-command region markers inside `buildRetryHint` and
   `buildRemediationHint`. Route any remediation-disposition helpers present at base here too.
2. In `src/conductor/src/engine/session-command-audit.ts`, change the
   `MANAGED_DISPATCH_PROMPT_SURFACES` entry
   `{ file: 'conductor.ts', symbols: ['buildRetryHint', 'buildRemediationHint'] }` to
   `{ file: 'remediation-hints.ts', … }`.
3. In `src/conductor/test/engine/session-command-audit-integration.test.ts`, point the source
   reads for the `=managed` markers and the injected-violation case at `remediation-hints.ts`.
4. Run `grep -rnE "['\"]conductor\.ts['\"]" src/conductor/src` before and after the change. Record
   both outputs in the commit body: before, `session-command-audit.ts` must be the only
   gate-keying match; after, no entry keyed on `conductor.ts` may name a moved symbol.

**Done when:**
- `MANAGED_DISPATCH_PROMPT_SURFACES` in `session-command-audit.ts` lists `remediation-hints.ts` for `buildRetryHint` and `buildRemediationHint`, and no entry names `conductor.ts` for them.
- [test] `session-command-audit-integration.test.ts` finds the `=managed` markers in `remediation-hints.ts`, and its "registers only declarations that exist" test passes; it would fail if the entry still named `conductor.ts`.
- [test] The audit reports a managed-dispatch violation for an operator-only session-command reference injected into `buildRetryHint`'s prompt text, and separately into `buildRemediationHint`'s prompt text, in `remediation-hints.ts`, as asserted in `session-command-audit-integration.test.ts`.
- The commit body records the before and after output of `grep -rnE "['\"]conductor\.ts['\"]" src/conductor/src`: before, `session-command-audit.ts` is the only gate-keying match; after, no entry keyed on `conductor.ts` names a moved symbol.

**Files likely touched:**
- `src/conductor/src/engine/remediation-hints.ts` — new
- `src/conductor/src/engine/conductor.ts` — remove, import, re-export
- `src/conductor/src/engine/session-command-audit.ts` — registry entry
- `src/conductor/test/engine/session-command-audit-integration.test.ts` — source path

**Verify-only:** yes

**Dependencies:** Task 4

### Task 6: Move remediation task append (renamed) and as-built routing
**Story:** Story 2 happy path 3; Story 7 negative path 3
**Type:** refactor

**Steps:**
1. Move conductor's `appendRemediationTasks` into
   `src/conductor/src/engine/remediation-task-append.ts`, renamed
   `appendConductorRemediationTasks`. Change nothing else in its body.
2. Move group 5 into `src/conductor/src/engine/as-built-routing.ts`.
3. The class calls `appendConductorRemediationTasks`. The shim adds
   `export { appendConductorRemediationTasks as appendRemediationTasks } from './remediation-task-append.js'`.
4. Write a test in `src/conductor/test/engine/remediation-task-append-identity.test.ts` asserting
   two things:
   - `appendRemediationTasks` imported from `conductor.js` is the same function object as
     `appendConductorRemediationTasks`;
   - it is a different object from the `appendRemediationTasks` exported by
     `remediation-append.ts`.

**Done when:**
- [test] `remediation-append-land-shape.test.ts` passes unchanged while importing `appendRemediationTasks` from `engine/conductor.js`.
- [test] `remediation-task-append-identity.test.ts` asserts that `conductor.js`'s `appendRemediationTasks` is the same function as `remediation-task-append.ts`'s `appendConductorRemediationTasks` and is not the same as `remediation-append.ts`'s `appendRemediationTasks`.
- [test] The existing tests for both append paths pass unchanged, so each function keeps its prior behavior.

**Files likely touched:**
- `src/conductor/src/engine/remediation-task-append.ts`, `src/conductor/src/engine/as-built-routing.ts` — new
- `src/conductor/src/engine/conductor.ts` — remove, import, aliased re-export
- `src/conductor/test/engine/remediation-task-append-identity.test.ts` — new identity test

**Dependencies:** Task 5

### Task 7: Move resume entry and step completion; pin isEngineComputedStep
**Story:** Story 7 happy path 3
**Type:** refactor

**Steps:**
1. Move group 8 into `src/conductor/src/engine/resume-entry.ts`, and group 10 (including
   `AGENT_DISPATCHING_ENGINE_NATIVE_STEPS`, which is not exported) into
   `src/conductor/src/engine/step-completion.ts`, verbatim.
2. Re-export the names exported at base.
3. Add `src/conductor/test/engine/step-completion.test.ts` asserting
   `isEngineComputedStep('test_suite') === true` and
   `isEngineComputedStep('build_review') === false`, importing from `step-completion.ts` without
   exporting the set.

**Done when:**
- [test] `step-completion.test.ts` asserts that `isEngineComputedStep` from `step-completion.ts` returns `true` for `'test_suite'` and `false` for `'build_review'`.
- [test] The existing `findResumeIndex` and `resolveGroupMembership` tests pass unchanged through `conductor.js`.
- `AGENT_DISPATCHING_ENGINE_NATIVE_STEPS` is not exported from `step-completion.ts`, and it is absent from the export-name list in `conductor-exports.json` (the list Task 2 compares with the checker-resolved exports).

**Files likely touched:**
- `src/conductor/src/engine/resume-entry.ts`, `src/conductor/src/engine/step-completion.ts` — new
- `src/conductor/src/engine/conductor.ts` — remove, import, re-export
- `src/conductor/test/engine/step-completion.test.ts` — new pin

**Dependencies:** Task 6

### Task 8: Move build-review halt rendering and artifact approvals
**Story:** Story 5 happy path 1 (`task-seed.test.ts`)
**Type:** refactor

**Steps:**
1. Move group 9 into `src/conductor/src/engine/build-review-halt-render.ts` and group 11 into
   `src/conductor/src/engine/artifact-approvals.ts`, verbatim.
2. Re-export the names exported at base.
3. In `src/conductor/test/engine/task-seed.test.ts`, point the source read that expects
   `seedTaskStatus(projectRoot, planPath, undefined, { dispatchBoundary: true })` at
   `build-review-halt-render.ts`, where `seedBuildTaskTelemetry` now lives.

**Done when:**
- [test] `task-seed.test.ts` reads `engine/build-review-halt-render.ts` and finds `seedTaskStatus(projectRoot, planPath, undefined, { dispatchBoundary: true })`.
- [test] The existing tests that import `renderExhaustedMechanicalBuildReviewHalt` and `recordActivePlanPath` from `conductor.js` (including the dynamic `import()`) pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/build-review-halt-render.ts`, `src/conductor/src/engine/artifact-approvals.ts` — new
- `src/conductor/src/engine/conductor.ts` — remove, import, re-export
- `src/conductor/test/engine/task-seed.test.ts` — source path

**Verify-only:** yes

**Dependencies:** Task 7

### Task 9: Move finish-presentation repair and post-finish shipped record; extend containment
**Story:** Story 6 happy path 1; Story 6 negative paths 1–3; Story 5 happy paths 1, 3; Story 5 negative path 2; Story 3 happy path 2
**Type:** refactor

**Steps:**
1. Move group 12 into `src/conductor/src/engine/finish-presentation-repair.ts` and group 13 into
   `src/conductor/src/engine/post-finish-shipped-record.ts`, verbatim.
2. Re-export the names exported at base.
3. Migrate `src/conductor/src/daemon-cli.ts` and `src/conductor/src/index.ts` to import
   `createProvenanceGuardedFinishPresentationRepair` from `finish-presentation-repair.ts`. Both
   keep importing `Conductor` from `conductor.js`.
4. In `src/conductor/test/engine/finish-publication-production-wiring.test.ts`, point the source
   read for `export function createFinishPresentationRepair` at `finish-presentation-repair.ts`.
5. In `src/conductor/test/engine/daemon-state-refusal-event.test.ts`:
   - move the `createProvenanceGuardedFinishPresentationRepair` stub to a
     `vi.mock('…/finish-presentation-repair.js')`;
   - keep the `conductor.js` mock for `Conductor`;
   - assert that the stub was called, so a run where the real function loads fails.
6. In `src/conductor/test/engine/engineer/non-autonomy.test.ts`, add
   `engine/post-finish-shipped-record.ts` and `engine/finish-presentation-repair.ts` to the
   forbidden set. Add fixture cases:
   - an engineer module importing either one directly fails with a VIOLATION naming it;
   - an engineer module importing either one transitively fails the same way.
7. Walk the transitive static imports of every destination module except the two push-capable
   ones, and assert none reaches either push-capable module.

**Done when:**
- [test] `non-autonomy.test.ts` forbids `conductor.ts`, `post-finish-shipped-record.ts` (asserted to declare `pushPostFinishShippedRecord` and `refreshPostFinishShippedRecord`) and `finish-presentation-repair.ts` (asserted to declare `createFinishPresentationRepair` and `createProvenanceGuardedFinishPresentationRepair`), and passes on the real engineer import graph.
- [test] A fixture engineer module importing `post-finish-shipped-record.ts` (directly and via an intermediate module) or `finish-presentation-repair.ts` makes `non-autonomy.test.ts`'s walker report a VIOLATION naming that forbidden module.
- [test] `non-autonomy.test.ts` walks the transitive static imports of every destination module except the two push-capable ones and asserts none reaches `post-finish-shipped-record.ts` or `finish-presentation-repair.ts`.
- [test] `daemon-state-refusal-event.test.ts` mocks `finish-presentation-repair.js` and asserts the stub `createProvenanceGuardedFinishPresentationRepair` was invoked; `finish-publication-production-wiring.test.ts` finds `export function createFinishPresentationRepair` in `finish-presentation-repair.ts`.
- `daemon-cli.ts` imports `createProvenanceGuardedFinishPresentationRepair` and `OperatorParkedTermination` from their defining modules and only `Conductor` from `conductor.js`; `index.ts` imports only `Conductor` from `conductor.js`.

**Files likely touched:**
- `src/conductor/src/engine/finish-presentation-repair.ts`, `src/conductor/src/engine/post-finish-shipped-record.ts` — new
- `src/conductor/src/engine/conductor.ts` — remove, import, re-export
- `src/conductor/src/daemon-cli.ts`, `src/conductor/src/index.ts` — import paths
- `src/conductor/test/engine/finish-publication-production-wiring.test.ts`, `src/conductor/test/engine/daemon-state-refusal-event.test.ts`, `src/conductor/test/engine/engineer/non-autonomy.test.ts` — retargets and containment

**Dependencies:** Task 8

### Task 10: Sweep residual declarations and lock the real conductor.ts shape
**Story:** Story 1 happy paths 1–2; Story 1 negative path 5; Story 7 happy path 2
**Type:** refactor

**Steps:**
1. Compute the base: `BASE=$(git merge-base HEAD origin/main)`. List every top-level statement of
   `git show $BASE:src/conductor/src/engine/conductor.ts` with `checkConductorShape`, and write the
   declaration names, excluding the six class-only tunables, to `conductor-exports.json` under
   `moduleLevelAtBase`. This derives the inventory from the base the build actually rebased onto,
   so it includes declarations added by other lanes.
2. Move each declaration still in `conductor.ts` to the topical module its group rule assigns,
   re-exporting it only if it was exported at base. That includes `writeBuildOutcomeBestEffort`
   and anything an in-flight lane added.
3. In `src/conductor/test/structural/conductor-shape.test.ts`, add real-file tests:
   - `checkConductorShape` over `src/conductor/src/engine/conductor.ts` returns no violations;
   - every `moduleLevelAtBase` name is declared in exactly one module under
     `src/conductor/src/engine/` other than `conductor.ts`. Search every engine module, so a
     declaration routed to an additional topical module still counts. Map `appendRemediationTasks` to `appendConductorRemediationTasks` for
     this lookup, as the comparison helper does;
   - the six tunables are still declared in `conductor.ts`.
4. Add `src/conductor/test/structural/compare-moved-declarations.ts`. Given `BASE`, for each
   `moduleLevelAtBase` name it prints `<name>: identical` or `<name>: DIFFERENT`. It compares the
   declaration's text in base `conductor.ts` with its text in its HEAD destination module, after
   stripping a leading `export` modifier and nothing else. Treat the identifier
   `appendConductorRemediationTasks` as equal to `appendRemediationTasks`. Run it, and paste its
   full output in the commit body.
5. Paste the output of `checkConductorShape` over the base `conductor.ts` in the commit body. It
   must be a non-empty violation list, showing the guard rejects pre-change code.

**Done when:**
- [test] `conductor-shape.test.ts` runs `checkConductorShape` on the real `engine/conductor.ts` and gets zero violations (only imports, named re-exports, the six listed tunables and `class Conductor` remain), asserts each `moduleLevelAtBase` name is declared in exactly one module under `src/conductor/src/engine/` other than `conductor.ts` (searching every engine module, not a fixed list), and asserts the six tunables are still declared in `conductor.ts`.
- `conductor-exports.json`'s `moduleLevelAtBase` equals the non-tunable top-level declaration names that `checkConductorShape` lists for `git show $(git merge-base HEAD origin/main):src/conductor/src/engine/conductor.ts`, and the commit body records that command and its output.
- The commit body contains the full output of `compare-moved-declarations.ts` for the build's base, with every `moduleLevelAtBase` name reported `identical` (only the leading export modifier stripped; `appendConductorRemediationTasks` equated with `appendRemediationTasks`) and none reported `DIFFERENT`.
- The commit body contains a non-empty `checkConductorShape` violation list for the base `conductor.ts`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — residual moves
- destination modules under `src/conductor/src/engine/` — residual declarations
- `src/conductor/test/structural/conductor-shape.test.ts`, `src/conductor/test/structural/conductor-exports.json` — real-file assertions and the base inventory
- `src/conductor/test/structural/compare-moved-declarations.ts` — new comparison helper

**Dependencies:** Tasks 1, 2, 9

### Task 11: Retarget and widen every conductor.ts source-scan test
**Story:** Story 5 happy path 2; Story 5 negative paths 1, 3; Story 7 happy path 1
**Type:** negative-path

**Steps:**
1. Run `grep -rlE "conductor\.ts" src/conductor/test test bin hooks | xargs grep -lE "readFileSync|readFile\(|cat |sed |grep "`.
   Classify each hit in a table in the commit body:
   - **positive:** expects moved code to be present; retarget it to the defining module;
   - **negative:** `not.toContain`, `not.toMatch`, `toEqual([])` or an absence check; widen it;
   - **unaffected:** reads only class code.
2. Add an exported `CONDUCTOR_DECOMPOSED_MODULES` that is computed: `conductor.ts` plus every
   engine module that declares a `moduleLevelAtBase` name to `src/conductor/test/structural/conductor-shape-guard.ts`. Change every
   negative scan to iterate over it instead of `conductor.ts` alone. That covers, for example,
   `src/conductor/test/engine/no-operator-credential-coupling.test.ts` and
   `src/conductor/test/engine/provider-id-literals.test.ts`, whose scanned-module list is keyed
   on `engine/conductor.ts`.
3. For each widened negative scan, add a planted-pattern case: the scan's checker, run on an
   in-memory copy of one destination module with the forbidden pattern inserted, reports it.
4. Confirm no test was deleted or skipped:
   - `git diff --diff-filter=D --name-only <base>...HEAD -- src/conductor/test` is empty;
   - `git diff <base>...HEAD -- src/conductor/test | grep -E '^\+.*\.(skip|todo)\('` is empty.

**Done when:**
- The commit body lists every file returned by the step 1 search, each classified as positive, negative or unaffected, and an independent second search (`grep -rlE "conductor(\.ts)?['\"/]" src/conductor/test test bin hooks`, all file types) finds no file that reads `conductor.ts` source and is missing from that list; every positive-classified test reads the module that now defines the code it expects and passes.
- [test] `CONDUCTOR_DECOMPOSED_MODULES` is asserted to equal `conductor.ts` plus every engine module that declares a `moduleLevelAtBase` name (computed, so it includes the 13 planned destinations and any additional topical module), and every negative scan classified in step 1 (including `no-operator-credential-coupling.test.ts` and `provider-id-literals.test.ts`) iterates it, with a planted-pattern case reporting the forbidden pattern inserted into a destination module.
- `git diff --diff-filter=D --name-only <base>...HEAD -- src/conductor/test` and the added-`.skip(`/`.todo(` search print nothing; every test file in `git diff --name-only <base>...HEAD -- src/conductor/test` appears in the commit-body table as a retarget, widen, mock-extension or new guard test; and every removed `expect(` line has a retargeted replacement in the same hunk, listed in that table.
- The `test_suite` gate's aggregate run (the `src/conductor` vitest suite plus `test/test_harness_integrity.sh`) passes on the feature head.
- [test] Tests whose mocked module graph now reaches a destination module (the step-runners, kickback-budget-cli, daemon-observe-cli and daemon-cli tests) pass with no `No "…" export is defined on the mock` error, because every whole-module `vi.mock` factory without `importOriginal` that the move reaches is extended or retargeted to define each export the code under test uses.

**Files likely touched:**
- `src/conductor/test/structural/conductor-shape-guard.ts` — `CONDUCTOR_DECOMPOSED_MODULES`
- `src/conductor/test/engine/no-operator-credential-coupling.test.ts`, `src/conductor/test/engine/provider-id-literals.test.ts` — widened scans
- other source-scan tests under `src/conductor/test/` listed by the step 1 inventory

**Dependencies:** Task 10

### Task 12: Lock the real import graph, re-export identity and isolated loading
**Story:** Story 2 happy path 2; Story 3 happy path 1; Story 3 negative path 3; Story 7 negative path 1
**Type:** refactor

**Steps:**
1. In `src/conductor/test/structural/conductor-shape.test.ts`, run `checkConductorImports` over
   every `src/conductor/src/**/*.ts`, with allowed importers `index.ts` and `daemon-cli.ts` and
   the allowed name `Conductor`.
2. In the same file, for each of these importers:
   - `step-runners.ts`
   - `group-core.ts`
   - `finish-publication-production.ts`
   - `self-host/build-auth-preflight.ts`
   - `daemon-deps.ts`
   - `daemon-runner.ts`
   - `ui/types.ts`
   - `ui/terminal/prompt-host.ts`
   - `engine/kickback-budget-cli.ts`
   - `engine/daemon-observe-cli.ts`

   use a `ts.Program` and the checker to resolve each imported name that is in
   `moduleLevelAtBase` to its declaration. Assert that the declaration's source file is in
   `CONDUCTOR_DECOMPOSED_MODULES` and is not `conductor.ts`, and that the import specifier names that same file.
3. In `src/conductor/test/structural/conductor-export-surface.test.ts`, add identity checks:
   `buildRetryHint`, `findResumeIndex`, `recordActivePlanPath` and `toSpotAuditVerifierResult`
   from `conductor.js` (the last via dynamic `import()`) are the same objects as those exported by
   their defining modules.
4. Add `src/conductor/test/structural/destination-isolated-import.test.ts`. For each destination
   module it runs `vi.resetModules()` first, then imports that module alone and asserts that each of its
   exported module-level constants is not `undefined`.

**Done when:**
- [test] `conductor-shape.test.ts` runs `checkConductorImports` over all of `src/conductor/src` and gets zero violations, so only `index.ts` and `daemon-cli.ts` import `conductor.js` and only `Conductor`, and none of the modules in `CONDUCTOR_DECOMPOSED_MODULES` other than `conductor.ts` imports `conductor.js` as a value or a type.
- [test] `conductor-shape.test.ts` resolves every moved name imported by the ten listed importers to a declaration in a module of `CONDUCTOR_DECOMPOSED_MODULES` other than `conductor.ts`, and asserts the import specifier names that declaring module directly.
- [test] `conductor-export-surface.test.ts` asserts that `buildRetryHint`, `findResumeIndex`, `recordActivePlanPath` and `toSpotAuditVerifierResult` (via dynamic `import()`) from `conductor.js` are the same objects as those of their defining modules.
- [test] `destination-isolated-import.test.ts` calls `vi.resetModules()` before importing each module of `CONDUCTOR_DECOMPOSED_MODULES` other than `conductor.ts`, imports it alone, and finds every exported module-level constant defined.

**Files likely touched:**
- `src/conductor/test/structural/conductor-shape.test.ts`, `src/conductor/test/structural/conductor-export-surface.test.ts` — real-graph and identity assertions
- `src/conductor/test/structural/destination-isolated-import.test.ts` — new

**Dependencies:** Task 10

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the post-change checkout, when the conductor-shape guard parses `engine/conductor.ts`, then the guard passes, because every top-level statement is an import declaration, a named `export { … } from` or `export type { … } from` re-export (including the existing `export type { SchedulingUnitRef } from`), one of the listed class-only tunables (`MAX_RECOVERY_RETRIES`, `MAX_RATE_LIMIT_DEADLINE_MS`, `PUBLICATION_REDISPATCH_BUDGET`, `MAX_GATE_SELECTIONS`, `DONE_MARKER`, `LOOP_HALT_MARKER`, exported or not), or the `class Conductor` declaration. | 10 | "`conductor-shape.test.ts` runs `checkConductorShape` on the real `engine/conductor.ts` and gets zero violations (only imports, named re-exports, the six listed tunables and `class Conductor` remain), asserts each `moduleLevelAtBase` name is declared in exactly one module under `src/conductor/src/engine/` other than `conductor.ts` (searching every engine module, not a fixed list), and asserts the six tunables are still declared in `conductor.ts`." | diff-local |
| Story 1 happy: Given the post-change checkout, when each declaration other than the listed class-only tunables that existed outside `class Conductor` at BUILD's rebased base is looked up (the inventory is re-derived from that base, not frozen at authoring), then it is declared in exactly one engine module other than `conductor.ts`. This includes `writeBuildOutcomeBestEffort`, which sat among the imports, and `MAX_KICKBACKS_PER_GATE`. | 10 | "`conductor-shape.test.ts` runs `checkConductorShape` on the real `engine/conductor.ts` and gets zero violations (only imports, named re-exports, the six listed tunables and `class Conductor` remain), asserts each `moduleLevelAtBase` name is declared in exactly one module under `src/conductor/src/engine/` other than `conductor.ts` (searching every engine module, not a fixed list), and asserts the six tunables are still declared in `conductor.ts`." | diff-local |
| Story 1 negative: Given guard input source containing a top-level function declaration, when the guard checks it, then the guard rejects it and names the function and its line. | 1 | "`checkConductorShape` returns a violation naming the function and its line for a top-level `function` fixture, and one naming the const for a non-listed `const` fixture, as asserted in `conductor-shape.test.ts`." | diff-local |
| Story 1 negative: Given guard input source containing a top-level `const` whose name is not in the class-only tunables list, when the guard checks it, then it rejects it and names that const. | 1 | "`checkConductorShape` returns a violation naming the function and its line for a top-level `function` fixture, and one naming the const for a non-listed `const` fixture, as asserted in `conductor-shape.test.ts`." | diff-local |
| Story 1 negative: Given guard input source containing `export * from './x.js'` or `export default …`, when the guard checks it, then it rejects it, because a wildcard or default export would silently widen the `conductor.js` surface. | 1 | "`checkConductorShape` returns violations for `export *`, `export default`, `export =`, a local `export { X }` without `from`, `type`, `interface`, `enum`, `namespace`, `declare`, `let`/`var`, a second top-level `class`, and expression-statement fixtures, each naming the statement kind and line, and none for the allowed-statements fixture." | diff-local |
| Story 1 negative: Given guard input source containing a top-level `type`, `interface`, `enum`, `namespace`, or a bare expression statement, when the guard checks it, then it rejects it and names the kind and its line. | 1 | "`checkConductorShape` returns violations for `export *`, `export default`, `export =`, a local `export { X }` without `from`, `type`, `interface`, `enum`, `namespace`, `declare`, `let`/`var`, a second top-level `class`, and expression-statement fixtures, each naming the statement kind and line, and none for the allowed-statements fixture." | diff-local |
| Story 1 negative: Given a moved declaration in its new module, when that module is checked for duplicates, then no declaration of the same name remains in `conductor.ts`. | 10 | "`conductor-shape.test.ts` runs `checkConductorShape` on the real `engine/conductor.ts` and gets zero violations (only imports, named re-exports, the six listed tunables and `class Conductor` remain), asserts each `moduleLevelAtBase` name is declared in exactly one module under `src/conductor/src/engine/` other than `conductor.ts` (searching every engine module, not a fixed list), and asserts the six tunables are still declared in `conductor.ts`." | diff-local |
| Story 2 happy: Given a committed list of the names `conductor.ts` exports at BUILD's rebased base (values and types), when a test compares it with the module's exports as resolved by the TypeScript checker, then the two sets are equal. BUILD derives the list from the base it actually rebases onto, so the list stays correct even when another lane changes `conductor.ts` first. | 2 | "The checker-resolved export set of `engine/conductor.ts` equals `conductor-exports.json` exactly (empty `missing` and `extra`)." | diff-local |
| Story 2 happy: Given a test that value-imports an exported moved function from `engine/conductor.js`, such as `buildRetryHint`, `findResumeIndex`, `recordActivePlanPath`, or `toSpotAuditVerifierResult` through dynamic `import()`, when it runs, then it receives the same function object that the defining module exports. | 12 | "`conductor-export-surface.test.ts` asserts that `buildRetryHint`, `findResumeIndex`, `recordActivePlanPath` and `toSpotAuditVerifierResult` (via dynamic `import()`) from `conductor.js` are the same objects as those of their defining modules." | diff-local |
| Story 2 happy: Given `remediation-append-land-shape.test.ts`, which imports `appendRemediationTasks` from `engine/conductor.js`, when it runs post-change, then it resolves the conductor variant under that original name. This holds even though the defining module exports the function under a clash-free name, because the shim re-exports it as `appendRemediationTasks`. | 6 | "`remediation-append-land-shape.test.ts` passes unchanged while importing `appendRemediationTasks` from `engine/conductor.js`." | diff-local |
| Story 2 negative: Given a name dropped from the shim, when the exported-names test runs, then it fails and names the missing export. This holds even where a test's dynamic import is cast, so `tsc` alone would not catch it. | 2 | "`diffExportSurface` reports a dropped name in `missing` and an added name in `extra`, naming each, as asserted in `conductor-export-surface.test.ts`." | diff-local |
| Story 2 negative: Given a name added to the shim that was not exported before, when the exported-names test runs, then it fails and names the extra export. | 2 | "`diffExportSurface` reports a dropped name in `missing` and an added name in `extra`, naming each, as asserted in `conductor-export-surface.test.ts`." | diff-local |
| Story 2 negative: Given a class-only helper that was not exported at BUILD's base (for example `formatRejectedDispositions`, or whichever non-exported helper exists at that base), when the export-surface test resolves the exports of `conductor.ts` through the TypeScript checker, then that helper's name is absent from them, so the `conductor.js` surface did not widen. | 2 | "Every name in `nonExportedAtBase` is absent from the checker-resolved exports of `engine/conductor.ts`." | diff-local |
| Story 2 negative: Given a type-only moved name, when `conductor.ts` re-exports it, then it uses `export type`, and compiling under `isolatedModules` raises no "re-exporting a type" error. | 3 | "`npm run typecheck` (tsc with `noUnusedLocals` and `isolatedModules`) exits 0, which shows every moved type-only name is re-exported with `export type`." | diff-local |
| Story 3 happy: Given the post-change `src/` tree, when its imports are inspected, then only `index.ts` and `daemon-cli.ts` import `engine/conductor.js`, and each imports only `Conductor`. Every other importer (`step-runners.ts`, `group-core.ts`, `finish-publication-production.ts`, `self-host/build-auth-preflight.ts`, `daemon-deps.ts`, `daemon-runner.ts`, `ui/types.ts`, `ui/terminal/prompt-host.ts`, `engine/kickback-budget-cli.ts`, `engine/daemon-observe-cli.ts`) imports its values and types from the defining modules. | 12 | "`conductor-shape.test.ts` resolves every moved name imported by the ten listed importers to a declaration in a module of `CONDUCTOR_DECOMPOSED_MODULES` other than `conductor.ts`, and asserts the import specifier names that declaring module directly." | diff-local |
| Story 3 happy: Given `daemon-cli.ts`, when its imports are inspected, then `OperatorParkedTermination` and `createProvenanceGuardedFinishPresentationRepair` come from their defining modules. | 9 | "`daemon-cli.ts` imports `createProvenanceGuardedFinishPresentationRepair` and `OperatorParkedTermination` from their defining modules and only `Conductor` from `conductor.js`; `index.ts` imports only `Conductor` from `conductor.js`." | diff-local |
| Story 3 happy: Given `engine/kickback-budget-cli.ts` and `engine/daemon-observe-cli.ts`, when they compute the PRD-audit append cap for a given config, then they import `prdAuditAppendCap` from its defining module and report the same cap values as before. | 4, 12 | "`remediation-caps.test.ts` runs the cap-reporting path of `kickback-budget-cli.ts` and of `daemon-observe-cli.ts` with the real `remediation-caps.ts` (no mock), for the default config and for a config overriding every `prd_audit.*` cap key, and asserts each CLI reports exactly the PRD-audit append cap values recorded from the base in step 5; the existing CLI tests pass, edited only to extend a whole-module mock factory or retarget it to the module the CLI now imports from." | diff-local |
| Story 3 negative: Given a production module other than `index.ts` or `daemon-cli.ts` that imports `engine/conductor.js`, whether as a value or a type and with any quote style, when the guard runs, then it fails and names the importing file. | 1 | "`checkConductorImports` returns a violation naming the importing file for value, `import type` and double-quoted imports of `conductor.js` from a non-allowed module, including a destination-module fixture importing it type-only." | diff-local |
| Story 3 negative: Given `index.ts` or `daemon-cli.ts` importing any name other than `Conductor` from `engine/conductor.js`, when the guard runs, then it fails and names the extra import. | 1 | "`checkConductorImports` returns a violation naming the extra name for an `index.ts` fixture importing `{ Conductor, buildRetryHint }` and for a `daemon-cli.ts` fixture importing `{ Conductor, OperatorParkedTermination }`, and none when both allowed importers import only `Conductor`." | diff-local |
| Story 3 negative: Given any destination module created by this change, when its imports are inspected, then none imports `engine/conductor.js`, whether as a value or a type. | 1, 12 | "`conductor-shape.test.ts` runs `checkConductorImports` over all of `src/conductor/src` and gets zero violations, so only `index.ts` and `daemon-cli.ts` import `conductor.js` and only `Conductor`, and none of the modules in `CONDUCTOR_DECOMPOSED_MODULES` other than `conductor.ts` imports `conductor.js` as a value or a type." | diff-local |
| Story 4 happy: Given `buildRetryHint` and `buildRemediationHint` in their new module, when the session-command audit evaluates that module's source, then it treats those symbols as managed dispatch prompt surfaces. It reports an operator-only instruction inside them exactly as it did when they lived in `conductor.ts`. | 5 | "The audit reports a managed-dispatch violation for an operator-only session-command reference injected into `buildRetryHint`'s prompt text, and separately into `buildRemediationHint`'s prompt text, in `remediation-hints.ts`, as asserted in `session-command-audit-integration.test.ts`." | diff-local |
| Story 4 happy: Given the existing session-command-audit integration test that reads the `=managed` markers, when it runs against the post-change tree, then it finds those markers in the new defining module and passes. | 5 | "`session-command-audit-integration.test.ts` finds the `=managed` markers in `remediation-hints.ts`, and its "registers only declarations that exist" test passes; it would fail if the entry still named `conductor.ts`." | diff-local |
| Story 4 negative: Given an operator-only session-command reference injected into `buildRetryHint`'s prompt text in the new module, when the audit runs, then it reports the managed-dispatch violation instead of passing silently. | 5 | "The audit reports a managed-dispatch violation for an operator-only session-command reference injected into `buildRetryHint`'s prompt text, and separately into `buildRemediationHint`'s prompt text, in `remediation-hints.ts`, as asserted in `session-command-audit-integration.test.ts`." | diff-local |
| Story 4 negative: Given the `MANAGED_DISPATCH_PROMPT_SURFACES` entry still named `conductor.ts` for `buildRetryHint`/`buildRemediationHint`, when the existing integration test runs ("registers only declarations that exist…"), then it fails. The entry must name the defining module for the test to pass. | 5 | "`session-command-audit-integration.test.ts` finds the `=managed` markers in `remediation-hints.ts`, and its "registers only declarations that exist" test passes; it would fail if the entry still named `conductor.ts`." | diff-local |
| Story 5 happy: Given a positive source-scan test that expects moved code in `conductor.ts`, when it runs post-change, then it reads the module that now defines that code and passes. Examples are `finish-publication-production-wiring.test.ts` (`createFinishPresentationRepair`) and `task-seed.test.ts` (`seedTaskStatus(…, { dispatchBoundary: true })`). | 8, 9, 11 | "The commit body lists every file returned by the step 1 search, each classified as positive, negative or unaffected, and an independent second search (`grep -rlE "conductor(\.ts)?['\"/]" src/conductor/test test bin hooks`, all file types) finds no file that reads `conductor.ts` source and is missing from that list; every positive-classified test reads the module that now defines the code it expects and passes." | diff-local |
| Story 5 happy: Given a negative source-scan test that asserts a pattern is absent from `conductor.ts`, when it runs post-change, then its scanned set covers every new destination module as well as `conductor.ts`. Examples are `no-operator-credential-coupling.test.ts` and `provider-id-literals.test.ts`. | 11 | "`CONDUCTOR_DECOMPOSED_MODULES` is asserted to equal `conductor.ts` plus every engine module that declares a `moduleLevelAtBase` name (computed, so it includes the 13 planned destinations and any additional topical module), and every negative scan classified in step 1 (including `no-operator-credential-coupling.test.ts` and `provider-id-literals.test.ts`) iterates it, with a planted-pattern case reporting the forbidden pattern inserted into a destination module." | diff-local |
| Story 5 happy: Given `daemon-state-refusal-event.test.ts`, which stubs `createProvenanceGuardedFinishPresentationRepair`, when it runs post-change, then the stub is installed on the module `daemon-cli.ts` now imports from, and `daemon-cli.ts` receives the stub. | 9 | "`daemon-state-refusal-event.test.ts` mocks `finish-presentation-repair.js` and asserts the stub `createProvenanceGuardedFinishPresentationRepair` was invoked; `finish-publication-production-wiring.test.ts` finds `export function createFinishPresentationRepair` in `finish-presentation-repair.ts`." | diff-local |
| Story 5 happy: Given `test/engine/config-consumer-registry.ts`, when it is read post-change, then the `prd_audit.*` and `kickback_escalation` keys map to the modules that now consume them. | 4 | "`config-consumer-registry.test.ts` passes with the `prd_audit.*` and `kickback_escalation` entries naming the modules that now consume them." | diff-local |
| Story 5 negative: Given a negative source-scan test whose forbidden pattern is planted in a moved helper's new module, when the test runs, then it fails, proving the widened scan reaches moved code. | 11 | "`CONDUCTOR_DECOMPOSED_MODULES` is asserted to equal `conductor.ts` plus every engine module that declares a `moduleLevelAtBase` name (computed, so it includes the 13 planned destinations and any additional topical module), and every negative scan classified in step 1 (including `no-operator-credential-coupling.test.ts` and `provider-id-literals.test.ts`) iterates it, with a planted-pattern case reporting the forbidden pattern inserted into a destination module." | diff-local |
| Story 5 negative: Given the stubbed repair function in `daemon-state-refusal-event.test.ts`, when the test checks that the stub was used, then a run in which the real function loads instead fails that check. | 9 | "`daemon-state-refusal-event.test.ts` mocks `finish-presentation-repair.js` and asserts the stub `createProvenanceGuardedFinishPresentationRepair` was invoked; `finish-publication-production-wiring.test.ts` finds `export function createFinishPresentationRepair` in `finish-presentation-repair.ts`." | diff-local |
| Story 5 negative: Given a test whose mocked module graph now reaches a destination module, when it runs, then it passes with no "No export … defined on mock" error. Mock factories that replace a whole module without `importOriginal` are extended or retargeted so that every export the code under test uses is defined. Affected tests include those of `step-runners`, `kickback-budget-cli`, `daemon-observe-cli`, and `daemon-cli`. | 11 | "Tests whose mocked module graph now reaches a destination module (the step-runners, kickback-budget-cli, daemon-observe-cli and daemon-cli tests) pass with no `No "…" export is defined on the mock` error, because every whole-module `vi.mock` factory without `importOriginal` that the move reaches is extended or retargeted to define each export the code under test uses." | diff-local |
| Story 6 happy: Given the post-change tree, when `non-autonomy.test.ts` runs, then its forbidden set includes `conductor.ts` and the modules that now define `pushPostFinishShippedRecord`, `refreshPostFinishShippedRecord`, `createFinishPresentationRepair` and `createProvenanceGuardedFinishPresentationRepair`, and the engineer's transitive static import graph reaches none of them. | 9 | "`non-autonomy.test.ts` forbids `conductor.ts`, `post-finish-shipped-record.ts` (asserted to declare `pushPostFinishShippedRecord` and `refreshPostFinishShippedRecord`) and `finish-presentation-repair.ts` (asserted to declare `createFinishPresentationRepair` and `createProvenanceGuardedFinishPresentationRepair`), and passes on the real engineer import graph." | diff-local |
| Story 6 negative: Given an engineer module that imports the new post-finish shipped-record module, directly or transitively, when `non-autonomy.test.ts` runs, then it fails with a VIOLATION naming that forbidden module. | 9 | "A fixture engineer module importing `post-finish-shipped-record.ts` (directly and via an intermediate module) or `finish-presentation-repair.ts` makes `non-autonomy.test.ts`'s walker report a VIOLATION naming that forbidden module." | diff-local |
| Story 6 negative: Given an engineer module that imports the new finish-presentation-repair module, when the test runs, then it fails in the same way. | 9 | "A fixture engineer module importing `post-finish-shipped-record.ts` (directly and via an intermediate module) or `finish-presentation-repair.ts` makes `non-autonomy.test.ts`'s walker report a VIOLATION naming that forbidden module." | diff-local |
| Story 6 negative: Given the moved type-only and pure-helper modules, such as `step-runner-types` and `remediation-caps`, when their imports are inspected, then none of them imports a push-capable destination module. An engineer type import of those modules therefore raises no containment violation. | 9 | "`non-autonomy.test.ts` walks the transitive static imports of every destination module except the two push-capable ones and asserts none reaches `post-finish-shipped-record.ts` or `finish-presentation-repair.ts`." | diff-local |
| Story 7 happy: Given the post-change tree, when the full `src/conductor` suite and `test/test_harness_integrity.sh` run, then they pass, and no test has been deleted, skipped, or weakened. The only differences are the retargets and widenings in Stories 4–6. | 11 | "The `test_suite` gate's aggregate run (the `src/conductor` vitest suite plus `test/test_harness_integrity.sh`) passes on the feature head." | diff-local |
| Story 7 happy: Given each moved declaration, when its text at merge-base is compared with its text at HEAD with the `export` modifier removed, then the two are identical. The one exception is the identifier of the renamed `appendRemediationTasks`. This comparison is BUILD evidence: a per-declaration result recorded in the delivering task's commit body, as the plan specifies. | 10 | "The commit body contains the full output of `compare-moved-declarations.ts` for the build's base, with every `moduleLevelAtBase` name reported `identical` (only the leading export modifier stripped; `appendConductorRemediationTasks` equated with `appendRemediationTasks`) and none reported `DIFFERENT`." | diff-local |
| Story 7 happy: Given `isEngineComputedStep` after `AGENT_DISPATCHING_ENGINE_NATIVE_STEPS` moves, when it is called with `'test_suite'` and with `'build_review'`, then it returns `true` and `false` respectively, as before. A test pins this without exporting the set. | 7 | "`step-completion.test.ts` asserts that `isEngineComputedStep` from `step-completion.ts` returns `true` for `'test_suite'` and `false` for `'build_review'`." | diff-local |
| Story 7 negative: Given a destination module that exports module-level constants, when that module is imported on its own in a fresh module graph, then every exported constant is defined. No temporal-dead-zone or load-order `undefined` comes from an import cycle. | 12 | "`destination-isolated-import.test.ts` calls `vi.resetModules()` before importing each module of `CONDUCTOR_DECOMPOSED_MODULES` other than `conductor.ts`, imports it alone, and finds every exported module-level constant defined." | diff-local |
| Story 7 negative: Given a moved helper that needs a constant shared with the class (`MAX_KICKBACKS_PER_GATE`), when the move is made, then the constant moves with the helper and `conductor.ts` imports it, so no cycle runs through `conductor.ts`. | 4 | "`remediation-caps.ts` declares `MAX_KICKBACKS_PER_GATE` and `prdAuditAppendCap`, `conductor.ts` imports `MAX_KICKBACKS_PER_GATE` from `./remediation-caps.js` so no cycle runs through `conductor.ts`, and `kickback-budget-cli.ts` and `daemon-observe-cli.ts` import `prdAuditAppendCap` with the specifier `./remediation-caps.js`." | diff-local |
| Story 7 negative: Given the renamed conductor variant of `appendRemediationTasks` and the existing `remediation-append.ts` export of the same name, when both are imported in one test, then they are distinct functions, and each keeps its own behavior as before. | 6 | "`remediation-task-append-identity.test.ts` asserts that `conductor.js`'s `appendRemediationTasks` is the same function as `remediation-task-append.ts`'s `appendConductorRemediationTasks` and is not the same as `remediation-append.ts`'s `appendRemediationTasks`." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-07-conductor-decomposition-target-architecture#D1 | no-change | none | Target shape for roadmap slices 5 and 7 (generated step registry and per-step slice directories); this feature adds no step slice or generated table. |
| adr-2026-10-07-conductor-decomposition-target-architecture#D2 | no-change | none | Constrains future step discovery to compile-time and in-tree; this feature adds no step discovery or plugin kind. |
| adr-2026-10-07-conductor-decomposition-target-architecture#D3 | no-change | none | The model-table single-source amendment belongs to roadmap slice 5; this feature does not touch `STEP_RATIONALE` or `model-table-metadata.ts`. |
| adr-2026-10-07-conductor-decomposition-target-architecture#D4 | no-change | none | `run()` phase extraction is roadmap slice 6; this feature changes only import paths and the one renamed call (`appendConductorRemediationTasks`) inside `class Conductor`, and leaves `run()`'s control flow untouched. |
| adr-2026-10-07-conductor-decomposition-target-architecture#D5 | no-change | none | The import-graph ratchet is roadmap slice 2; this feature adds only the refactor-invariant guard tests (review C4), not the layer ratchet. |
| adr-2026-10-07-conductor-decomposition-target-architecture#D6 | no-change | none | The single git port is roadmap slice 4; this feature moves no git execution code between port shapes. |
| adr-2026-10-07-conductor-decomposition-target-architecture#D7 | no-change | none | Records roadmap order; this feature is slice 1, and slices 2–9 are tracked by separate issues outside this build. |
| adr-2026-10-07-conductor-decomposition-target-architecture#D8 | task | task-1, task-2, task-4, task-5, task-9, task-10, task-11, task-12 | `conductor-shape.test.ts` runs `checkConductorShape` on the real `engine/conductor.ts` and gets zero violations (only imports, named re-exports, the six listed tunables and `class Conductor` remain), asserts each `moduleLevelAtBase` name is declared in exactly one module under `src/conductor/src/engine/` other than `conductor.ts` (searching every engine module, not a fixed list), and asserts the six tunables are still declared in `conductor.ts`. |

## Task Dependency Graph

```
Task 1 <- none
Task 2 <- none
Task 3 <- Task 2
Task 4 <- Task 3
Task 5 <- Task 4
Task 6 <- Task 5
Task 7 <- Task 6
Task 8 <- Task 7
Task 9 <- Task 8
Task 10 <- Tasks 1, 2, 9
Task 11 <- Task 10
Task 12 <- Task 10
```

Tasks 3–10 form a serial chain; Tasks 11 and 12 run in parallel after Task 10. The chain is serial because each one edits `src/conductor/src/engine/conductor.ts`.

## Integration Points

- **After Task 3:** every production type importer resolves from the defining modules, and `tsc`
  proves the shim covers today's type surface.
- **After Task 5:** the managed-dispatch audit gate runs against the relocated prompt builders.
- **After Task 9:** the daemon entry point (`daemon-cli.ts`) wires the finish repair from its new
  module, and engineer containment covers it.
- **After Task 10:** the shape and import guards lock the end state against regrowth from rebased
  lanes.

## Verification

- [ ] All happy-path and negative-path criteria are covered (41 rows in the Coverage Check).
- [ ] Every task has a `Done when:` block of falsifiable checks, each on one line.
- [ ] Dependencies are explicit and acyclic.
- [ ] No terminal catch-all validation task: Task 11 owns the concrete source-scan retarget and widen work.
- [ ] Independent coverage (§7a) and contradiction (§7b) judgements have passed.
