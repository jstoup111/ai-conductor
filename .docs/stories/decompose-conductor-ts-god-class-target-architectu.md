**Status:** Accepted

# Stories: Move conductor.ts module-level code into topical engine modules (#1481, feature 1)

Technical track (no PRD). Source: jstoup111/ai-conductor#1481. Tier: M. Change class: refactor.
Governing decision: adr-2026-10-07-conductor-decomposition-target-architecture D8. Architecture
review conditions: C1–C6a.

**Intent.** Every declaration in `src/conductor/src/engine/conductor.ts` that sits outside
`class Conductor` moves into a topical engine module. After the move, `conductor.ts` keeps three
things:

- the class;
- the class-only tunables;
- a re-export of exactly the names it exports today.

Collaborators stop depending on the god module. Every gate and test that located code by the
`conductor.ts` file keeps guarding that code at its new home. Observable behavior is unchanged.

**New tests.** The new tests named below are regression guards for this refactor's own invariants
(review C4). They are not new pipeline gates.

## Story 1: conductor.ts holds only the class, its tunables, and the compatibility re-exports

As a contributor reading the conductor, I want `conductor.ts` to contain only `class Conductor`
and what it strictly needs, so that I can find a helper's governing code in a topical module
without paging through the class's file.

### Acceptance Criteria

#### Happy Path
- Given the post-change checkout, when the conductor-shape guard parses `engine/conductor.ts`,
  then the guard passes, because every top-level statement is an import declaration, a named
  `export { … } from` or `export type { … } from` re-export (including the existing
  `export type { SchedulingUnitRef } from`), one of the listed class-only tunables
  (`MAX_RECOVERY_RETRIES`, `MAX_RATE_LIMIT_DEADLINE_MS`, `PUBLICATION_REDISPATCH_BUDGET`,
  `MAX_GATE_SELECTIONS`, `DONE_MARKER`, `LOOP_HALT_MARKER`, exported or not), or the
  `class Conductor` declaration.
- Given the post-change checkout, when each declaration other than the listed class-only tunables
  that existed outside `class Conductor` at BUILD's rebased base is looked up (the inventory is re-derived from that base, not frozen at
  authoring), then it is declared in exactly one engine module other than
  `conductor.ts`. This includes `writeBuildOutcomeBestEffort`, which sat among the imports, and
  `MAX_KICKBACKS_PER_GATE`.

#### Negative Paths
- Given guard input source containing a top-level function declaration, when the guard checks
  it, then the guard rejects it and names the function and its line.
- Given guard input source containing a top-level `const` whose name is not in the class-only
  tunables list, when the guard checks it, then it rejects it and names that const.
- Given guard input source containing `export * from './x.js'` or `export default …`, when the
  guard checks it, then it rejects it, because a wildcard or default export would silently widen
  the `conductor.js` surface.
- Given guard input source containing a top-level `type`, `interface`, `enum`, `namespace`, or a
  bare expression statement, when the guard checks it, then it rejects it and names the kind and
  its line.
- Given a moved declaration in its new module, when that module is checked for duplicates, then
  no declaration of the same name remains in `conductor.ts`.

### Done When
- [ ] The conductor-shape guard exists, takes source text as input, and passes on the post-change
      `conductor.ts`.
- [ ] Unit fixtures prove the guard rejects each forbidden statement kind listed above.
- [ ] BUILD evidence: running the guard once on the pre-change `conductor.ts` rejects it.
- [ ] `tsc` passes, with `noUnusedLocals` and `isolatedModules` left unchanged.

## Story 2: Names exported today stay importable from conductor.js, and nothing is added

As the maintainer of about 197 test files that import from `conductor.js`, I want every name it
exports today to keep resolving from that path. Then the move needs no churn in test imports and
creates no merge conflicts with in-flight lanes.

### Acceptance Criteria

#### Happy Path
- Given a committed list of the names `conductor.ts` exports at BUILD's rebased base (values and
  types), when a test compares it with the module's exports as resolved by the TypeScript checker,
  then the two sets are equal. BUILD derives the list from the base it actually rebases onto, so
  the list stays correct even when another lane changes `conductor.ts` first.
- Given a test that value-imports an exported moved function from `engine/conductor.js`, such as
  `buildRetryHint`, `findResumeIndex`, `recordActivePlanPath`, or `toSpotAuditVerifierResult`
  through dynamic `import()`, when it runs, then it receives the same function object that the
  defining module exports.
- Given `remediation-append-land-shape.test.ts`, which imports `appendRemediationTasks` from
  `engine/conductor.js`, when it runs post-change, then it resolves the conductor variant under
  that original name. This holds even though the defining module exports the function under a
  clash-free name, because the shim re-exports it as `appendRemediationTasks`.

#### Negative Paths
- Given a name dropped from the shim, when the exported-names test runs, then it fails and names
  the missing export. This holds even where a test's dynamic import is cast, so `tsc` alone would
  not catch it.
- Given a name added to the shim that was not exported before, when the exported-names test
  runs, then it fails and names the extra export.
