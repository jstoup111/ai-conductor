# Implementation Plan: Operator CLI prunes shipped features' DECIDE artifacts

**Date:** 2026-10-21
**Stories:** .docs/stories/shipped-features-decide-artifacts-accumulate-in-do.md
**Conflict check:** Clean as of 2026-10-21 (.docs/conflicts/2026-10-21-shipped-features-decide-artifacts-accumulate-in-do.md)

## Summary

Add the operator-run `ai-conductor docs-prune` command. It removes the transient DECIDE artifacts of
shipped stems from `main` through one reviewed, docs-only PR, defers any stem that open work
touches, and reports on the event spine. Shipment repair and the shipment audit gain one shared
pruned-plan lookup. 16 tasks. Source: jstoup111/ai-conductor#2963.

## Technical Approach

- **Governing decisions:** `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts` D1–D6.
  The track's scope boundary is binding:
  - operator-run only, with no daemon sweep, finish-time prune or CI trigger;
  - no change to `spec_hash`, shipment evidence or the protected-artifact seal;
  - repository-wide `.docs` files are never touched.
- **Retention policy (Task 1).** A new module, `src/conductor/src/engine/docs-retention.ts`, exports
  one `DOCS_RETENTION_POLICY` constant with the kept families, the prunable families and the
  repository-wide exclusions, plus a pure `prunableFilesForStem` matcher.
  - Matching reuses the existing identity helpers in `artifacts.ts` (`plan-stem` and
    `normalized-stem` with `stripDatePrefix`), so stem identity has one definition.
  - Prefix collisions (`alpha` against `alpha-two`) are excluded by that exact-identity match.
- **Selection (Task 2).** `src/conductor/src/engine/docs-prune.ts` reads `origin/main` with one
  `git ls-tree -r --name-only origin/main -- .docs` after `git fetch origin main`.
  - It selects stems that have `.docs/shipped/<stem>.md` in that tree.
  - Stems without a record are reported as skipped with `no-shipped-record`.
  - An undated form matching more than one plan stem in the tree excludes undated-only matches,
    which are reported as excluded. This mirrors `daemon-backlog.ts` `undatedPlanStemCounts`.
- **Open-PR files (Task 3).** The module-private paginated GraphQL file reader in
  `shipment-audit.ts` moves to a new `src/conductor/src/engine/pull-request-files.ts`.
  - It exports `listPullRequestsWithFiles({ state })` and keeps `graphqlPage`'s retry, the
    `MAX_GRAPHQL_PAGES` bound, and `nextCursor`'s refusal of a repeated or missing cursor.
  - The audit calls it with `MERGED`, and docs-prune calls it with `OPEN`.
  - It reads `author { login }` and `headRefName` per PR, so docs-prune can recognise its own PR and
    another operator's.
- **Deferral (Task 4).** Pure set logic in `docs-prune.ts`. A stem is deferred whole when any open
  PR, other than the operator's own `docs-prune/*` PR, changes any path of its prune set. The
  deferral reason is the closed union `open-pr-modifies`, and the skip reason is
  `no-shipped-record`.
- **Publication (Tasks 5–7).** A `DocsPrunePublisher` in `docs-prune.ts` follows the guarded
  repair-publication pattern.
  - **Pattern traits to keep:** commit in a detached temp worktree (`git worktree add --detach`)
    from the fetched start point; check `git diff --cached --name-only` against the expected set
    before committing; push only `HEAD:refs/heads/docs-prune/<date>` through `executeRemoteGit`;
    always remove the temp worktree in `finally`; never push `main`, enable auto-merge or merge.
  - **Search hints:** `shipment-evidence-cli.ts` `makeProductionRepairPublisher` and
    `shipment-reconciliation.ts` `publishShipmentRepair`.
  - **Allowed variation:** the commit deletes paths instead of writing one record, the branch
    prefix is `docs-prune/`, and the PR body is the docs-prune report.
  - **Authorization (ADR D4):** each remote write uses
    `github-operation-approval.ts` `requestExplicitGithubOperationApproval` with an interactive
    confirmation adapter. That covers the push (`explicitApproval` on `executeRemoteGit`), and
    `pull-request.create` or `pull-request.edit` (a guarded runner carrying the approval
    capability). This is the pattern `github-shared-operations.ts`
    `executeSharedGithubOperation` uses. A declined or non-interactive confirmation refuses that
    write.
  - **Verified no-fit:** `makeProductionRepairPublisher` itself is record-only
    (`commitRecordOnly`, `shipment-repair/` branches, CI repository from `GITHUB_REPOSITORY`), so
    docs-prune gets its own publisher rather than a widened repair publisher.
- **Reporting (Task 8).** A new `decide_artifacts_pruned` member of the `ConductorEventBody` union
  in `src/conductor/src/types/events.ts` carries `removed: string[]`,
  `deferred: { stem; paths; reason: 'open-pr-modifies'; pullRequests: string[] }[]`,
  `skipped: { stem; reason: 'no-shipped-record' }[]`, `excluded: string[]` and an optional
  `pullRequestUrl`. A pure `renderDocsPruneReport` produces the PR body from the same data.
- **Command (Task 9).** It is registered in `src/conductor/src/cli.ts` (commander, for `--help`),
  `src/conductor/src/cli-pre-dispatch.ts` (router table) and `src/conductor/src/index.ts`
  (`detectDocsPruneCommand` then `dispatchDocsPrune`).
  - It persists events with `EventPersister` to `<repo root>/.pipeline/events.jsonl`, which is
    git-ignored, as `rewind.ts` does.
  - `docs-prune` is not added to the daemon-session sanctioned set, so
    `guardDaemonSessionInvocation` refuses it inside a dispatched session.
- **Pruned-plan lookup (Tasks 10–12).** A new `src/conductor/src/engine/pruned-plan.ts` exports
  `readPlanOrPruned(readAt, git, commit, planPath)`.
  - It returns the plan at `commit` when present.
  - Otherwise it reads `git log -1 --diff-filter=D --format=%H <commit> -- <planPath>` and returns
    `git show <sha>^:<planPath>`.
  - Otherwise it returns `{ kind: 'refused', code: 'shipment-plan-pruned', path, detail }`.
  - `expectedReconciledRecord` (`shipment-evidence-cli.ts`) and `enumerateCommittedSources`
    (`shipment-audit.ts`) call it.
