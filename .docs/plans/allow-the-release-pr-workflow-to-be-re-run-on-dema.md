# Implementation Plan: On-demand regeneration of the bot-owned release PR

**Date:** 2026-09-06
**Stories:** .docs/stories/allow-the-release-pr-workflow-to-be-re-run-on-dema.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent adds a trigger and a ref guard to one workflow and changes no engine module, exported action, or artifact contract, so it cannot interact with another feature's stories.

## Summary

Three bounded tasks deliver #1274 by giving the release-PR maintenance workflow a manual trigger, restricting a manual run to the repository's default branch, and pinning that the manual path inherits the existing serialization and App-provenance contract. Candidate collection, rendering, completeness policy, and publication are reused unchanged and are outside this slice.

## Technical Approach

The maintenance workflow currently declares one trigger, a closed pull-request event. Add a bare manual trigger beside it — no inputs, because every value the job needs is already derived from repository state after checkout. Two places in the job are event-shaped and must tolerate an event that carries no pull request. The job's run condition becomes a disjunction: a manual event admits the job outright, while the event-driven path keeps its existing parenthesised requirement that the pull request be merged and that its head branch not be the bot-owned release branch. The checkout reference becomes a fallback expression, using the merge commit when the payload supplies one and the requested commit otherwise; leaving it empty would work by accident and would not read as a decision.

A manual trigger can be requested at any ref that carries the workflow file, and a run started at a feature branch would render from that branch's changelog and tag history. That is caught late and obscurely today — the generated-branch push compares the render's base head against the current default-branch head and throws a stale-render error — so add an explicit first step that fails fast instead. The guard runs only for the manual event, reads the requested ref and the repository's default branch through the step environment rather than interpolating them into the shell body, and exits nonzero with a message naming both. Placing it before checkout means the new early-exit branch cannot bypass any mutation the ordinary path performs.

Nothing else changes. Serialization is already a job-level concurrency group with cancellation disabled and is not keyed on the event, so a manual run and a merge-triggered run queue against the same group. Every mutation already runs under a GitHub App installation token minted inside the job, and the publisher workflow re-derives release authority from the merged release PR's App ownership and its head-bound candidate-audit check without ever inspecting which event produced that PR. The manual path therefore needs no publisher change.

Two contract tests already pin this workflow's shape and both must move with it. The shell contract test asserts the job condition begins with the merged-pull-request check; that assertion becomes a pair proving the manual disjunct is present and the event-driven requirement survives inside it, plus an assertion that the manual trigger is declared. The structural test suite parses this workflow with the installed YAML loader and asserts against the parsed mapping; extend it in the same style.

The guard's body is plain shell reading two environment variables, so prove it by executing it rather than by matching its text: extract the parsed step's script and run it under a shell with each environment combination, asserting status and message. This follows the local convention that an enforcement property is proved by running the mechanism, not by reading it. Comparable structural cases live beside this one in the same file; the YAML loader, the workspace-root resolution helper, and the mapping assertion helper are all already imported there. Tests may vary fixture grouping and assertion style; they must preserve execution of the real guard script and parsing of the real workflow file. No exact-copy pattern declaration applies. No third-party service, network call, or provider is reached.

## Preconditions and claim ledger

- Verified: the maintenance workflow declares exactly one trigger, a closed pull-request event, and no manual trigger.
- Verified: the maintenance job's condition requires the pull request to be merged and its head branch not to be the bot-owned release branch.
- Verified: the checkout step resolves its reference solely from the pull-request payload's merge commit.
- Verified: serialization is declared as a job-level concurrency group with cancellation disabled and is not keyed on the event.
- Verified: the job mints a GitHub App installation token inside the job and passes it to the maintenance script; the workflow-level permissions are read-only.
- Verified: the job resolves the base branch from the repository payload, the release baseline from Git tags, and candidates from the API — none of these read the pull-request payload.
- Verified: the generated-branch push rejects a render whose base head no longer matches the current default-branch head, and pushes under a lease; this is the late failure the new guard front-runs.
- Verified: the publisher workflow triggers on pushes to the default branch and re-derives authority from the merged release PR's App ownership and its head-bound candidate-audit check, never from the maintenance run's event.
- Verified: the shell contract test asserts the job condition begins with the merged-pull-request check, so it fails unless updated with this change.
- Verified: the structural test file already loads this workflow with the installed YAML loader and asserts against the parsed mapping, so no new dependency is introduced.
- Verified: the repository integrity suite invokes the shell contract test, so its update is exercised by the ordinary validation run.
- Scope check: A — harness-repo-only, decided by the repo-only signal for this repository's own CI; B — n/a, no new skill; C — provider-agnostic. Event spine: no new event, metric, span, log line, or report; no new channel.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree. No pending product or scope assumption remains.