- Given a class-only helper that was not exported at BUILD's base (for example
  `formatRejectedDispositions`, or whichever non-exported helper exists at that base), when the
  export-surface test resolves the exports of `conductor.ts` through the TypeScript checker, then
  that helper's name is absent from them, so the `conductor.js` surface did not widen.
- Given a type-only moved name, when `conductor.ts` re-exports it, then it uses `export type`, and
  compiling under `isolatedModules` raises no "re-exporting a type" error.

### Done When
- [ ] The committed export-name list and its checker-based comparison test exist and pass.
- [ ] No test file's import from `engine/conductor.js` changed because a name moved. The only
      exceptions are the source-scan and mock retargets in Story 5.
- [ ] `tsc` and the full suite pass.

## Story 3: Production code imports moved code from its defining module

As a contributor tracing dependencies, I want production modules to import helpers and types
from where they are defined, so that extracted collaborators no longer depend back on the
conductor module.

### Acceptance Criteria

#### Happy Path
- Given the post-change `src/` tree, when its imports are inspected, then only `index.ts` and
  `daemon-cli.ts` import `engine/conductor.js`, and each imports only `Conductor`. Every other
  importer (`step-runners.ts`, `group-core.ts`, `finish-publication-production.ts`,
  `self-host/build-auth-preflight.ts`, `daemon-deps.ts`, `daemon-runner.ts`, `ui/types.ts`,
  `ui/terminal/prompt-host.ts`, `engine/kickback-budget-cli.ts`, `engine/daemon-observe-cli.ts`)
  imports its values and types from the defining modules.
- Given `daemon-cli.ts`, when its imports are inspected, then `OperatorParkedTermination` and
  `createProvenanceGuardedFinishPresentationRepair` come from their defining modules.
- Given `engine/kickback-budget-cli.ts` and `engine/daemon-observe-cli.ts`, when they compute the
  PRD-audit append cap for a given config, then they import `prdAuditAppendCap` from its defining
  module and report the same cap values as before.

#### Negative Paths
- Given a production module other than `index.ts` or `daemon-cli.ts` that imports
  `engine/conductor.js`, whether as a value or a type and with any quote style, when the guard
  runs, then it fails and names the importing file.
- Given `index.ts` or `daemon-cli.ts` importing any name other than `Conductor` from
  `engine/conductor.js`, when the guard runs, then it fails and names the extra import.
- Given any destination module created by this change, when its imports are inspected, then none
  imports `engine/conductor.js`, whether as a value or a type.

### Done When
- [ ] `step-runners.ts` has no imports from `./conductor.js`.
- [ ] Across `src/`, only `index.ts` and `daemon-cli.ts` import `conductor.js`, and only
      `Conductor`.
- [ ] The guard enforces the import rule above, and fixtures prove it rejects violations.

## Story 4: The managed-dispatch prompt audit still covers retry and remediation hints

As an operator relying on the session-command audit, I want operator-only instructions in managed
retry and remediation prompts to stay flagged after the prompt builders move, so that the move
does not silently switch off a safety gate.

### Acceptance Criteria

#### Happy Path
- Given `buildRetryHint` and `buildRemediationHint` in their new module, when the session-command
  audit evaluates that module's source, then it treats those symbols as managed dispatch prompt
  surfaces. It reports an operator-only instruction inside them exactly as it did when they lived
  in `conductor.ts`.
- Given the existing session-command-audit integration test that reads the `=managed` markers,
  when it runs against the post-change tree, then it finds those markers in the new defining
  module and passes.

#### Negative Paths
- Given an operator-only session-command reference injected into `buildRetryHint`'s prompt text
  in the new module, when the audit runs, then it reports the managed-dispatch violation instead
  of passing silently.
