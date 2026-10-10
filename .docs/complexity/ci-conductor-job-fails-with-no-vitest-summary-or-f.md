# Complexity: CI conductor job names the test files that were running when it fails

Tier: S

Rationale: Three small, local changes on existing seams, with no engine, state, event, schema, or
CLI surface:

1. A new Vitest custom reporter module under `src/conductor/test/reporters/` (test infrastructure,
   not shipped `src/`), built only on the documented Vitest 4 reporter hooks
   (`onTestModuleStart`, `onTestCaseResult`, `onTestModuleEnd`, `onTestRunEnd`).
2. One added `--reporter=` argument on the existing `conductor` job test step in
   `.github/workflows/ci.yml`. Vitest's CLI collects `--reporter` as an array
   (`node_modules/vitest/dist/chunks/cac.uFydS1Z4.js:703-707`, `array: true`), so the package
   script's `--reporter=dot` is kept and the new reporter is added beside it.
3. A one-line exit diagnostic in the existing launcher `src/conductor/scripts/run-vitest.mjs`, on
   its non-zero/signal path only.

Local `npm test`, `test:changed`, and the `test_suite` gate's command and `AGGREGATE_TEST_SUITE_PASS`
marker are untouched. No ADR, architecture review, or conflict check is required at Tier S.