## Tasks

### Task 1: Admit a manually requested maintenance run
**Story:** Story 1
**Type:** happy-path
**Files:** .github/workflows/release-pr.yml, src/conductor/test/structural/release-workflow.test.ts, test/test_release_pr_workflow.sh
**Dependencies:** none

**Steps:**
1. Write a failing structural case that loads the maintenance workflow with the installed YAML loader and asserts three properties of the parsed mapping: the trigger mapping carries a manual trigger key alongside the closed-pull-request trigger with its existing type list; the job condition admits a manual event and retains the merged and non-release-branch requirement for the event-driven path; the checkout step's reference falls back to the requested commit when the merge commit is absent.
2. Run the scoped test command for that file and confirm RED.
3. Add the bare manual trigger to the workflow's trigger mapping, leaving the closed-pull-request trigger and its type list untouched, and declare no inputs.
4. Rewrite the job condition as a disjunction whose first disjunct admits the manual event and whose second disjunct is the existing merged and non-release-branch requirement, kept together in parentheses.
5. Change the checkout reference to use the pull-request merge commit when present and the requested commit otherwise.
6. Replace the shell contract test's single condition assertion with one assertion for the manual disjunct and one for the surviving event-driven requirement, and add an assertion that the manual trigger is declared; leave every other assertion in that script unchanged.
7. Run the scoped test command and the shell contract test, confirm GREEN, and commit the focused change.

**Done when:**
1. A structural case proves the parsed trigger mapping carries both the manual trigger and the closed-pull-request trigger with its existing type list.
2. A structural case proves the parsed job condition admits a manual event while still requiring a merged pull request whose head branch is not the bot-owned release branch on the event-driven path.
3. A structural case proves the parsed checkout reference resolves to the requested commit when no merge commit is supplied.
4. The shell contract test asserts the manual disjunct and the surviving event-driven requirement separately, and every other assertion in that script is unchanged and still passes.

### Task 2: Bind serialization and App provenance to the job rather than the trigger
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/structural/release-workflow.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing structural case that asserts, over the same parsed workflow, that the trigger mapping carries the manual trigger and that the job declares exactly one concurrency group with cancellation disabled at job level.
2. Extend that case to assert the App token step and the maintenance script step carry no event-specific condition, and that the script step receives its token from the App token step's output rather than any other source.
3. Extend that case to assert the workflow-level permission mapping grants no write, so every write still depends on the App installation token.
4. Run the scoped test command for that file and confirm RED, since the manual-trigger assertion cannot hold before Task 1.
5. Confirm the case passes against the workflow as Task 1 left it, adding no workflow change; if any assertion fails, correct the workflow rather than relaxing the assertion.
6. Run the scoped test command, confirm GREEN, and commit the focused change.

**Done when:**
1. A structural case proves the workflow declares the manual trigger and declares its concurrency group with cancellation disabled once at job level, so both trigger paths queue against the same group.
2. A structural case proves the App token step and the maintenance script step carry no event-specific condition and that the script step's token comes from the App token step's output.
3. A structural case proves the workflow-level permission mapping grants no write permission.

### Task 3: Reject a manual run requested away from the default branch
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** .github/workflows/release-pr.yml, src/conductor/test/structural/release-workflow.test.ts, test/test_release_pr_workflow.sh
**Dependencies:** 1

