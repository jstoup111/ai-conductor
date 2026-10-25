**Status:** Accepted

# Stories: test_suite type-checks test files the way CI does

## Story 1: A test file that does not compile fails test_suite, not CI

**Requirement:** Self-host test_suite parity with CI's typecheck job

As an operator, I want this repository's `test_suite` gate to run `typecheck:test`, so that a test type error fails the build before its PR opens instead of exhausting `ci_repair` on CI.

### Acceptance Criteria

#### Happy Path
- Given the committed project config, when `test_suite.commands` is loaded, then it runs `npm run typecheck --silent`, `npm run typecheck:test --silent`, `npm test` and `test/test_harness_integrity.sh` in that order.
- Given the committed project config, when a changed-mode `test_suite` lap runs, then its `changed_command` runs `npm run typecheck:test --silent` before Vitest.

#### Negative Paths
- Given a test file with a TypeScript error that Vitest still executes, when `test_suite` runs, then the gate fails on `typecheck:test`.

### Done When
- [ ] `test/self-host-verification-entries.test.ts` and `test/acceptance/full-suite-verification-gate.acceptance.test.ts` assert the four ordered commands and the changed-mode typecheck.
