# Implementation Plan: Seed the live daemon E2E smoke as a linked worktree

**Date:** 2026-09-06
**Stories:** .docs/stories/seed-the-live-daemon-e2e-smoke-as-a-linked-worktre.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent changes only the shared live-smoke fixture's own topology and assertions, and preserves every existing shared-body contract — provider selection, credential and readiness refusals, isolated provider home, step-command preflight, halted-fixture refusal, token cap, and redacted diagnostics.

## Summary

Five bounded tasks deliver #1669 by seeding the live-provider daemon E2E fixture with the daemon's real repository topology — a main checkout plus a linked worktree — so build-review feature identity resolves on its own, then removing the injected effective-verdict resolver that this topology made unnecessary and re-rooting the fixture's park check on the production reader. The scripted non-live sibling fixture, the disabled test-quality rubric, and production identity resolution are untouched.

## Technical Approach

The shared run body currently creates one temporary directory and uses it as repository root, project root, and feature-branch checkout all at once. Production never has that shape: the daemon always runs a feature inside a linked worktree one path segment under the main checkout's worktrees directory, and `resolveBuildReviewFeatureIdentity` encodes exactly that shape — it resolves the main root through `resolveMainRepoRoot`, realpaths both ends, and returns undefined for any other layout. That is why the run body had to inject a resolver override, and why the smoke could not catch the identity regression that failed two release gates.

Restructure the seeding into one focused, exported helper in the shared run body that takes a fixture root and the fixture slug and returns both the main checkout path and the linked worktree path. The helper initializes the main checkout through the existing `initTestRepo` fixture (which already pins the initial branch and local identity), copies the plan and stories fixtures and creates the fixture test directory there, writes the same runtime-directory ignore set the body writes today, makes the seed commit, then runs `git worktree add <root>/.worktrees/<slug> -b feature/<slug>`. The seed commit therefore lands on the main branch and the worktree branches from it, preserving the existing baseline-sha and untouched-fixture assertions. Because the helper surfaces git's own failure, an occupied worktree path fails closed with the path named, rather than degrading to a standalone repository and silently re-hiding the defect.

Once seeding produces a real linked worktree, the project root handed to the step runner and the conductor is the worktree path, and every worktree-local path the body derives — the pipeline directory, the conduct-state file, the plan path passed to the runner, the before/after daemon seams, the halted-fixture refusal, and the failure diagnostics — is rebased on it. Cleanup removes the fixture root, which contains the worktree, so no `git worktree` bookkeeping outlives the run. Keep the disabled test-quality rubric and the injected suite inspector exactly as they are: they are a separate concern from disposition resolution and out of this slice.

With the topology correct, delete the `buildReviewEffectiveResolver` property and its now-unused aggregate-derivation import from the shared body so the smoke runs the real resolver, the real store read, and the real contract-version filtering. The disposition store reads a project-root-local, git-ignored state file and treats an absent file as an empty record set, so a freshly seeded worktree needs no seeded state. Guard the deletion the way this repository already guards this file: the structural suite over the shared body parses it with the TypeScript compiler API and asserts a property, so add a sibling assertion that reports zero build-review effective-verdict resolver overrides.

The park check needs one matching correction. `hasSuccessfulTerminalState` builds a worktree-local park path today, which is correct only while the fixture is its own repository root; the production reader `isOperatorParked` resolves the main root first, so after this change a worktree-local path can never match what the daemon would write. Re-root that check on the production reader, keep the completion and halt markers reading the worktree, and export the function so its two cases are provable without a provider dispatch.

