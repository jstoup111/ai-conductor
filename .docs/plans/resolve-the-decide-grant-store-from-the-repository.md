# Implementation Plan: Resolve the decide-grant store from the repository root

**Date:** 2026-09-06
**Stories:** .docs/stories/resolve-the-decide-grant-store-from-the-repository.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent preserves the existing grant contract exactly — the daemon-owned store outside every worktree, one grant per feature slug, exact-step scope, single-use consumption, and the ungrantable planning step — and changes only which directory the store path is composed from.

## Summary

Four bounded tasks deliver #1621: a strict main-root resolver that can report failure, one shared spelling of the grant store path, a recording command that resolves the repository root before it writes and refuses when it cannot, and real-binary coverage from a worktree directory and from outside any repository. Grant format, scoping, consumption, and entry-policy semantics are untouched.

## Technical Approach

The recording command composes its store directory by joining the daemon grant subpath onto the invocation directory, so a worktree working directory produces a grant beneath the worktree while the entry policy reads only the main checkout's store. The fix resolves the main repository root from the invocation directory first, then composes the store path from that root.

The resolution primitive already exists twice. `park-marker.ts` exports a memoized resolver that probes `git rev-parse --git-common-dir` and, on failure, returns its input directory unchanged; `daemon-park-cli.ts` carries a second, non-memoized copy of the same probe that returns a discriminated failure instead. The lenient memoized resolver cannot serve a caller that must refuse to write, because a cached result never re-invokes its error callback, so the caller cannot tell a resolved root from a fallback. Add a strict, non-memoized `resolveMainRepoRootStrict` to `park-marker.ts` — the module that already owns daemon-directory root resolution — returning the resolved root or a null result on a failed or empty probe, and route the park CLI's existing resolver through it so the probe is spelled once. Keep the memoized lenient resolver and every one of its current callers unchanged; the two have genuinely different contracts.

The probe behaves correctly for all three invocation shapes, verified against the real repository: from the checkout root and from a nested subdirectory it returns a path relative to the invocation directory that normalizes to the main git directory, and from inside a linked worktree it returns that directory absolutely. Taking the parent of the resolved git common directory yields the main checkout root in each case.

Give the store path one spelling. `decide-entry-policy.ts` already holds the daemon grant subpath constant and derives the read path from the worktree that owns a feature; export a small `grantStorePath(mainRoot, slug)` helper from that module, have `resolveGrantPath` delegate to it, and have the recording command compose its write path with the same helper. That module imports only types and node built-ins, so the command module stays light. This is the durable half of the fix: after it, the writer and the reader cannot drift apart, because there is only one derivation to change.

The recording command then resolves the root, refuses with a non-zero exit and a diagnostic when the resolver reports no repository, writes nothing in that case — no file and no store directory — and appends the absolute path it wrote to its existing success line so a misplaced write is visible immediately. The step refusal for the ungrantable planning step stays where it is, ahead of any resolution, so that refusal cannot become dependent on being inside a repository. Take the resolver as an optional injected dependency defaulting to the production strict resolver, following the existing `resolveMainRoot` dependency shape in `build-review-effective.ts` and `build-review-cli.ts`, so the command's path composition, its output, and its refusal are unit-testable without git.

Two coverage constraints bind the tests. First, an existing acceptance guard asserts that exactly one source file both mentions the worktree grant file name and calls a file write — the recording command module. Its explanatory comment naming that worktree file must survive the edit, or the guard reports the wrong file set. Second, the existing acceptance fixture runs the real binary from a bare temporary directory that is not a repository; under the new refusal that directory must become a real repository with a real linked worktree, using the same fixture shape the park-marker root-resolution acceptance test already uses (initialize with a pinned initial branch, set local identity, disable commit signing, make one commit, then add the linked worktree). For the outside-any-repository case, set the git ceiling environment variable for the child process to the temporary directory's parent so the probe cannot walk out of the fixture on a machine whose temporary directory happens to sit inside a repository.

Tests follow the repository's test-design rules: unit tests inject the resolver and touch no git; the real-git fixtures exist only because git worktree semantics are the behavior under test; the real binary is exercised only in the existing acceptance file, which already runs it; nothing reaches a network or an LLM.

## Preconditions and claim ledger

