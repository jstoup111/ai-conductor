# Remediation Plan: Aggregate test-suite gate

**Date:** 2026-07-26
**Source:** clean `$test-suite` failure evidence in `.pipeline/remediation.json`
**Complexity:** Tier S

## Objective

Remove two test-infrastructure failures that block the aggregate gate without changing #922's publication-fence behavior.

## Evidence

- `test/engine/conductor-auth-park.test.ts`: eight tests timed out because their `Conductor.run()` fixtures entered the real aggregate verifier after build invalidated the test-suite step.
- `test/engine/tmux-leak-guard.test.ts`: the `(unknown)` pane-cwd sentinel was resolved relative to a `/tmp` worktree and incorrectly classified as tmpdir-rooted.

## Tasks

### Task rem-test-conductor-auth-park-01: Stub the nested aggregate verifier in auth-park fixtures

**Files likely touched:**

- `src/conductor/test/engine/conductor-auth-park.test.ts`

**Dependencies:** none

Inject a deterministic `fullSuiteVerifier` stub for each fixture that calls `Conductor.run()` from `build`. Preserve assertions that the auth failure retries the same attempt; add a regression assertion that the stub, not a real verifier, is used.

**Verify:**

`npx vitest run test/engine/conductor-auth-park.test.ts`

### Task rem-test-tmux-leak-guard-01: Treat the unknown pane-cwd sentinel as uncorroborated

**Files likely touched:**

- `src/conductor/test/tmux-leak-guard.ts`
- `src/conductor/test/engine/tmux-leak-guard.test.ts`

**Dependencies:** none

Return `false` for the literal `(unknown)` sentinel before resolving paths. Preserve lexical exact-or-separator-prefix matching for actual tmpdir paths, including deleted temporary directories.

**Verify:**

`npx vitest run test/engine/tmux-leak-guard.test.ts`

## Batch verification

`npx vitest run test/engine/conductor-auth-park.test.ts test/engine/tmux-leak-guard.test.ts`
