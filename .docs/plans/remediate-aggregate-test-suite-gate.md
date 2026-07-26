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

### Task rem-test-daemon-build-auth-01: Stop daemon build-auth acceptance fixtures before the finish fence

**Files likely touched:**

- `src/conductor/test/acceptance/isolate-daemon-build-auth-from-operator-oauth.acceptance.test.ts`

**Dependencies:** none

Keep the real self-host build/auth dispatch path under test, but make successful `Conductor.run()` fixtures terminate at their intended post-build boundary. Do not change production finish-fence behavior.

**Verify:**

`npx vitest run test/acceptance/isolate-daemon-build-auth-from-operator-oauth.acceptance.test.ts`

### Task rem-test-post-build-tail-fixtures-01: Bound post-build fixture runs to their intended tail

**Files likely touched:**

- `src/conductor/test/engine/conductor-token-injection.test.ts`
- `src/conductor/test/engine/self-host/wiring.test.ts`
- `src/conductor/test/acceptance/daemon-rate-limit-episode-coordinator.acceptance.test.ts`
- `src/conductor/test/acceptance/sandbox-auth-expiry-park.acceptance.test.ts`

**Dependencies:** `rem-test-daemon-build-auth-01`

For fixtures whose subject is self-host build setup, token injection, credential parking, or
rate-limit recovery, pre-resolve unrelated SHIP-tail validators. Preserve any scenario that
intentionally asserts finish dispatch by leaving only `finish` pending. Do not weaken the
production finish validation fence.

**Verify:**

`npx vitest run test/engine/conductor-token-injection.test.ts test/engine/self-host/wiring.test.ts test/acceptance/daemon-rate-limit-episode-coordinator.acceptance.test.ts test/acceptance/sandbox-auth-expiry-park.acceptance.test.ts`

### Task rem-test-rebase-translation-tail-01: Terminate finish-time rebase fixtures after rebase

**Files likely touched:**

- `src/conductor/test/engine/rebase-translate-acceptance.test.ts`

**Dependencies:** `rem-test-post-build-tail-fixtures-01`

Keep the real `runRebaseStep` dispatch under test, but seed the downstream finish state as
resolved. The fixture asserts rebase translation artifacts, not subsequent SHIP validators;
do not change production rebase or finish-fence logic.

**Verify:**

`npx vitest run test/engine/rebase-translate-acceptance.test.ts`

### Task rem-test-rebase-fixture-tail-01: Bound rebase guard and resolver fixtures at rebase

**Files likely touched:**

- `src/conductor/test/engine/merged-pr-guard-rebase.test.ts`
- `src/conductor/test/engine/rebase-resolution-wiring.test.ts`

**Dependencies:** `rem-test-rebase-translation-tail-01`

Keep each real daemon-mode `runRebaseStep` invocation explicitly targeted at `rebase`, while
pre-resolving its unrelated downstream `finish` step. Preserve the merged-PR and conflict-resolution
assertions; do not change production rebase or publication-fence behavior.

**Verify:**

`npx vitest run test/engine/merged-pr-guard-rebase.test.ts test/engine/rebase-resolution-wiring.test.ts`