- Operator approved Small scope, root resolution over a worktree-only guard, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: the recording command in the CLI module composes its grant directory by joining the daemon grant subpath onto its invocation directory, and prints a success line naming only the step and the slug.
- Verified: the entry policy module holds the daemon grant subpath constant and derives the read path as the main checkout root of the worktree that owns the feature, returning no path for a non-worktree root.
- Verified: the park-marker resolver is memoized and falls back to its input directory on a failed probe; the park CLI carries a second non-memoized copy of the same probe that reports failure explicitly.
- Verified: `git rev-parse --git-common-dir` resolves to the same main checkout root from the checkout root, from a nested subdirectory, and from inside a linked worktree of this repository.
- Verified: an acceptance guard asserts exactly one source file both mentions the worktree grant file name and calls a file write; the existing acceptance fixture's command directory is a bare temporary directory, not a repository.
- Verified: an optional injected main-root resolver is the established dependency shape in the build-review effective-verdict and CLI modules.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event-spine: no new event, metric, span, log channel, or report — the change alters one existing command's exit code, its store path, and one existing success line.
- Verify-claims verdict: CLEAR. Every load-bearing claim above was read out of the worktree or probed against the real repository; no assumption remains unconfirmed.

## Tasks

### Task 1: Add a strict main-root resolver and route the park CLI through it
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/park-marker.ts, src/conductor/src/engine/daemon-park-cli.ts, src/conductor/test/engine/park-marker-strict-root.test.ts (new file)
**Dependencies:** none

**Steps:**
1. Write a failing test file that builds a real local git repository with a real linked worktree — pinned initial branch, local identity, signing disabled, one commit, then a linked worktree added beneath the conventional worktrees directory — and asserts the strict resolver returns the same main checkout root when started from the root, from a nested subdirectory, and from inside the linked worktree.
2. Add a failing case asserting the strict resolver reports no root for a temporary directory outside any repository, with the git ceiling environment variable pointed at that directory's parent so the probe cannot escape the fixture.
3. Verify both cases fail (RED).
4. Implement the strict resolver in the park-marker module: a non-memoized probe of the git common directory, resolving a relative answer against the start directory, returning the parent of the resolved git directory, and returning a null result on a probe failure or an empty answer. Leave the existing memoized lenient resolver and all of its callers unchanged.
5. Replace the duplicate probe inside the park CLI's own root resolver with a call to the strict resolver, mapping a null result onto that CLI's existing not-a-project error string unchanged.
6. Verify the new cases pass (GREEN) and run the existing park CLI test file unchanged.

**Done when:**
1. The new test asserts the strict resolver returns one identical main checkout root from the repository root, a nested subdirectory, and the linked worktree of the real-git fixture.
2. The new test asserts the strict resolver returns a null result for a directory outside any repository and never returns that directory as a root.
3. The park CLI's not-a-project error string is byte-identical to its current value and the existing park CLI test file passes with the delegated resolver.

### Task 2: Give the writer and the reader one grant store path
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/decide-entry-policy.ts, src/conductor/test/engine/decide-entry-policy.test.ts
**Dependencies:** none

**Steps:**
1. Add failing unit cases to the existing entry-policy test file: the exported store-path helper applied to a main checkout root and a slug equals the path the existing worktree-based resolver returns for that checkout's linked worktree of the same slug, and the resolver still returns no path for a main-checkout root and for an unrelated nested directory.
2. Verify the new cases fail (RED) because the helper is not exported yet.
3. Export the store-path helper from the entry-policy module, composing the main checkout root, the existing daemon grant subpath constant, and the slug-named file, and have the existing worktree-based resolver delegate to it rather than composing the path a second time.
4. Verify the new and existing entry-policy cases pass (GREEN).

**Done when:**
1. A unit case asserts the exported store-path helper and the worktree-based resolver produce the identical absolute path for the same checkout root and feature slug.
2. The existing no-path outcomes for a main-checkout root and for an unrelated nested directory are asserted and unchanged.

### Task 3: Resolve the root before writing, and refuse when there is none
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/cli.ts, src/conductor/test/cli/decide-grant-store.test.ts (new file)
**Dependencies:** 1, 2

**Steps:**
1. Write a failing unit test file that calls the recording dispatch with an injected root resolver returning a temporary directory as the main root, and asserts the grant file lands at the store path the shared helper derives for that root and slug, and that the captured standard output contains that absolute path.
2. Add a failing case injecting a resolver that reports no repository, asserting a non-zero return, a diagnostic on standard error naming the unresolved repository, and that the invocation directory gains no grant file and no daemon grant directory.
3. Add a failing case for the ungrantable planning step asserting a non-zero return and that the injected resolver was never called.
4. Verify the cases fail (RED).
5. Implement: accept an optional injected resolver defaulting to the strict production resolver, keep the existing step refusal ahead of resolution, return non-zero with the diagnostic when resolution reports no repository, compose the write path with the shared store-path helper, and append the absolute written path to the existing success line. Preserve the explanatory comment naming the worktree grant file so the existing single-writer guard keeps identifying this module.
6. Verify the cases pass (GREEN) and run the project's typecheck target that includes test files.

