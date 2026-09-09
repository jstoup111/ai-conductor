# Implementation Plan: Stage intake outcomes for an unclaimed source ref

**Date:** 2026-09-06
**Stories:** .docs/stories/fetch-intake-outcomes-for-an-unclaimed-source-ref.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing contracts it touches — the canonical tracker seam owns every real tracker invocation, the staging writer stays the only writer of the gitignored outcomes file, and the coherence gate's result shape and fail-closed behavior are unchanged.

## Summary

Four bounded tasks deliver #1340: the composer worktree command resolves a by-ref idea's Desired-outcome body from the originating issue when no claim record and no explicit body exist, it reports immediately when no outcome layer could be staged, and the coherence refusal gains one branch that distinguishes a never-staged outcome layer from a genuinely absent id. Gate redesign, reconciliation with the neighbouring land-message defect, and non-GitHub tracker backends are outside this slice.

## Technical Approach

The body-resolution branch in the worktree case of `engineer-cli.ts` currently ends at the persisted claim record. Extend exactly that branch: when a source ref is present, no explicit body argument was given, and no claim record resolved, parse the ref with the module's already-imported GitHub issue-reference parser and, on a successful parse, read the issue body through the canonical tracker seam — `createGithubTrackerClient` over the `gh` runner the command already holds, calling its existing `getIssueBody(repo, issueRef, cwd)` with the resolved target repository path as the working directory. Do not add a second runner, a second parser, or a direct process invocation; the seam exists precisely so this call is injectable and blocked from reaching the network under test.

Resolution is best-effort, matching every other step of this branch. A parse that returns nothing skips the lookup entirely. A lookup that throws, or that returns the seam's not-found result, leaves the body unresolved and is swallowed — worktree creation is a strict-abort surface for git failures only, and making tracker reachability a precondition of creating a worktree would regress offline work and any reference grammar this seam cannot read. The precedence order stays explicit body, then claim record, then issue lookup, so an operator-supplied body is never displaced by a later edit to the issue.

The one thing that must not stay silent is the outcome. After resolution, when a source ref was supplied and no body resolved from any source, print one diagnostic through the command's existing error-print sink naming the ref, the staging file that was not written, and the body argument that supplies it directly. This is ordinary command output on an existing sink, not a new observation channel: it reports the state of the command that is running, at the moment it runs, and nothing reads it back. Emit it only in that case — an idea with no source ref stays completely silent, because a chat-originated idea legitimately stages nothing, and a resolved body whose Desired-outcome section is empty also stays silent, because the staging writer still writes the file and the existing reader correctly reports the layer as not required.

The refusal branch lives in `coherence-validator.ts`, at the single throw that follows the cross-check. The cross-check itself is unchanged: its inputs, its pool construction, and its result shape all stay as they are, because the ambiguity is not in the verdict but in how the verdict is explained. At the throw, when the rejected id matches the outcome id shape and the gate resolved zero outcome bullets, the two facts together mean the source layer was never staged rather than that the row invented an id — no outcome id can exist when no bullet does. Throw a distinct message for that case that names the gitignored staging file and says the layer was never staged, and deliberately omit the existing instruction to correct the coherence record, because that instruction is what routes the operator toward deleting correct rows. Every other rejection keeps its current text byte-for-byte, including an outcome id that is out of range against a non-empty bullet set and any non-outcome citation.

Tests follow this repository's test-design rules. The command-level cases drive the real dispatch entry point end-to-end against a real temporary git repository and a registry file, with the tracker runner injected — the established shape of the existing claim-record round-trip test, which already builds exactly that fixture and injects a fake runner. Extend that file rather than starting a parallel harness; its beforeEach already creates the repository, the registry, and the engineer directory. The gate cases are unit-level against the exported gate function, extending the existing validator test file's gate fixtures. No case may reach a real tracker, a real network, or a real language model; the injected runner is the only tracker boundary and it is a deterministic fake. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- The operator's delegate approved Small scope, the technical track, the resolve-then-report design over an immediate refusal, and all three stories on 2026-09-06 (delegated).
- Verified: the worktree case of `engineer-cli.ts` resolves a by-ref body only from a persisted claim record and leaves it undefined when none exists, so nothing is staged.
- Verified: the staging writer returns null and writes nothing when the body is empty, and its reader then reports the outcome layer as not required with a null reference.
- Verified: the committed-marker fallback cannot rescue a first land, because that marker is written by land itself.
- Verified: `land-spec.ts` passes the resolved bullet count into the gate, and the gate's cross-check builds the outcome pool from exactly that count.
- Verified: `tracker-client.ts` exports `createGithubTrackerClient` and its `TrackerClient` already declares `getIssueBody(repo, issueRef, cwd)` returning a string or null on a 404.
- Verified: the worktree case already holds the injectable `gh` runner and already imports the GitHub issue-reference parser used by its sibling subcommands.
- Verified: the existing claim-record round-trip test drives the real dispatch entry point with an injected runner over a real temporary git repository, and the existing validator test file already exercises the gate function directly.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no channel added — the existing staging writer, the existing gate refusal, and the command's existing error sink are reused.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in this worktree rather than inferred; no load-bearing assumption remains open.

