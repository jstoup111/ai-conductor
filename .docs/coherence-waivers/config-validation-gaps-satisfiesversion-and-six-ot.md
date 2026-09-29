Waives: outcome-2, outcome-3

Rationale: Outcomes 2 and 3 are documentation corrections, which the stories and plan skills forbid carrying as stories or tasks. The #2103 precedent routes them to the documentation-maintenance step. That step covers three edits:

- Outcome 2: the `loadMergedConfig` and `loadMergedConfigForRead` docstrings in src/conductor/src/engine/config.ts claim that user-config parse errors become warnings. The code hard-fails instead, and the operator confirmed on 2026-09-28 that this behaviour stays.
- Outcome 3: conflict-check found that APPROVED ADR 004-when-parallel-workflow-dsl supports `when:` on a `parallel` group, and the operator chose on 2026-09-28 to correct the documentation rather than enforce an exclusion. The fix is the "Mutually exclusive with `parallel`" comment on the step `when` field in src/conductor/src/types/config.ts.
- The `harness_version` "Known limitation" note in docs/reference/configuration.md becomes false once Tasks 1 and 2 land.

This waiver covers only those documentation edits. It does not waive any story criterion, task check, or the mechanical coverage of outcomes 1, 4 and 5.