- **In-flight safety (Tasks 13–15).** No production change. #1752's inherited-deletion tolerance,
  `.docs/shipped` dedup, and the rebase path already deliver Story 4. These tasks pin that behavior
  with real-git tests and are Verify-only.

## Prerequisites

- None. #1752 (PR #3041) and #2961 are on `main`. The halt-record D7 and retro-removal D5 amendments
  are committed on this spec branch.

## Tasks

### Task 1: Define the retention policy and stem matcher
**Story:** Story 1
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/docs-retention.test.ts` over an in-memory path list containing every `.docs` family for stems `alpha`, `alpha-two`, `2026-10-01-alpha` and the repository-wide files.
2. Verify RED.
3. Implement `DOCS_RETENTION_POLICY` and `prunableFilesForStem(paths, stem)` in `src/conductor/src/engine/docs-retention.ts`, matching by plan stem, undated stem, and the family's `normalized-stem` identity through the existing `artifacts.ts` identity helper.
4. Verify GREEN and commit: "feat(docs-prune): retention policy and stem matcher".

**Done when:**
- [test] `prunableFilesForStem` for `alpha` returns exactly the `alpha` file of each of the ten prunable families, including `.docs/halted/alpha.md`, and no other path.
- [test] `prunableFilesForStem` for `2026-10-01-alpha` returns `.docs/conflicts/alpha.md` and `.docs/retros/2026-10-02-alpha.md` through normalized-stem matching.
- [test] `prunableFilesForStem` for `alpha` returns none of the seven kept-family files, no `alpha-two` file, and no file under `.docs/audit`, `.docs/audits`, `.docs/baselines`, `.docs/observation` or top-level `.docs/*.md`.
- `DOCS_RETENTION_POLICY` is the only definition of the prunable and kept family lists in `src/conductor/src`, and `prunableFilesForStem` reads its families from it.

**Files:** src/conductor/src/engine/docs-retention.ts; src/conductor/test/engine/docs-retention.test.ts

### Task 2: Select shipped stems' prunable files from origin/main
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/docs-prune-selection.realgit.test.ts` with a bare origin whose `main` holds shipped `alpha`, shipped `2026-10-01-alpha`, unshipped `2026-10-20-alpha`, unshipped `beta`, and a local branch carrying `.docs/shipped/gamma.md` that is not on `origin/main`.
2. Verify RED.
3. Implement `resolveDocsPruneSelection(repoDir, git)` in `src/conductor/src/engine/docs-prune.ts`: fetch `origin main`, list `.docs` at `origin/main`, select stems with a shipped record there, apply `prunableFilesForStem`, report stems without a record as `no-shipped-record`, and exclude undated-only matches whose undated stem maps to more than one plan stem.
4. Verify GREEN and commit: "feat(docs-prune): select shipped stems from origin/main".

**Done when:**
- [test] `resolveDocsPruneSelection` over the fixture selects every prunable file of shipped `alpha` from the `origin/main` tree and reports unshipped `beta` as skipped with reason `no-shipped-record` and none of its files selected.
- [test] `resolveDocsPruneSelection` selects no `gamma` file, because `.docs/shipped/gamma.md` exists only on a local branch and not on `origin/main`.
- [test] With shipped `2026-10-01-alpha` and unshipped `2026-10-20-alpha` both having plans on `origin/main`, `resolveDocsPruneSelection` does not select `.docs/conflicts/alpha.md` and lists it in `excluded` because its undated stem matches more than one plan.

**Files:** src/conductor/src/engine/docs-prune.ts; src/conductor/test/engine/docs-prune-selection.realgit.test.ts

### Task 3: Read every PR's changed files through one paginated reader
**Story:** Story 3
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/pull-request-files.test.ts` with a mocked `runTrackerGraphqlRead`: an `OPEN` PR whose files span two pages (100 + 50), a repeated file cursor, and a page with `hasNextPage: true` and no `endCursor`.
2. Verify RED.
3. Move `graphqlPage`, `remainingChangedPaths`, `nextCursor`, `pageInfo` and the queries from `src/conductor/src/engine/shipment-audit.ts` into `src/conductor/src/engine/pull-request-files.ts` as `listPullRequestsWithFiles({ runGh, cwd, state })`, with `state` interpolated as `OPEN` or `MERGED` and `author { login }` and `headRefName` added per PR. Keep the retry, the `MAX_GRAPHQL_PAGES` bound, and the fail-closed cursor checks unchanged.
4. Switch `shipment-audit.ts` `enumerateMergedPullRequests` to `listPullRequestsWithFiles({ state: 'MERGED' })`.
5. Verify GREEN (including `src/conductor/test/engine/shipment-audit.test.ts`) and commit: "refactor(github): share the paginated pull-request file reader".

**Done when:**
- [test] `listPullRequestsWithFiles({ state: 'OPEN' })` returns all 150 changed paths of a PR whose files span two GraphQL pages, with the PR's url, author login and head ref.
- [test] `listPullRequestsWithFiles` rejects with an error naming incomplete pagination for a repeated file cursor and for a page reporting `hasNextPage` with no `endCursor`.
- [test] The existing `shipment-audit.test.ts` merged-PR enumeration tests pass unchanged against `listPullRequestsWithFiles({ state: 'MERGED' })`.

**Files:** src/conductor/src/engine/pull-request-files.ts; src/conductor/src/engine/shipment-audit.ts; src/conductor/test/engine/pull-request-files.test.ts; src/conductor/test/engine/shipment-audit.test.ts

### Task 4: Defer whole stems that an open PR touches
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 2, Task 3

**Steps:**
1. Write failing tests in `src/conductor/test/engine/docs-prune-deferral.test.ts` over a selection for `alpha` and `gamma` and a list of open PRs with files.
2. Verify RED.
3. Implement `applyOpenPullRequestDeferral(selection, openPullRequests, operatorLogin)` in `src/conductor/src/engine/docs-prune.ts`: defer a stem's whole prune set when any open PR, other than a `docs-prune/*` PR authored by `operatorLogin`, changes any of its paths; record each deferring PR url.
4. Verify GREEN and commit: "feat(docs-prune): defer stems touched by open pull requests".

**Done when:**
- [test] An open PR changing only `.docs/coherence/alpha.md` makes `applyOpenPullRequestDeferral` move every `alpha` path out of `removable` and record `alpha` as deferred with reason `open-pr-modifies` naming that PR's url.
- [test] An open PR whose 150th changed file is the `alpha` plan file defers `alpha` with reason `open-pr-modifies`.
- [test] With only `alpha` touched, every `gamma` path stays in `removable` and `alpha` is deferred.
- [test] When the only PR touching `alpha` is a `docs-prune/*` PR authored by `operatorLogin`, `alpha` is not deferred and all its paths stay in `removable`.

**Files:** src/conductor/src/engine/docs-prune.ts; src/conductor/test/engine/docs-prune-deferral.test.ts

### Task 5: Commit the deletions as one docs-only commit in a temporary worktree
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 2

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/docs-prune-commit.realgit.test.ts`: a commit of the removable set, and a staged set that includes an extra path.
2. Verify RED.
3. Implement `commitDocsPruneDeletion({ repoDir, startPoint, removable })` in `src/conductor/src/engine/docs-prune.ts` following the repair-publication traits: `git worktree add --detach` from the fetched start point, `git rm` exactly the removable paths, compare `git diff --cached --name-status` against the removable set (every line `D` and every path in the set), commit, and remove the temp worktree in `finally`. Do not touch the caller's checkout.
4. Verify GREEN and commit: "feat(docs-prune): docs-only deletion commit".

**Done when:**
- [test] `commitDocsPruneDeletion` returns a commit whose `git show --name-status` lists exactly the removable paths, each with status `D`, and no other path.
- [test] When the staged change includes a path outside the removable set, `commitDocsPruneDeletion` throws naming that path and creates no commit.
- [test] After `commitDocsPruneDeletion`, the root checkout's `git status --porcelain` output and every tracked file are unchanged, local `main` points at the same commit, and `git worktree list` shows no temporary worktree.

**Files:** src/conductor/src/engine/docs-prune.ts; src/conductor/test/engine/docs-prune-commit.realgit.test.ts

### Task 6: Publish the docs-prune branch and PR under exact operator approval
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 5, Task 8

**Steps:**
1. Write failing tests in `src/conductor/test/engine/docs-prune-publish.test.ts` with mocked `executeRemoteGit`, guarded `gh` transport and an interactive confirmation adapter.
2. Verify RED.
3. Implement `publishDocsPrune` in `src/conductor/src/engine/docs-prune.ts`: request exact approval with `requestExplicitGithubOperationApproval` for the push to `refs/heads/docs-prune/<date>` and pass it as `explicitApproval` to `executeRemoteGit`; then either `pull-request.create` (head `docs-prune/<date>`, base `main`, body from `renderDocsPruneReport`) or, when the operator's own open `docs-prune/*` PR exists, push to its head branch and `pull-request.edit` its body, each through `createGuardedGithubOperationRunner` with `shared: { approval }` as `github-shared-operations.ts` does.
4. Verify GREEN and commit: "feat(docs-prune): guarded publication under operator approval".

**Done when:**
- [test] With no open docs-prune PR, `publishDocsPrune` pushes only `refs/heads/docs-prune/<date>` and issues one `pull-request.create` with head `docs-prune/<date>` and base `main`, each after an approved confirmation bound to that exact operation and target.
- [test] With the operator's own open `docs-prune/*` PR and a newly shipped stem, `publishDocsPrune` pushes to that PR's head branch a commit deleting the current removable paths including the newly shipped stem's, issues `pull-request.edit` on it, and issues no `pull-request.create`, so exactly one open docs-prune PR exists after two runs.
- [test] Across every `publishDocsPrune` test, the recorded remote calls contain no push to `main`, no auto-merge request and no merge request.

**Files:** src/conductor/src/engine/docs-prune.ts; src/conductor/test/engine/docs-prune-publish.test.ts

### Task 7: Refuse publication on push failure, declined approval, or another operator's PR
**Story:** Story 2
**Type:** negative-path
**Dependencies:** Task 6

**Steps:**
1. Write failing tests in `src/conductor/test/engine/docs-prune-publish.test.ts` for a refused push, a declined confirmation, a non-interactive confirmation adapter, and an open `docs-prune/*` PR authored by another login.
2. Verify RED.
3. Implement the refusals in `publishDocsPrune`: a non-`executed` push result or a refused approval throws `DocsPruneRefusal` naming the operation, before any PR write; another operator's open `docs-prune/*` PR throws naming that PR's url before any push.
4. Verify GREEN and commit: "fix(docs-prune): refuse publication without approval or ownership".

**Done when:**
- [test] When `executeRemoteGit` returns a refusal for the push, `publishDocsPrune` throws `DocsPruneRefusal` naming the push failure, issues no `pull-request.create` or `pull-request.edit`, and the fixture origin's `main` ref is unchanged.
- [test] When the confirmation adapter declines the push prompt or is non-interactive, `publishDocsPrune` throws `DocsPruneRefusal` naming the refused operation, and nothing is pushed and no PR is created or edited.
- [test] When an open `docs-prune/*` PR authored by a different login exists, `publishDocsPrune` throws `DocsPruneRefusal` naming that PR's url, pushes nothing, and issues no write to that PR.

**Files:** src/conductor/src/engine/docs-prune.ts; src/conductor/test/engine/docs-prune-publish.test.ts

### Task 8: Add the decide_artifacts_pruned event and the PR-body report
**Story:** Story 5
**Type:** infrastructure
**Dependencies:** Task 4

**Steps:**
1. Write failing tests in `src/conductor/test/engine/docs-prune-report.test.ts` and a type-level test in `src/conductor/test/types/docs-prune-events.test.ts`.
2. Verify RED.
3. Add the `decide_artifacts_pruned` member to `ConductorEventBody` in `src/conductor/src/types/events.ts` with `removed`, `deferred` (reason `'open-pr-modifies'`), `skipped` (reason `'no-shipped-record'`), `excluded` and optional `pullRequestUrl`; implement `renderDocsPruneReport(outcome)` and `docsPruneEvent(outcome, pullRequestUrl?)` in `src/conductor/src/engine/docs-prune.ts`.
4. Verify GREEN and commit: "feat(events): decide_artifacts_pruned event and docs-prune report".

**Done when:**
- [test] `renderDocsPruneReport` lists every removed path, and every deferred stem with its paths, its reason `open-pr-modifies`, and each deferring PR url.
- [test] `docsPruneEvent` for an outcome with nothing removed returns a `decide_artifacts_pruned` event with an empty `removed` list and no `pullRequestUrl`.
- [test] A type test proves the deferred reason accepts exactly `open-pr-modifies` and the skipped reason exactly `no-shipped-record`, and rejects any other string (`@ts-expect-error`).

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/docs-prune.ts; src/conductor/test/engine/docs-prune-report.test.ts; src/conductor/test/types/docs-prune-events.test.ts

### Task 9: Register and run the docs-prune command end to end
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 4, Task 7, Task 8

**Steps:**
1. Write failing tests in `src/conductor/test/engine/docs-prune-cli.realgit.test.ts` driving `dispatchDocsPrune` against a bare origin, a mocked guarded tracker (open-PR pages) and an approving confirmation adapter.
2. Verify RED.
3. Implement `src/conductor/src/engine/docs-prune-cli.ts`: `detectDocsPruneCommand(argv)` and `dispatchDocsPrune(cmd, cwd, deps)` that resolves the selection, reads open PRs with `listPullRequestsWithFiles({ state: 'OPEN' })`, applies deferral, commits and publishes when anything is removable, emits one `decide_artifacts_pruned` event through `ConductorEventEmitter` persisted by `EventPersister` to `<repo root>/.pipeline/events.jsonl`, prints the report, and returns 0. Any thrown read, pagination, commit or publication error returns non-zero after printing it, and emits no event.
4. Register `docs-prune` in `src/conductor/src/cli.ts`, `src/conductor/src/cli-pre-dispatch.ts`, and the `src/conductor/src/index.ts` dispatch chain. Do not add it to the daemon-session sanctioned set.
5. Verify GREEN and commit: "feat(cli): ai-conductor docs-prune".

**Done when:**
- [test] `dispatchDocsPrune` over a fixture with shipped stems returns 0 and the bare origin then has one `docs-prune/<date>` branch whose single commit deletes exactly the removable paths, with one PR opened for it.
- [test] `dispatchDocsPrune` over a fixture with no prunable file on `origin/main` returns 0, prints that nothing was pruned, pushes no branch, creates no PR, and persists one `decide_artifacts_pruned` event with an empty `removed` list and no `pullRequestUrl`.
- [test] After a run that removes paths and defers a stem, `<repo root>/.pipeline/events.jsonl` holds exactly one `decide_artifacts_pruned` event carrying the removed paths, the deferred stems with reason `open-pr-modifies`, and the PR url, and the opened PR body equals `renderDocsPruneReport` for that outcome.
- [test] `guardDaemonSessionInvocation(['node', 'ai-conductor', 'docs-prune'], { CONDUCT_DAEMON_SESSION: '1' })` returns a refusal naming the blocked `docs-prune` subcommand, and the `index.ts` entry runs that guard before any git or GitHub call and exits non-zero printing that refusal.
- [test] A source test enumerates every importer of `docs-prune.ts` and `docs-prune-cli.ts` under `src/conductor/src` and finds only `index.ts` (the `ai-conductor docs-prune` command dispatch) and `docs-prune-cli.ts`, and finds no `docs-prune` reference in `.github/workflows`, so no daemon tick, finish step or CI workflow can run the prune.

**Files:** src/conductor/src/engine/docs-prune-cli.ts; src/conductor/src/cli.ts; src/conductor/src/cli-pre-dispatch.ts; src/conductor/src/index.ts; src/conductor/test/engine/docs-prune-cli.realgit.test.ts

### Task 10: Fail the command closed on an incomplete read or a refused publication
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 9

**Steps:**
1. Write failing tests in `src/conductor/test/engine/docs-prune-cli.realgit.test.ts` where the mocked tracker read throws, returns a repeated cursor, or returns a page with `hasNextPage: true` and no cursor; where the commit guard rejects an extra staged path; and where publication is refused (push refused, approval declined, non-interactive, another operator's PR).
2. Verify RED.
3. Ensure `dispatchDocsPrune` resolves the open-PR read before any commit, push or PR call, and maps each failure to a non-zero return with a message naming the failed read or the incomplete pagination, emitting no `decide_artifacts_pruned` event. Map a `commitDocsPruneDeletion` guard error and every `DocsPruneRefusal` from `publishDocsPrune` to a non-zero return that prints the refusal message.
4. Verify GREEN and commit: "fix(docs-prune): publish nothing when the open-PR read is incomplete".

**Done when:**
- [test] When the guarded tracker read of open PRs throws, `dispatchDocsPrune` returns non-zero, prints a message naming the failed read, creates no commit, pushes nothing, and creates no PR.
- [test] When the open-PR file read returns a repeated cursor, or a page reporting more files with no next cursor, `dispatchDocsPrune` returns non-zero naming the incomplete pagination, pushes nothing, and creates no PR.
- [test] In each of those failures `<repo root>/.pipeline/events.jsonl` contains no `decide_artifacts_pruned` event that lists any path as removed.
- [test] When `commitDocsPruneDeletion` throws because the staged change includes a path outside the removable set, `dispatchDocsPrune` returns non-zero naming that unexpected path and pushes nothing.
- [test] When `publishDocsPrune` throws `DocsPruneRefusal` for a refused push, a declined or non-interactive approval, or another operator's open `docs-prune/*` PR, `dispatchDocsPrune` returns non-zero and prints the refusal naming the push failure, the refused operation, or that PR's url respectively.

**Files:** src/conductor/src/engine/docs-prune-cli.ts; src/conductor/test/engine/docs-prune-cli.realgit.test.ts

### Task 11: Look up a pruned plan from the parent of its deleting commit
**Story:** Story 6
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/pruned-plan.realgit.test.ts`: a plan present at the commit, a plan deleted once, a plan deleted, re-added with new content and deleted again, a plan never on the reachable history, and a git runner that fails the `log` call.
2. Verify RED.
3. Implement `readPlanOrPruned(readAt, git, commit, planPath)` in `src/conductor/src/engine/pruned-plan.ts`: return the plan at `commit` when present without running `git log`; otherwise run `git log -1 --diff-filter=D --format=%H <commit> -- <planPath>` and return `git show <sha>^:<planPath>`; otherwise return a `shipment-plan-pruned` refusal naming the path, and when the `log` read fails, the failure.
4. Verify GREEN and commit: "feat(shipment): shared pruned-plan lookup".

**Done when:**
- [test] For a plan present at the commit, `readPlanOrPruned` returns that content and the recorded git calls contain no `log` call.
- [test] For a plan deleted, re-added with new content and deleted again, `readPlanOrPruned` returns the content from just before the most recent deletion.
- [test] For a plan never deleted by a commit reachable from the commit read, `readPlanOrPruned` returns a refusal with code `shipment-plan-pruned` naming the plan path, and when the `git log` call fails it returns that code naming the path and the failed read.

**Files:** src/conductor/src/engine/pruned-plan.ts; src/conductor/test/engine/pruned-plan.realgit.test.ts

### Task 12: Rebuild a pruned stem's record in record-only repair
**Story:** Story 6
**Type:** happy-path
**Dependencies:** Task 11

**Steps:**
1. Write failing tests in `src/conductor/test/engine/shipment-evidence-cli.test.ts`: repair for a stem whose plan was pruned on `main`, and for a stem whose plan never existed on the reachable history.
2. Verify RED.
3. Change `expectedReconciledRecord` in `src/conductor/src/engine/shipment-evidence-cli.ts` to read the plan through `readPlanOrPruned`, and replace the `plan … is unavailable` error with a `shipment-plan-pruned` error naming the path (and the failed read, when present).
4. Verify GREEN and commit: "fix(shipment): repair reads pruned plans from history".

**Done when:**
- [test] For a stem whose plan was pruned, record-only repair renders a `.docs/shipped/<slug>.md` whose content is byte-identical to the record it renders for that stem at the commit before the prune.
- [test] For a stem whose plan never existed on the reachable history, record-only repair fails with an error containing `shipment-plan-pruned` and `.docs/plans/<slug>.md`, and the error text does not contain `is unavailable`.
- [test] When the history lookup's git read fails, record-only repair fails with `shipment-plan-pruned` naming the path and the failed read.

**Files:** src/conductor/src/engine/shipment-evidence-cli.ts; src/conductor/test/engine/shipment-evidence-cli.test.ts

### Task 13: Classify pruned stems in the shipment audit
**Story:** Story 6
**Type:** happy-path
**Dependencies:** Task 3, Task 11

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/shipment-audit.test.ts`: a shipped stem audited before and after its plan's prune commit, a plan only on an unmerged branch, and a failing history read.
2. Verify RED.
3. In `enumerateCommittedSources` (`src/conductor/src/engine/shipment-audit.ts`), for a plan absent at the audit head call `readPlanOrPruned`; a found plan carries no `reason`, and a refusal sets `reason` to `shipment-plan-pruned` (with the failed read, when present), so `auditSource` classifies it `unresolved` and continues with the other rows.
4. Verify GREEN and commit: "fix(shipment): audit pruned stems from their pre-deletion plan".

**Done when:**
- [test] `runShipmentAudit` reports a shipped stem `aligned` at a head where its plan was pruned, using the plan content `readPlanOrPruned` returned from the parent of the deleting commit, matching the classification it reports at the commit before the prune.
- [test] `runShipmentAudit` classifies a plan that exists only on an unmerged branch as `unresolved` with reason `shipment-plan-pruned`, and every other row in the same report still has a classification.
- [test] When the history read fails for a pruned plan, `runShipmentAudit` classifies that row `unresolved` with reason `shipment-plan-pruned` instead of `aligned`.
- [test] For a plan present at the audit head, `runShipmentAudit` classifies the row as before and the recorded git calls contain no `--diff-filter=D` lookup for that plan.

**Files:** src/conductor/src/engine/shipment-audit.ts; src/conductor/test/engine/shipment-audit.test.ts

### Task 14: Prove a sealed in-flight feature survives a merged prune
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 5
**Verify-only:** yes

**Steps:**
1. Write a real-git test in `src/conductor/test/engine/docs-prune-inflight.realgit.test.ts`: an in-flight feature worktree sealed over the plan file of shipped `alpha` that it never modified; merge a `commitDocsPruneDeletion` commit into origin `main`; rebase the feature; run `verifyProtectedArtifactSeal`.
2. Confirm it passes against current `protected-artifact-seal.ts` (#1752); commit: "test(docs-prune): sealed in-flight feature survives a merged prune".

**Done when:**
- [test] After the merged prune and the rebase, `verifyProtectedArtifactSeal` returns ok, no `.pipeline/HALT` file exists in the feature worktree, and the persisted seal no longer lists the `alpha` plan file.
- [test] The same fixture with the feature having modified the `alpha` plan file still refuses, proving the tolerance is limited to untouched paths.

**Files:** src/conductor/test/engine/docs-prune-inflight.realgit.test.ts

### Task 15: Prove discovery is unchanged by a merged prune
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 5
**Verify-only:** yes

**Steps:**
1. Write a real-git test in `src/conductor/test/engine/docs-prune-discovery.realgit.test.ts`: `discoverBacklog` on `main` before and after a merged prune of shipped `alpha`, with an unshipped `2026-10-20-alpha` plan present and `alpha`'s undated markers removed.
2. Confirm it passes against current `daemon-backlog.ts`; commit: "test(docs-prune): discovery unchanged after a prune".

**Done when:**
- [test] `discoverBacklog` returns the same eligible set before and after the merged prune, and no pruned shipped stem is dispatched.
- [test] After the prune, the unshipped `2026-10-20-alpha` candidate's resolved markers include none of `alpha`'s former prunable files.

**Files:** src/conductor/test/engine/docs-prune-discovery.realgit.test.ts

### Task 16: Prove a local edit to a pruned path is never silently discarded
**Story:** Story 4
**Type:** negative-path
**Dependencies:** Task 5
**Verify-only:** yes

**Steps:**
1. Write a real-git test in `src/conductor/test/engine/docs-prune-inflight.realgit.test.ts`: an in-flight feature with an unpushed commit editing `.docs/coherence/alpha.md`; merge a prune deleting it into origin `main`; rebase the feature through the engine's rebase entry (`rebase.ts` with its `.docs` tier-1 resolution).
2. Confirm the outcome against current code; commit: "test(docs-prune): local edits to pruned paths are not discarded".

**Done when:**
- [test] After the rebase, either `.docs/coherence/alpha.md` on the feature branch holds the feature's edited content, or the rebase result is a stop whose conflict list names `.docs/coherence/alpha.md`; the edited content is never absent with a successful rebase.
- [test] The test records which of the two outcomes occurred in its assertion message, so a behavior change between them is visible in the test name and failure.

**Files:** src/conductor/test/engine/docs-prune-inflight.realgit.test.ts

## Task Dependency Graph

```text
Task 1 ─▶ Task 2 ─┬─▶ Task 4 ─▶ Task 8 ─▶ Task 6 ─▶ Task 7 ─▶ Task 9 ─▶ Task 10
                  │                       ▲
Task 3 ───────────┘ (Task 4)              │
                  └─▶ Task 5 ─────────────┘
                          ├─▶ Task 14
                          ├─▶ Task 15
                          └─▶ Task 16
Task 11 ─▶ Task 12
Task 11 + Task 3 ─▶ Task 13
```

## Integration Points

- After Task 9, `ai-conductor docs-prune` runs end to end against a bare origin with a mocked
  tracker and confirmation.
- After Task 13, `shipment-evidence audit` classifies pruned stems.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `origin/main` holds `.docs/shipped/alpha.md` and an `alpha` file in every prunable family, when `docs-prune` resolves its selection, then the selection holds exactly those prunable files of `alpha`. | 1 | "returns exactly the `alpha` file of each of the ten prunable families" | diff-local |
| Story 1 happy: Given shipped stem `2026-10-01-alpha` whose conflicts file is the undated `.docs/conflicts/alpha.md` and whose retro is `.docs/retros/2026-10-02-alpha.md`, when the selection is resolved, then both files are included. | 1 | "returns `.docs/conflicts/alpha.md` and `.docs/retros/2026-10-02-alpha.md` through normalized-stem matching" | diff-local |
| Story 1 happy: Given shipped stem `alpha` with a committed halt record `.docs/halted/alpha.md`, when the selection is resolved, then the halt record is included. | 1 | "including `.docs/halted/alpha.md`, and no other path" | diff-local |
| Story 1 negative: Given shipped stem `alpha` with a file named for `alpha` in each of the seven kept families (stories, specs, an ADR in decisions, architecture, shipped, intake and release-waivers), when the selection is resolved, then none of those files is included. | 1 | "returns none of the seven kept-family files" | diff-local |
| Story 1 negative: Given shipped stem `alpha` and unshipped stem `alpha-two` whose files share the `alpha` prefix, when the selection is resolved, then no `alpha-two` file is included. | 1 | "no `alpha-two` file" | diff-local |
| Story 1 negative: Given unshipped stem `beta` with files in every prunable family and no `.docs/shipped/beta.md` on `origin/main`, when the selection is resolved, then no `beta` file is included and `beta` is reported as skipped with reason `no-shipped-record`. | 2 | "reports unshipped `beta` as skipped with reason `no-shipped-record` and none of its files selected" | diff-local |
| Story 1 negative: Given repository-wide files under `.docs/audit`, `.docs/audits`, `.docs/baselines`, `.docs/observation` and top-level `.docs/*.md`, when the selection is resolved, then none of them is included. | 1 | "no file under `.docs/audit`, `.docs/audits`, `.docs/baselines`, `.docs/observation` or top-level `.docs/*.md`" | diff-local |
| Story 1 negative: Given a shipped record that exists only on a local branch and not on `origin/main`, when the selection is resolved, then that stem's files are not included. | 2 | "selects no `gamma` file, because `.docs/shipped/gamma.md` exists only on a local branch and not on `origin/main`" | diff-local |
| Story 1 negative: Given shipped stem `2026-10-01-alpha` and unshipped stem `2026-10-20-alpha` both with plans on `origin/main`, and an undated `.docs/conflicts/alpha.md`, when the selection is resolved, then `.docs/conflicts/alpha.md` is not included and is reported as excluded because its undated stem matches more than one plan. | 2 | "does not select `.docs/conflicts/alpha.md` and lists it in `excluded` because its undated stem matches more than one plan" | diff-local |
| Story 2 happy: Given shipped stems with prunable files and no open `docs-prune/*` PR, when the operator runs `ai-conductor docs-prune`, then one PR is opened from branch `docs-prune/<date>` whose single commit deletes exactly the removable paths and changes no other path. | 9, 5 | "the bare origin then has one `docs-prune/<date>` branch whose single commit deletes exactly the removable paths, with one PR opened for it" | diff-local |
| Story 2 happy: Given that run, when the root checkout and the local `main` branch are inspected afterward, then `git status --porcelain` output and every tracked file are unchanged, local `main` points at the same commit, and no temporary worktree remains registered. | 5 | "the root checkout's `git status --porcelain` output and every tracked file are unchanged, local `main` points at the same commit, and `git worktree list` shows no temporary worktree" | diff-local |
| Story 2 happy: Given the operator's own open `docs-prune/*` PR from an earlier run and newly shipped stems on `origin/main`, when the operator runs `ai-conductor docs-prune` again, then that same PR is refreshed to delete the current removable paths and no second PR is opened. | 6 | "pushes to that PR's head branch a commit deleting the current removable paths including the newly shipped stem's" | diff-local |
| Story 2 negative: Given no shipped stem has a prunable file on `origin/main`, when the operator runs `ai-conductor docs-prune`, then no branch is pushed, no PR is created, and the command exits 0 reporting that nothing was pruned. | 9 | "prints that nothing was pruned, pushes no branch, creates no PR" | diff-local |
| Story 2 negative: Given a prune commit whose staged change would touch any path outside the removable set, when the commit is attempted, then the command refuses, pushes nothing, and exits non-zero naming the unexpected path. | 5, 10 | "returns non-zero naming that unexpected path and pushes nothing" | diff-local |
| Story 2 negative: Given the guarded push of the `docs-prune/<date>` branch fails, when the command runs, then it exits non-zero naming the push failure, no PR is created, and `origin/main` is unchanged. | 7, 10 | "`dispatchDocsPrune` returns non-zero and prints the refusal naming the push failure, the refused operation, or that PR's url respectively" | diff-local |
| Story 2 negative: Given any run of `ai-conductor docs-prune`, when the remote calls it made are inspected, then none pushes `main`, enables auto-merge, or merges a PR. | 6 | "the recorded remote calls contain no push to `main`, no auto-merge request and no merge request" | diff-local |
| Story 2 negative: Given an open `docs-prune/*` PR authored by a different operator, when the operator runs `ai-conductor docs-prune`, then it pushes nothing, leaves that PR unchanged, and exits non-zero naming that PR. | 7, 10 | "`dispatchDocsPrune` returns non-zero and prints the refusal naming the push failure, the refused operation, or that PR's url respectively" | diff-local |
| Story 2 negative: Given the command runs inside an engine-dispatched session with `CONDUCT_DAEMON_SESSION` set, when it is invoked, then it is refused before any git or GitHub call and exits non-zero naming the blocked `docs-prune` subcommand. | 9 | "runs that guard before any git or GitHub call and exits non-zero printing that refusal" | diff-local |
| Story 2 negative: Given the operator declines the approval prompt for the branch push, or the terminal is non-interactive, when publication is reached, then nothing is pushed, no PR is created or edited, and the command exits non-zero naming the refused operation. | 7, 10 | "`dispatchDocsPrune` returns non-zero and prints the refusal naming the push failure, the refused operation, or that PR's url respectively" | diff-local |
| Story 2 negative: Given the production source and the `.github/workflows` definitions, when every caller of the docs-prune deletion and publication path is enumerated, then the only caller is the `ai-conductor docs-prune` command dispatch, and no daemon tick, finish step, or CI workflow reaches it. | 9 | "finds only `index.ts` (the `ai-conductor docs-prune` command dispatch) and `docs-prune-cli.ts`, and finds no `docs-prune` reference in `.github/workflows`" | diff-local |
| Story 3 happy: Given shipped stem `alpha` and an open PR that modifies only `.docs/coherence/alpha.md`, when `docs-prune` runs, then no file of `alpha`'s prune set is removed and `alpha` is reported as deferred with reason `open-pr-modifies` naming that PR. | 4 | "move every `alpha` path out of `removable` and record `alpha` as deferred with reason `open-pr-modifies` naming that PR's url" | diff-local |
| Story 3 happy: Given an open PR that changes 150 files where the 150th is the plan file of shipped stem `alpha`, when `docs-prune` runs, then `alpha` is deferred with reason `open-pr-modifies`. | 4, 3 | "An open PR whose 150th changed file is the `alpha` plan file defers `alpha` with reason `open-pr-modifies`" | diff-local |
| Story 3 happy: Given shipped stems `alpha` and `gamma` where only `alpha` is touched by an open PR, when `docs-prune` runs, then every file of `gamma`'s prune set is removed and `alpha` is deferred. | 4 | "every `gamma` path stays in `removable` and `alpha` is deferred" | diff-local |
| Story 3 negative: Given the guarded tracker read of open PRs fails, when `docs-prune` runs, then it publishes nothing and exits non-zero naming the failed read. | 10 | "prints a message naming the failed read, creates no commit, pushes nothing, and creates no PR" | diff-local |
| Story 3 negative: Given the open-PR file read returns a repeated cursor, when `docs-prune` runs, then it publishes nothing and exits non-zero naming the incomplete pagination. | 10, 3 | "returns non-zero naming the incomplete pagination, pushes nothing, and creates no PR" | diff-local |
| Story 3 negative: Given the open-PR file read returns a page that reports more files but supplies no next cursor, when `docs-prune` runs, then it publishes nothing and exits non-zero naming the incomplete pagination. | 10, 3 | "returns non-zero naming the incomplete pagination, pushes nothing, and creates no PR" | diff-local |
| Story 3 negative: Given the only open PR touching shipped stem `alpha` is this command's own `docs-prune/*` PR, when `docs-prune` runs again, then `alpha` is not deferred and its paths stay in the refreshed PR. | 4 | "`alpha` is not deferred and all its paths stay in `removable`" | diff-local |
| Story 4 happy: Given an in-flight feature worktree with a protected-artifact seal covering the plan file of shipped stem `alpha`, which the feature never modified, when a docs-prune PR deleting that plan merges into `main` and the feature rebases onto it, then the seal verification passes without a HALT and the deleted path is pruned from the seal automatically. | 14 | "`verifyProtectedArtifactSeal` returns ok, no `.pipeline/HALT` file exists in the feature worktree, and the persisted seal no longer lists the `alpha` plan file" | diff-local |
| Story 4 happy: Given a merged docs-prune PR, when daemon discovery runs on the new `main`, then every pruned shipped stem is still treated as shipped and none is dispatched. | 15 | "returns the same eligible set before and after the merged prune, and no pruned shipped stem is dispatched" | diff-local |
| Story 4 negative: Given an in-flight feature with an unpushed local commit that edits `.docs/coherence/alpha.md` of shipped stem `alpha`, when a docs-prune PR deleting that file merges and the feature rebases, then the edit is not silently discarded: either the edited content is present on the branch after the rebase, or the rebase stops with a conflict that names `.docs/coherence/alpha.md`. | 16 | "the edited content is never absent with a successful rebase" | diff-local |
| Story 4 negative: Given a merged docs-prune PR that removed every prunable file of shipped stem `alpha`, when daemon discovery runs, then no unshipped stem adopts any of `alpha`'s former markers through undated-stem matching. | 15 | "resolved markers include none of `alpha`'s former prunable files" | diff-local |
| Story 5 happy: Given a run that removes paths and defers a stem, when the opened PR body is read, then it lists every removed path and every deferred stem with its paths, its reason, and the PR that caused the deferral. | 8, 9 | "lists every removed path, and every deferred stem with its paths, its reason `open-pr-modifies`, and each deferring PR url" | diff-local |
| Story 5 happy: Given that run, when the event log is read, then it holds exactly one `decide_artifacts_pruned` event carrying the removed paths, the deferred stems with their reasons, and the PR URL. | 9 | "holds exactly one `decide_artifacts_pruned` event carrying the removed paths, the deferred stems with reason `open-pr-modifies`, and the PR url" | diff-local |
| Story 5 negative: Given a run that has nothing to prune, when the event log is read, then the `decide_artifacts_pruned` event carries an empty removed list and no PR URL. | 9, 8 | "persists one `decide_artifacts_pruned` event with an empty `removed` list and no `pullRequestUrl`" | diff-local |
| Story 5 negative: Given a run that fails before publishing, when the event log is read, then no `decide_artifacts_pruned` event claims any path as removed. | 10 | "contains no `decide_artifacts_pruned` event that lists any path as removed" | diff-local |
| Story 5 negative: Given a deferral or skip, when its reason is read, then it is exactly `open-pr-modifies` or `no-shipped-record`, and the event type rejects any other value. | 8 | "proves the deferred reason accepts exactly `open-pr-modifies` and the skipped reason exactly `no-shipped-record`, and rejects any other string" | diff-local |
| Story 6 happy: Given shipped stem `alpha` whose audit result was `aligned` before its plan was pruned, when `shipment-evidence audit` runs on `main` after the prune merges, then `alpha` is still reported `aligned`, using the plan from the parent of the commit that deleted it. | 13, 11 | "using the plan content `readPlanOrPruned` returned from the parent of the deleting commit" | diff-local |
| Story 6 happy: Given shipped stem `alpha` whose plan was pruned and whose shipped record was later removed from `main`, when record-only repair rebuilds the record, then it produces the same record it would have produced before the prune. | 12 | "renders a `.docs/shipped/<slug>.md` whose content is byte-identical to the record it renders for that stem at the commit before the prune" | diff-local |
| Story 6 happy: Given shipped stem `alpha` whose plan is still present at the commit being read, when the audit or repair reads it, then that present plan is used and no history lookup is made. | 11, 13 | "returns that content and the recorded git calls contain no `log` call" | diff-local |
| Story 6 negative: Given stem `alpha` whose plan is absent at the commit being read and was never deleted by any commit reachable from it, when record-only repair needs the plan, then it refuses with `shipment-plan-pruned` naming the `alpha` plan file, not the generic `plan … is unavailable`. | 12, 11 | "fails with an error containing `shipment-plan-pruned` and `.docs/plans/<slug>.md`, and the error text does not contain `is unavailable`" | diff-local |
| Story 6 negative: Given a plan that exists only on an unmerged branch and is absent at the audit head, when `shipment-evidence audit` runs, then that row is classified `unresolved` with reason `shipment-plan-pruned` and every other row is still classified. | 13 | "classifies a plan that exists only on an unmerged branch as `unresolved` with reason `shipment-plan-pruned`, and every other row in the same report still has a classification" | diff-local |
| Story 6 negative: Given stem `alpha` whose plan was deleted, re-added with new content, and deleted again, when the audit or repair needs the plan, then it uses the content from just before the most recent deletion. | 11 | "returns the content from just before the most recent deletion" | diff-local |
| Story 6 negative: Given the git history read fails while looking up a pruned plan, when record-only repair or the audit needs that plan, then repair refuses with `shipment-plan-pruned` naming the path and the failed read, and the audit classifies that row `unresolved` with reason `shipment-plan-pruned` instead of `aligned`. | 12, 13 | "fails with `shipment-plan-pruned` naming the path and the failed read" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D1 | task | task-1, task-2 | `DOCS_RETENTION_POLICY` is the only definition of the prunable and kept family lists in `src/conductor/src` |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D2 | task | task-2, task-9 | no `docs-prune` reference in `.github/workflows`, so no daemon tick, finish step or CI workflow can run the prune |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D3 | task | task-3, task-4, task-10 | defers `alpha` with reason `open-pr-modifies` |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D4 | task | task-5, task-6, task-7 | the recorded remote calls contain no push to `main`, no auto-merge request and no merge request |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D5 | task | task-8, task-9 | holds exactly one `decide_artifacts_pruned` event carrying the removed paths, the deferred stems with reason `open-pr-modifies`, and the PR url |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D6 | task | task-11, task-12, task-13 | returns a refusal with code `shipment-plan-pruned` naming the plan path |
| adr-2026-08-23-committed-halt-record#D1 | no-change | none | The halt record is still produced on the feature branch at halt time; docs-prune removes it from `main` only after the stem's shipped record is there. |
| adr-2026-08-23-committed-halt-record#D2 | no-change | none | The `writeHaltMarker` seam is untouched; no task edits halt-marker code. |
| adr-2026-08-23-committed-halt-record#D3 | no-change | none | Which halt classes produce a record is unchanged; docs-prune only reads paths. |
| adr-2026-08-23-committed-halt-record#D4 | no-change | none | The record's content is unchanged; docs-prune deletes whole files and never rewrites one. |
| adr-2026-08-23-committed-halt-record#D5 | no-change | none | Commit-then-push of the record on the feature branch is unchanged. |
| adr-2026-08-23-committed-halt-record#D6 | no-change | none | The no-throw contract of the halt path is unchanged; docs-prune runs outside it. |
| adr-2026-08-23-committed-halt-record#D7 | task | task-1 | including `.docs/halted/alpha.md` |
| adr-2026-08-23-committed-halt-record#D8 | no-change | none | The record stays durable state read by name while its feature is in flight; occurrences still ride the existing spine. |
| adr-2026-08-26-remove-retrospectives-one-shot#D1 | no-change | none | The `retro` step stays deleted; no task reintroduces it. |
| adr-2026-08-26-remove-retrospectives-one-shot#D2 | no-change | none | No provider call is added; docs-prune makes no provider call. |
| adr-2026-08-26-remove-retrospectives-one-shot#D3 | no-change | none | The closeout obligation union is untouched. |
| adr-2026-08-26-remove-retrospectives-one-shot#D4 | no-change | none | `skills/retro/` stays deleted; no skill files change. |
| adr-2026-08-26-remove-retrospectives-one-shot#D5 | task | task-1 | `.docs/retros/2026-10-02-alpha.md` through normalized-stem matching |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