## Tasks

### Task 1: Resolve a by-ref outcome body from the originating issue through the tracker seam
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer-cli.ts, src/conductor/test/engine/engineer/engineer-cli-claim-record.test.ts
**Dependencies:** none

**Steps:**
1. Extend the existing claim-record test file with a case that enqueues nothing and persists no claim record, injects a tracker runner answering the issue-body read with a body containing a Desired-outcome section, and drives the real dispatch entry point for the worktree subcommand with a source ref and no body argument.
2. Establish RED against the current behavior, which stages nothing.
3. Implement the fallback in the worktree case: after the claim-record lookup leaves the body unresolved, parse the ref with the module's already-imported GitHub issue-reference parser and read the body through `createGithubTrackerClient` over the command's existing runner, using the resolved target repository path as the working directory. Keep explicit body first and claim record second.
4. Add the two precedence cases to the same file — one with a persisted claim record and one with an explicit body argument — asserting the injected runner records zero issue-view invocations.
5. Run the focused test file through the repository's scoped runner, run the typecheck target that covers test files, and commit the focused change.

**Done when:**
1. Driving the worktree subcommand with a source ref, no claim record, and no body argument writes the staged outcomes file, whose reference line is the supplied ref and whose bullets are the injected issue body's Desired-outcome bullets verbatim.
2. The claim-record precedence case and the explicit-body precedence case each stage their own body and record zero issue-view invocations on the injected runner.
3. Every tracker access in the changed code path goes through the canonical tracker seam constructed over the injected runner, so no test reaches a real process or network.

### Task 2: Degrade to no staging when the issue body cannot be read
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer-cli.ts, src/conductor/test/engine/engineer/engineer-cli-claim-record.test.ts
**Dependencies:** 1

**Steps:**
1. Add three cases to the same test file: an injected runner that rejects the issue-body read, an injected runner whose rejection carries the seam's not-found shape, and a source ref the GitHub issue-reference grammar cannot parse.
2. Establish RED for any case in which the command exits non-zero or the worktree is missing.
3. Implement the degradation: skip the lookup entirely when the ref does not parse, and wrap the lookup so any rejection leaves the body unresolved instead of propagating. Do not catch or alter failures raised by worktree creation itself, which must keep its strict-abort behavior.
4. Assert in each case that the command exits zero, the worktree directory exists, and no staged outcomes file was written.
5. Run the focused test file through the repository's scoped runner and commit the focused change.

**Done when:**
1. The lookup-failure case and the not-found case each exit zero with the worktree directory present and no staged outcomes file on disk.
2. The unparseable-reference case exits zero with the worktree present and records zero issue-view invocations on the injected runner.
3. A git failure injected into worktree creation still exits non-zero, proving the new handling did not widen into the strict-abort path.

### Task 3: Report at worktree-creation time that no outcome layer was staged
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer-cli.ts, src/conductor/test/engine/engineer/engineer-cli-claim-record.test.ts
**Dependencies:** 1

**Steps:**
1. Add a case capturing the command's error sink for an unresolvable source ref and asserting one diagnostic line that contains the source ref, the relative staging file path, and the name of the body argument.
2. Add the two silence cases: an idea with no source ref at all, and a source ref whose resolved body carries no Desired-outcome bullets.
3. Establish RED, then emit the diagnostic through the command's existing error-print sink at exactly one place — after body resolution, gated on a source ref being present and no body having resolved from any source.
4. Assert the no-source-ref case emits no such diagnostic, exits zero, and writes no staging file, and that the bulletless-body case writes the staging file and emits no such diagnostic.
5. Run the focused test file through the repository's scoped runner and commit the focused change.

**Done when:**
1. The unresolvable-reference case captures exactly one diagnostic line containing the source ref, the relative staging file path, and the body argument name.
2. The no-source-ref case captures no missing-outcome diagnostic, exits zero, and leaves no staging file on disk.
3. The bulletless-body case writes the staging file and captures no missing-outcome diagnostic.

### Task 4: Name the never-staged outcome layer in the coherence refusal
**Story:** Story 3
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer/coherence-validator.ts, src/conductor/test/engine/engineer/coherence-validator.test.ts
**Dependencies:** none

**Steps:**
1. Extend the existing gate fixtures in the validator test file with three cases: zero resolved outcome bullets and a row citing an outcome id; two resolved outcome bullets and a row citing an out-of-range outcome id; zero resolved outcome bullets and a row citing a fabricated story id.
2. Establish RED on the first case, which today yields the generic refusal naming the coherence artifact.
3. Implement the branch at the single throw following the cross-check: when the rejected id matches the outcome id shape and the gate resolved zero outcome bullets, throw a message that states the outcome layer was never staged, names the gitignored staging file by its exported relative path constant, and omits the existing instruction to correct the coherence record. Leave the cross-check function, its inputs, and its result shape untouched.
4. Assert the two other cases still produce the existing refusal text unchanged.
5. Run the focused test file through the repository's scoped runner, run the typecheck target that covers test files, and commit the focused change.