**Steps:**
1. Write a failing structural case that reads the parsed job's first step, asserts it is conditioned on the manual event, asserts it precedes the checkout step, and asserts its script body interpolates no workflow expression.
2. Extend that case to execute the extracted script body under a shell twice: once with the requested ref set to a non-default branch name and once with it equal to the default branch name, both supplied through the child environment.
3. Run the scoped test command for that file and confirm RED.
4. Add the guard as the job's first step, conditioned on the manual event, reading the requested ref and the repository's default branch into named environment variables and comparing them in the script body.
5. Make the mismatch branch print a message naming both the default branch and the requested ref and exit nonzero; make the matching branch exit zero and print nothing that would mask a later failure.
6. Add a shell contract assertion that the guard step exists and reads both values from the step environment rather than interpolating them into the script body.
7. Run the scoped test command and the shell contract test, confirm GREEN, and commit the focused change.

**Done when:**
1. Executing the extracted guard script with a non-default requested ref exits nonzero and emits a message containing both the default branch name and the requested ref.
2. Executing the extracted guard script with the requested ref equal to the default branch exits zero.
3. A structural case proves the guard is the job's first step, is conditioned on the manual event, precedes the checkout step, and interpolates no workflow expression into its script body.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the release-PR maintenance workflow, when its declared triggers are read, then it offers a manual trigger in addition to the closed-pull-request trigger. | 1 | "A structural case proves the parsed trigger mapping carries both the manual trigger and the closed-pull-request trigger with its existing type list." | diff-local |
| Story 1 happy: Given a manual trigger, when the maintenance job's run condition is evaluated, then the job runs even though the event carries no merged pull request. | 1 | "A structural case proves the parsed job condition admits a manual event while still requiring a merged pull request whose head branch is not the bot-owned release branch on the event-driven path." | diff-local |
| Story 1 happy: Given a manual trigger, when the job resolves the commit to check out, then it checks out the commit the run was requested at rather than an absent merge commit. | 1 | "A structural case proves the parsed checkout reference resolves to the requested commit when no merge commit is supplied." | diff-local |
| Story 1 negative: Given a pull request that closes without merging, when the workflow receives that event, then the maintenance job does not run. | 1 | "A structural case proves the parsed job condition admits a manual event while still requiring a merged pull request whose head branch is not the bot-owned release branch on the event-driven path." | diff-local |
| Story 1 negative: Given a merged pull request whose head branch is the bot-owned release branch, when the workflow receives that event, then the maintenance job does not run. | 1 | "The shell contract test asserts the manual disjunct and the surviving event-driven requirement separately, and every other assertion in that script is unchanged and still passes." | diff-local |
| Story 2 happy: Given a manual run and a merge-triggered run of the same workflow, when both are queued, then both belong to the one release-PR maintenance concurrency group that does not cancel a run already in progress. | 2 | "A structural case proves the workflow declares the manual trigger and declares its concurrency group with cancellation disabled once at job level, so both trigger paths queue against the same group." | diff-local |
| Story 2 happy: Given a manual run, when it updates the release branch and publishes candidate audit evidence, then it does so through the same GitHub App installation token and write grants the merge-triggered run uses, with no trigger-specific credential path. | 2 | "A structural case proves the App token step and the maintenance script step carry no event-specific condition and that the script step's token comes from the App token step's output." | diff-local |
| Story 2 negative: Given a manual run requested at a ref other than the repository's default branch, when the workflow evaluates the requested ref, then the run fails with a message naming both the default branch and the requested ref, before any checkout or release-branch mutation. | 3 | "Executing the extracted guard script with a non-default requested ref exits nonzero and emits a message containing both the default branch name and the requested ref." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: each is decided entirely by the workflow file and the two contract tests in this diff, and no commit outside the diff can change whether one holds. Task 1 owns the trigger, condition, and checkout-reference dispositions at the structural level, plus the shell contract test's condition assertions. Task 3 owns the guard, and proves it by executing the real extracted script rather than matching its text — the lowest sufficient level for a shell enforcement property. Task 2 owns the serialization and provenance dispositions over the same parsed workflow. The changed production boundary is the workflow's trigger surface, and Task 1 owns its integration proof: the parsed trigger mapping and job condition are exactly what GitHub consumes to decide whether a manually requested run starts, so asserting them is an assertion about the entry point rather than about a helper. No test reaches a real LLM, GitHub, or network service, and no aggregate or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