**Done when:**
1. With an injected main root, the grant file is written at the store path derived by the shared helper and the captured standard output contains that absolute path.
2. With a resolver reporting no repository, the dispatch returns a non-zero code, the invocation directory gains no grant file and no daemon grant directory, and standard error names the unresolved repository.
3. A planning-step invocation returns non-zero without invoking the injected resolver.

### Task 4: Prove the shipped command honors its invocation directory
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/acceptance/decide-entry-operator-grant.acceptance.test.ts
**Dependencies:** 3

**Steps:**
1. Convert the fixture's command directory from a bare temporary directory into a real git repository with a real linked worktree for the fixture slug, using the initialize-identity-signing-commit-worktree shape the park-marker root-resolution acceptance fixture already uses.
2. Add a failing case running the real binary with its working directory set to the linked worktree, asserting the grant file appears at the main checkout store path for that slug and that no grant file exists beneath the worktree.
3. Add a failing case running the real binary from a temporary directory outside any repository, with the git ceiling environment variable set for the child process, asserting a non-zero exit and no grant file in that directory.
4. Verify both new cases fail (RED) against the current command, then confirm they pass once Task 3 is in place (GREEN).
5. Keep the existing planning-step refusal, traversal-slug refusal, and single-grant-writer guard cases, adjusting only their fixture setup for the now-real repository.

**Done when:**
1. The real binary invoked with its working directory inside the linked worktree writes the grant at the main checkout store path and leaves no grant file beneath the worktree.
2. The real binary invoked from a directory outside any repository exits non-zero and that directory contains no grant file afterwards.
3. The existing planning-step refusal, traversal-slug refusal, and single-grant-writer guard cases still pass unchanged in substance.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the invocation directory is the main repository checkout root, when the operator records a grant for a feature slug, then the grant file exists at that checkout's daemon grant store path for that slug. | 3 | "With an injected main root, the grant file is written at the store path derived by the shared helper and the captured standard output contains that absolute path." | diff-local |
| Story 1 happy: Given the invocation directory is inside the feature's linked worktree or a nested subdirectory of the checkout, when the operator records a grant, then the grant file is written to the main checkout's grant store and no grant file appears beneath the worktree. | 1, 4 | "The real binary invoked with its working directory inside the linked worktree writes the grant at the main checkout store path and leaves no grant file beneath the worktree." | diff-local |
| Story 1 happy: Given the command reports success, when the operator reads its output, then the message names the absolute path of the grant file it wrote. | 3 | "With an injected main root, the grant file is written at the store path derived by the shared helper and the captured standard output contains that absolute path." | diff-local |
| Story 1 negative: Given the invocation directory is outside any repository, when the operator records a grant, then the command exits non-zero with a diagnostic naming the unresolved repository and writes no grant file or store directory. | 1, 3, 4 | "With a resolver reporting no repository, the dispatch returns a non-zero code, the invocation directory gains no grant file and no daemon grant directory, and standard error names the unresolved repository." | diff-local |
| Story 1 negative: Given the requested step is the ungrantable planning step, when the operator records a grant from any invocation directory, then the command exits non-zero and writes no grant file, without depending on repository resolution. | 3, 4 | "A planning-step invocation returns non-zero without invoking the injected resolver." | diff-local |
| Story 2 happy: Given a main checkout root and a feature slug, when the recording command derives the path it writes and the entry policy derives the path it reads, then both produce the identical absolute path. | 2, 3 | "A unit case asserts the exported store-path helper and the worktree-based resolver produce the identical absolute path for the same checkout root and feature slug." | diff-local |
| Story 2 negative: Given a project root that is not a linked feature worktree, when the entry policy resolves the grant path for that root, then it resolves no path and consults no grant, exactly as it does today. | 2 | "The existing no-path outcomes for a main-checkout root and for an unrelated nested directory are asserted and unchanged." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided entirely by files this feature changes plus fixtures it creates, and no commit outside this diff can change whether one holds.

Task 2 owns pure path-derivation coverage at unit level in the existing entry-policy test file. Task 3 owns the recording command's composition, output, and refusal at unit level with an injected resolver and no git. Task 1 owns git-semantics coverage for the strict resolver, using a real local repository with a real linked worktree because worktree resolution is precisely the behavior under test; it uses no network and no third-party service.

Task 4 is the single cross-boundary integration owner. The changed production boundary is the shipped command as an operator actually reaches it, so exactly one task proves the observable behavior through that entry point: the real binary, run with a working directory inside a linked worktree and again from outside any repository. Unit proof that the dispatch composes the right path does not prove the shipped command reaches the resolver, which is the exact gap that produced this defect.

No new aggregate, smoke, or external-service test is introduced, and no terminal validation task is added; the configured suite and the existing gates cover the completed feature.

## Task Dependency Graph

Task 1 -> Task 3
Task 2 -> Task 3
Task 3 -> Task 4