Test approach follows the repository's test-authoring rules: these are integration tests over real local git, which is legitimate because git worktree semantics are the boundary under test. They stop at the seeding and terminal-state boundaries and never construct a conductor, provision a provider home, or reach a provider — the existing shared-body unit tests already own the pre-dispatch refusal paths through the injected binary, credential, provisioning, and preflight seams. Search hints for comparable code: the existing shared-body tests build a descriptor literal and drive the body with injected seams; the existing structural test reads the body source and walks it with the TypeScript compiler API. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the seeded-topology approach over a test-only identity escape, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/test/fixtures/live-e2e-run-body.ts:394` creates the fixture with one `mkdtemp` and line 395 assigns it as the run's worktree directory; line 442 creates the feature branch in that same directory; line 527 removes it at teardown.
- Verified: `src/conductor/test/fixtures/live-e2e-run-body.ts:468` injects `buildReviewEffectiveResolver`, and line 15 imports `deriveEffectiveBuildReviewVerdict` solely for it.
- Verified: `resolveBuildReviewFeatureIdentity` at `src/conductor/src/engine/build-review-effective.ts:57` returns undefined unless the project root is exactly one path segment under the realpathed main root's worktrees directory; `resolveEffectiveBuildReviewVerdict` at line 87 refuses with an unavailable-identity reason when it does.
- Verified: `src/conductor/src/engine/build-review-dispositions.ts:23` sets the store path to a project-root-local pipeline state file, and its loader returns an empty record set when that file is absent.
- Verified: `isOperatorParked` at `src/conductor/src/engine/park-marker.ts:158` resolves the main repository root before reading the park marker, while the shared body's terminal-state helper builds a worktree-local park path.
- Verified: `initTestRepo` in `src/conductor/test/fixtures/git-repo.ts` initializes with an explicit initial branch and repo-local identity, satisfying the fixture-portability structural guard.
- Verified: `src/conductor/test/structural/live-e2e-shared-body.test.ts` already reads the shared body source and walks it with the TypeScript compiler API, so a second structural assertion needs no new machinery.
- Verified: the shared body's before/after daemon seams and the halted-fixture refusal all address the same directory, so rebasing them on the worktree path keeps the existing pre-dispatch refusal test passing unchanged.
- Scope check: A — harness-repo-only (fixture for this repository's own release smoke); B — n/a; C — provider-agnostic (the shared body is the provider-neutral entry both descriptor legs take). Event-spine: no new event, metric, span, log line, or report.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Seed the fixture as a main checkout plus a linked worktree
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/test/fixtures/live-e2e-run-body.ts, src/conductor/test/fixtures/live-e2e-run-body.test.ts
**Dependencies:** none

**Steps:**
1. Write a failing integration test that seeds the fixture into a fresh temporary root and asserts the production feature-identity resolver returns the seeded main checkout and the fixture slug, and that the production effective-verdict resolver succeeds against the seeded project root with a valid aggregate and no disposition state file.
2. Verify the test fails against the current single-directory seeding (RED).
3. Extract the existing seeding into one exported helper taking a fixture root and slug: initialize the main checkout through the existing repo-init fixture, copy the plan and stories fixtures and create the fixture test directory, write the same runtime-directory ignore set, make the seed commit, then add the linked worktree with a new feature branch, returning both paths.
4. Rebase the run body's pipeline directory, conduct-state path, runner plan path, before/after daemon seams, halted-fixture refusal, and diagnostics on the returned worktree path, and remove the fixture root at teardown.
5. Verify the new test and the existing shared-body tests pass (GREEN), then commit the focused change.

**Done when:**
1. A seeding test asserts the production feature-identity resolver returns the seeded main checkout as repository and the fixture slug as feature.
2. A seeding test asserts the production effective-verdict resolver returns a successful resolution against the seeded project root with a valid aggregate and no disposition state file on disk.
3. The seeded project root is a linked worktree one path segment under the main checkout's worktrees directory, and the seed commit is reachable from its feature branch.
4. Teardown removes the fixture root so no linked worktree or temporary checkout survives the run.

### Task 2: Fail closed when the linked-worktree path is occupied
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/fixtures/live-e2e-run-body.ts, src/conductor/test/fixtures/live-e2e-run-body.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing test that pre-creates the fixture's linked-worktree path as a non-empty directory and asserts seeding rejects with an error naming that path.
2. Verify the test fails (RED) if the helper swallows the git failure or falls back to the main checkout as the project root.
3. Surface git's own failure from the helper unchanged, adding the target path to the message when git's output omits it; never fall back to a standalone checkout.
4. Verify the test passes (GREEN), and assert in the same test that no provider home provisioning, preflight, or dispatch seam was invoked.
5. Commit the focused change.

**Done when:**
1. A seeding test that pre-creates the fixture's linked-worktree path asserts seeding rejects with an error naming that path.
2. That test asserts no provider home provisioning, step-command preflight, or provider dispatch was attempted.
3. No seeding path returns the main checkout as the project root.

### Task 3: Run the smoke through the production effective-verdict resolver
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/test/fixtures/live-e2e-run-body.ts, src/conductor/test/structural/live-e2e-shared-body.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing structural assertion in the existing structural suite over the shared body: parse the source with the TypeScript compiler API already used there and collect every property assignment named for the build-review effective-verdict resolver, expecting none.
2. Verify it fails against the current source (RED).
3. Delete the injected resolver property from the shared body's step-runner options and the aggregate-derivation import that exists only to serve it, leaving the disabled test-quality rubric and the injected suite inspector untouched.
4. Verify the structural assertion passes (GREEN) and the repository typecheck target that covers test files reports no unused-import or type error.
5. Commit the focused change.

**Done when:**
1. The shared run body constructs its live step runner with no build-review effective-verdict resolver property.
2. A structural assertion over the shared run body source reports zero build-review effective-verdict resolver overrides and fails when one is reintroduced.
3. The aggregate-derivation import that existed only for the override is gone and the typecheck target covering test files passes.

### Task 4: Read fixture park state through the production reader
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/fixtures/live-e2e-run-body.ts, src/conductor/test/fixtures/live-e2e-run-body.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing test that seeds the fixture, writes a completion marker in the worktree pipeline directory with no halt or park marker anywhere, and asserts terminal-state evaluation reports success.
2. Verify it fails while the helper is unexported or still builds a worktree-local park path (RED).
3. Export the terminal-state helper and re-root its park check on the production park reader given the worktree path, keeping the completion and halt markers read from the worktree pipeline directory.
4. Verify the test passes (GREEN) and the existing shared-body tests are unchanged.
5. Commit the focused change.

**Done when:**
1. Terminal-state evaluation reports success for a seeded linked worktree carrying a completion marker with no halt marker and no park marker.
2. Terminal-state evaluation consults park state through the production park reader rooted at the fixture worktree, not a hand-built worktree-local path.

### Task 5: Deny success for a parked fixture
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/fixtures/live-e2e-run-body.test.ts
**Dependencies:** 4

**Steps:**
1. Write a failing test that seeds the fixture, writes a completion marker in the worktree, parks the fixture slug through the production park writer given the worktree path, and asserts terminal-state evaluation reports failure.
2. Verify it fails (RED) against a park check that reads only the worktree.
3. Assert in the same test that the written marker landed under the seeded main checkout, proving the reader and writer agree on the production location.
4. Verify the test passes (GREEN) and commit the focused change.

**Done when:**
1. Terminal-state evaluation reports failure after the production park writer parks the fixture slug from the seeded worktree.
2. The park marker written in that test is asserted to exist under the seeded main checkout rather than under the worktree.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the live smoke fixture repository has been seeded, when the production build-review feature-identity resolver runs against the seeded project root, then it returns the seeded main checkout as the repository and the fixture slug as the feature. | 1 | "A seeding test asserts the production feature-identity resolver returns the seeded main checkout as repository and the fixture slug as feature." | diff-local |
| Story 1 happy: Given the live smoke fixture repository has been seeded, when the production effective-verdict resolver runs against the seeded project root with a valid aggregate and no operator dispositions on disk, then it resolves successfully rather than refusing for unavailable feature identity. | 1 | "A seeding test asserts the production effective-verdict resolver returns a successful resolution against the seeded project root with a valid aggregate and no disposition state file on disk." | diff-local |
| Story 1 happy: Given the shared live-provider run body source, when its step-runner construction is inspected, then it declares no build-review effective-verdict resolver override. | 3 | "A structural assertion over the shared run body source reports zero build-review effective-verdict resolver overrides and fails when one is reintroduced." | diff-local |
| Story 1 negative: Given a leftover directory already occupies the fixture's linked-worktree path, when the fixture repository is seeded, then seeding rejects with an error naming that path and no provider home, preflight, or dispatch is reached. | 2 | "A seeding test that pre-creates the fixture's linked-worktree path asserts seeding rejects with an error naming that path." | diff-local |
| Story 2 happy: Given a seeded fixture whose worktree carries a completion marker, no halt marker, and no park marker anywhere, when the run body evaluates terminal state, then it reports success. | 4 | "Terminal-state evaluation reports success for a seeded linked worktree carrying a completion marker with no halt marker and no park marker." | diff-local |
| Story 2 negative: Given a seeded fixture whose worktree carries a completion marker and whose park marker for the fixture slug was written through the production park writer, when the run body evaluates terminal state, then it reports failure. | 5 | "Terminal-state evaluation reports failure after the production park writer parks the fixture slug from the seeded worktree." | diff-local |

## Test dispositions and integration ownership

All six criteria are diff-local: each is decided entirely by the changed fixture files and real local git in a temporary directory, with no dependency on a commit outside this diff. Task 1 owns the seeding-to-identity integration and is the single integration-owning task for the changed boundary — the observable behavior it proves is that the production effective-verdict resolver, reached through the fixture's own project root, resolves rather than refuses. Task 2 owns the seeding failure boundary. Task 3 owns the structural guard proving the override is gone, at the lowest sufficient layer: the property's absence is a source property, not a runtime one, and the existing structural suite already parses this file. Tasks 4 and 5 own the terminal-state helper's two cases against real seeded worktrees and the production park writer. No test in this plan constructs a conductor, provisions a provider home, or contacts a provider; the existing shared-body tests retain the credential, readiness, binary, preflight, and halted-fixture refusal coverage unchanged. No terminal validation task is added; the opt-in live smoke itself remains the release-time proof.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 1 -> Task 4 -> Task 5