- Given the `MANAGED_DISPATCH_PROMPT_SURFACES` entry still named `conductor.ts` for
  `buildRetryHint`/`buildRemediationHint`, when the existing integration test runs ("registers
  only declarations that exist…"), then it fails. The entry must name the defining module for
  the test to pass.

### Done When
- [ ] The prompt-surface registry entry for `buildRetryHint`/`buildRemediationHint` names their
      defining module.
- [ ] The existing session-command-audit integration tests pass, unchanged except for the file
      they read.
- [ ] BUILD evidence: a search of `src/` for string literals naming `conductor.ts` finds
      `session-command-audit.ts` as its only gate-keying match. The plan records the command and
      its output, and BUILD re-runs it.

## Story 5: Source-scan and mock tests keep guarding moved code

As a maintainer, I want tests that locate code by reading `conductor.ts` or by mocking
`conductor.js` to keep guarding that code after it moves, so that no assertion passes vacuously
over code that has left the file.

### Acceptance Criteria

#### Happy Path
- Given a positive source-scan test that expects moved code in `conductor.ts`, when it runs
  post-change, then it reads the module that now defines that code and passes. Examples are
  `finish-publication-production-wiring.test.ts` (`createFinishPresentationRepair`) and
  `task-seed.test.ts` (`seedTaskStatus(…, { dispatchBoundary: true })`).
- Given a negative source-scan test that asserts a pattern is absent from `conductor.ts`, when it
  runs post-change, then its scanned set covers every new destination module as well as
  `conductor.ts`. Examples are `no-operator-credential-coupling.test.ts` and
  `provider-id-literals.test.ts`.
- Given `daemon-state-refusal-event.test.ts`, which stubs
  `createProvenanceGuardedFinishPresentationRepair`, when it runs post-change, then the stub is
  installed on the module `daemon-cli.ts` now imports from, and `daemon-cli.ts` receives the stub.
- Given `test/engine/config-consumer-registry.ts`, when it is read post-change, then the
  `prd_audit.*` and `kickback_escalation` keys map to the modules that now consume them.

#### Negative Paths
- Given a negative source-scan test whose forbidden pattern is planted in a moved helper's new
  module, when the test runs, then it fails, proving the widened scan reaches moved code.
- Given the stubbed repair function in `daemon-state-refusal-event.test.ts`, when the test checks
  that the stub was used, then a run in which the real function loads instead fails that check.
- Given a test whose mocked module graph now reaches a destination module, when it runs, then it
  passes with no "No export … defined on mock" error. Mock factories that replace a whole module
  without `importOriginal` are extended or retargeted so that every export the code under test
  uses is defined. Affected tests include those of `step-runners`, `kickback-budget-cli`,
  `daemon-observe-cli`, and `daemon-cli`.

### Done When
- [ ] The plan classifies every test that reads `conductor.ts` source text as either a positive
      retarget or a negative widen. It records the search command, and BUILD re-runs that command
      as evidence that the inventory is complete.
- [ ] Positive scans pass against the new modules, and negative scans also cover them.
- [ ] Mocks of moved names target the module their production consumer imports from.

## Story 6: Engineer containment still forbids reaching push-capable code

As an operator, I want the engineer's non-autonomy containment to keep forbidding the moved
push-capable code, so that moving `pushPostFinishShippedRecord` and the finish-presentation repair
out of `conductor.ts` does not open a path from the engineer to remote writes.

### Acceptance Criteria

#### Happy Path
- Given the post-change tree, when `non-autonomy.test.ts` runs, then its forbidden set includes
  `conductor.ts` and the modules that now define `pushPostFinishShippedRecord`,
  `refreshPostFinishShippedRecord`, `createFinishPresentationRepair` and
  `createProvenanceGuardedFinishPresentationRepair`, and the engineer's transitive static import
  graph reaches none of them.

#### Negative Paths
- Given an engineer module that imports the new post-finish shipped-record module, directly or
  transitively, when `non-autonomy.test.ts` runs, then it fails with a VIOLATION naming that
  forbidden module.
- Given an engineer module that imports the new finish-presentation-repair module, when the test
  runs, then it fails in the same way.
- Given the moved type-only and pure-helper modules, such as `step-runner-types` and
  `remediation-caps`, when their imports are inspected, then none of them imports a push-capable
  destination module. An engineer type import of those modules therefore raises no containment
  violation.

### Done When
- [ ] `non-autonomy.test.ts` forbids the new push-capable modules.
- [ ] The test passes on the post-change tree.

## Story 7: Behavior is unchanged

As an operator, I want builds, daemon runs, and every gate to behave exactly as before, so that
this structural change carries no functional risk.

### Acceptance Criteria

#### Happy Path
- Given the post-change tree, when the full `src/conductor` suite and
  `test/test_harness_integrity.sh` run, then they pass, and no test has been deleted, skipped, or
  weakened. The only differences are the retargets and widenings in Stories 4–6.
- Given each moved declaration, when its text at merge-base is compared with its text at HEAD
  with the `export` modifier removed, then the two are identical. The one exception is the
  identifier of the renamed `appendRemediationTasks`. This comparison is BUILD evidence: a
  per-declaration result recorded in the delivering task's commit body, as the plan specifies.
- Given `isEngineComputedStep` after `AGENT_DISPATCHING_ENGINE_NATIVE_STEPS` moves, when it is
  called with `'test_suite'` and with `'build_review'`, then it returns `true` and `false`
  respectively, as before. A test pins this without exporting the set.

#### Negative Paths
- Given a destination module that exports module-level constants, when that module is imported on
  its own in a fresh module graph, then every exported constant is defined. No temporal-dead-zone or
  load-order `undefined` comes from an import cycle.
- Given a moved helper that needs a constant shared with the class (`MAX_KICKBACKS_PER_GATE`),
  when the move is made, then the constant moves with the helper and `conductor.ts` imports it,
  so no cycle runs through `conductor.ts`.
- Given the renamed conductor variant of `appendRemediationTasks` and the existing
  `remediation-append.ts` export of the same name, when both are imported in one test, then they
  are distinct functions, and each keeps its own behavior as before.

### Done When
- [ ] The full suite and the integrity check pass.
- [ ] BUILD evidence: the comparison of moved declaration text is recorded and shows no change
      to any body.
- [ ] A test pins `isEngineComputedStep`, and an isolated-import test covers each destination
      module's constants.