**Done when:**
1. Zero resolved outcome bullets plus an outcome-citing row yields a refusal containing the staging file's relative path and a statement that the outcome layer was never staged.
2. That same refusal does not contain the existing instruction to correct the coherence record, so deleting the outcome rows is not the repair it suggests.
3. Two resolved outcome bullets with an out-of-range outcome id, and zero resolved outcome bullets with a fabricated story citation, each yield the existing refusal text unchanged.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a source ref with no persisted claim record and no explicit body argument, when the per-idea worktree is created, then the worktree carries a staged outcomes file naming that ref and every verbatim Desired-outcome bullet of the referenced issue. | 1 | "Driving the worktree subcommand with a source ref, no claim record, and no body argument writes the staged outcomes file, whose reference line is the supplied ref and whose bullets are the injected issue body's Desired-outcome bullets verbatim." | diff-local |
| Story 1 happy: Given a persisted claim record or an explicit body argument for the same ref, when the per-idea worktree is created, then that body is staged and no issue lookup is performed. | 1 | "The claim-record precedence case and the explicit-body precedence case each stage their own body and record zero issue-view invocations on the injected runner." | diff-local |
| Story 1 negative: Given the issue lookup fails or reports the issue does not exist, when the per-idea worktree is created, then the command still succeeds, the worktree exists, and no staged outcomes file is written. | 2 | "The lookup-failure case and the not-found case each exit zero with the worktree directory present and no staged outcomes file on disk." | diff-local |
| Story 1 negative: Given a source ref that the GitHub issue-reference grammar cannot parse, when the per-idea worktree is created, then no issue lookup is attempted and the command still succeeds with the worktree present. | 2 | "The unparseable-reference case exits zero with the worktree present and records zero issue-view invocations on the injected runner." | diff-local |
| Story 2 happy: Given a source ref whose Desired-outcome body could not be resolved from any source, when the per-idea worktree is created, then the command's diagnostic output names the source ref, the staging file that was not written, and the argument that supplies the body directly. | 3 | "The unresolvable-reference case captures exactly one diagnostic line containing the source ref, the relative staging file path, and the body argument name." | diff-local |
| Story 2 negative: Given an idea with no source ref at all, when the per-idea worktree is created, then no missing-outcome diagnostic is emitted and the outcome layer stays not required, exactly as before. | 3 | "The no-source-ref case captures no missing-outcome diagnostic, exits zero, and leaves no staging file on disk." | diff-local |
| Story 2 negative: Given a source ref whose body resolved but carries no Desired-outcome bullets, when the per-idea worktree is created, then the staging file is written and no missing-outcome diagnostic is emitted. | 3 | "The bulletless-body case writes the staging file and captures no missing-outcome diagnostic." | diff-local |
| Story 3 happy: Given a coherence row cites an outcome id and the land resolved no outcome bullets at all, when the coherence gate refuses, then the refusal states that the outcome layer was never staged, names the staging file, and does not direct the operator to correct the coherence record. | 4 | "Zero resolved outcome bullets plus an outcome-citing row yields a refusal containing the staging file's relative path and a statement that the outcome layer was never staged." | diff-local |
| Story 3 negative: Given a coherence row cites an outcome id beyond a non-empty resolved outcome bullet set, when the coherence gate refuses, then the refusal keeps its existing wording naming the offending row and the cited id. | 4 | "Two resolved outcome bullets with an out-of-range outcome id, and zero resolved outcome bullets with a fabricated story citation, each yield the existing refusal text unchanged." | diff-local |
| Story 3 negative: Given a coherence row cites a non-outcome id and the land resolved no outcome bullets, when the coherence gate refuses, then the refusal keeps its existing wording naming the offending row and the cited id. | 4 | "Two resolved outcome bullets with an out-of-range outcome id, and zero resolved outcome bullets with a fabricated story citation, each yield the existing refusal text unchanged." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided entirely by the changed command branch or the changed refusal branch against controlled fixtures, and no commit outside this feature's diff can change whether it holds. Task 1 owns the cross-boundary integration proof — it drives the real dispatch entry point for the worktree subcommand end-to-end over a real temporary git repository, with the tracker runner injected as the single third-party boundary, so the proof is that the command reaches the seam and stages the file, not merely that a helper works. Tasks 2 and 3 extend that same entry-point fixture with the degradation and reporting cases rather than adding a second harness. Task 4 is unit-scoped against the exported gate function, whose boundary integration is already owned by the existing land path and needs no new entry-point test. No ordinary test may reach a real tracker, a real network, or a real language model. No terminal catch-all validation task is added; the existing suite and gates validate the completed feature.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 4
