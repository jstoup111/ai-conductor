# Implementation Plan: Routed repair hosts a finding on a stack child that lacks its target file

**Date:** 2026-10-31
**Design:** `.docs/decisions/architecture-review-2026-10-31-routed-repair-hosts-a-finding-on-a-stack-child-tha.md`; `adr-2026-10-12-routed-whole-feature-repair` decisions 4 and 5 (amended by #3550); diagram `.docs/architecture/routed-repair-hosts-a-finding-on-a-stack-child-tha.md`
**Stories:** .docs/stories/routed-repair-hosts-a-finding-on-a-stack-child-tha.md
**Conflict check:** Clean as of 2026-10-31 (`.docs/conflicts/2026-10-31-routed-repair-hosts-a-finding-on-a-stack-child-tha.md`)

## Summary

Resolve every routed-repair citation against the leaf tree into repository file paths before it counts as
hosting evidence, and drop directory and ambiguous citations. Feed the text each item's rem blocks carry into the
same evidence. Use the same resolution in D5 prerequisite-claim verification. No halt is added. The plan has 8 tasks
and ships as a single PR.

## Technical Approach

- **Resolver beside the host selector.** `resolveCitedPaths(citations, leafTip, git)` in
  `src/conductor/src/engine/routing/cannot-host.ts` replaces `classifyCitedPaths`. It reads one
  `git ls-tree -r --name-only <leafTip>` listing and classifies each citation into a closed union:
  - `input`: an exact listed file, or the unique listed file the citation is a `/`-bounded suffix of;
  - `output`: no listed file matches;
  - `dropped-directory`: after trimming one trailing `/`, some listed file begins with `<citation>/`;
  - `dropped-ambiguous`: two or more listed files end with `/<citation>`.

  The order is exact file, directory, suffix match. It returns `{ inputs, outputs, dropped }` with inputs
  de-duplicated in first-seen order, or `{ kind: 'halt', detail }` naming the leaf branch when the listing cannot be
  read. This keeps the module's local pattern: pure readers over a `GitRunner` that return a halt union and never
  write refs. Search hints: `selectHost`, `classifyCitedPaths`, `containsEveryPath`.
- **Token cleanup.** `citedRepositoryPaths` in `routing/cited-repository-paths.ts` also strips leading `(`, `[` and
  `<`, the mirror of its trailing cleanup, so `(register-artifact-cli.ts)` yields `register-artifact-cli.ts`.
- **Router.** `routeAdmittedRound` in `routing/round-router.ts` builds each item's citation list from
  `source.citedPaths` plus `citedRepositoryPaths` over the text `allocateFrozenBlocks` renders into the item's blocks:
  each `gap.tasks[].title` (or `gap.rationale` when there are no tasks), `gap.rationale`, `gap.criterion` and
  `gap.governingClause`. Existing-task items allocate no block, so they add no block text. The router resolves the
  list, passes the resolved `inputs` to the unchanged `selectHost`, and stores them as `prerequisitePaths`.
- **Claims.** `verifyPrerequisiteClaim` in `routing/prerequisite-claim.ts` resolves the claimed paths and the stored
  `prerequisitePaths` against the leaf branch tip (`refs/heads/<leafBranchFor(slug)>`) before its existing checks.
  Only resolved `input` files take part. A claim left with no file and no symbol returns `unverified` with detail
  `claim names no prerequisite file`. `settleRoutedBuildClaim` maps that to `failed`, as it already does for every
  unverified claim.
- **No new halt, event, field or config.** The #3445 admission fence in `conductor.ts` keeps running after
  `routeAdmittedRound` and before `createRouteRecord`.

## Prerequisites

- None. Every reused primitive is on main. The parallel spec #3477 amends other decisions of the same ADR and is not
  a prerequisite (operator 2026-10-31).

## Tasks

### Task 1: Strip leading wrapping punctuation from cited tokens
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/routing/cited-repository-paths.test.ts` (new) for each Done-when check (RED).
2. In `citedRepositoryPaths`, extend the leading strip to `(`, `[` and `<` alongside the existing quote and backtick characters (GREEN).
3. Commit.

**Done when:**
- [test] `citedRepositoryPaths('rotation (register-artifact-cli.ts) audit')` returns exactly `['register-artifact-cli.ts']`, with no entry beginning with `(`.
- [test] `citedRepositoryPaths('see [src/engine/a.ts] and <restack/restack-sync.ts>')` returns `['src/engine/a.ts', 'restack/restack-sync.ts']`.
- [test] `citedRepositoryPaths` over the text `see src/engine/a.ts:41.` still returns `['src/engine/a.ts']`, so the existing trailing and line-suffix cleanup is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/routing/cited-repository-paths.ts` — leading strip
- `src/conductor/test/engine/routing/cited-repository-paths.test.ts` — new tests

**Dependencies:** none

### Task 2: Resolve citations against the leaf listing
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/routing/cannot-host.realgit.test.ts` over the story's three-child fixture (leaf holds `src/engine/a.ts`, `src/engine/register-artifact-cli.ts`, `src/engine/restack/restack-sync.ts`, `src/engine/index.ts`, `src/cli/index.ts`) for each Done-when check (RED).
2. Add `resolveCitedPaths` to `routing/cannot-host.ts`, following the module's pattern: a pure reader over a `GitRunner` that returns `{ kind: 'halt', detail }` instead of throwing and writes no ref. Search hints: `classifyCitedPaths`, `hasPath`. Apply the order exact file, then directory, then suffix match from the Technical Approach (GREEN).
3. Commit.

**Done when:**
- [test] `resolveCitedPaths` returns inputs `src/engine/register-artifact-cli.ts` for `register-artifact-cli.ts`, `src/engine/restack/restack-sync.ts` for `restack/restack-sync.ts`, and `src/engine/a.ts` for `src/engine/a.ts`.
- [test] `resolveCitedPaths` drops `src/engine/` and `src/engine` as `dropped-directory` and drops `index.ts` as `dropped-ambiguous`, with none of them in `inputs` or `outputs`.
- [test] `resolveCitedPaths` returns `brand-new.ts` in `outputs` and not in `inputs`.
- [test] With a git runner whose `ls-tree -r` call exits non-zero, `resolveCitedPaths` returns `{ kind: 'halt' }` whose detail names the leaf branch `feat/daemon-demo`.
- [test] `resolveCitedPaths` issues exactly one `ls-tree -r --name-only` call for a list of five citations.

**Files likely touched:**
- `src/conductor/src/engine/routing/cannot-host.ts` — `resolveCitedPaths`
- `src/conductor/test/engine/routing/cannot-host.realgit.test.ts` — resolver tests

**Dependencies:** none

### Task 3: Route on resolved inputs (the #3550 reproduction)
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/routing/round-router-citations.realgit.test.ts` (new) that call `routeAdmittedRound` over the three-child fixture with a residue item owned by child 1 and a recorded routing judgement, for each Done-when check (RED).
2. In `routeAdmittedRound`, replace both `classifyCitedPaths` calls with `resolveCitedPaths`, pass its `inputs` to `selectHost`, and store them as the item's `prerequisitePaths`. Remove `classifyCitedPaths` once it has no caller (GREEN).
3. Commit.

**Done when:**
- [test] `routeAdmittedRound` for a child-1-owned item citing `register-artifact-cli.ts` returns an item with `host` 3, `owner` 1, `reason` `prerequisite-paths` and `prerequisitePaths` `['src/engine/register-artifact-cli.ts']`.
- [test] `routeAdmittedRound` for a child-1-owned item citing `restack/restack-sync.ts` returns `host` 3 with `reason` `prerequisite-paths` and `prerequisitePaths` `['src/engine/restack/restack-sync.ts']`.
- [test] `routeAdmittedRound` for a child-1-owned item whose citation text is `(register-artifact-cli.ts)` returns `prerequisitePaths` `['src/engine/register-artifact-cli.ts']`, and no entry begins with `(`.
- [test] `routeAdmittedRound` for a child-1-owned item citing only `src/engine/a.ts` returns `host` 1, `owner` 1, `reason` `residue-judged` (the single-candidate judgement's reason) and `prerequisitePaths` `['src/engine/a.ts']`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — resolver call sites
- `src/conductor/src/engine/routing/cannot-host.ts` — remove `classifyCitedPaths`
- `src/conductor/test/engine/routing/round-router-citations.realgit.test.ts` — new tests
- `src/conductor/test/engine/routing/cannot-host.realgit.test.ts` — move `classifyCitedPaths` cases to the resolver

**Dependencies:** Tasks 1, 2

### Task 4: Directory, ambiguous, unmatched and unreadable citations
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/routing/round-router-citations.realgit.test.ts` for each Done-when check (RED).
2. Adjust `routeAdmittedRound` so an item whose resolved `inputs` are empty records no `prerequisitePaths` key, and so a resolver halt maps to the router's needs-human halt before allocation (GREEN).
3. Commit.

**Done when:**
- [test] `routeAdmittedRound` for a child-1-owned item citing `src/engine/` and `src/engine/a.ts` returns `host` 1 with `prerequisitePaths` exactly `['src/engine/a.ts']`, and for one citing `src/engine/` and `register-artifact-cli.ts` returns `host` 3.
- [test] `routeAdmittedRound` for a child-1-owned item whose only citation is `src/engine/` returns `host` 1 with `reason` `residue-judged` and no `prerequisitePaths` key.
- [test] `routeAdmittedRound` for a child-1-owned item citing `index.ts` and `src/engine/a.ts` returns `prerequisitePaths` `['src/engine/a.ts']`, with neither `src/engine/index.ts` nor `src/cli/index.ts` present, and `host` 1.
- [test] `routeAdmittedRound` for a child-1-owned item citing `brand-new.ts` returns `host` 1 and no `brand-new.ts` in `prerequisitePaths`.
- [test] With the leaf listing unreadable, `routeAdmittedRound` returns `{ kind: 'halt', haltClass: 'needs-human' }` naming `feat/daemon-demo`, and `git for-each-ref refs/conductor/demo/` output is unchanged, so no route record, marker or ref was written.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — empty-input and halt handling
- `src/conductor/test/engine/routing/round-router-citations.realgit.test.ts` — negative cases

**Dependencies:** Task 3

### Task 5: Rem-block text steers the host
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/routing/round-router-citations.realgit.test.ts` for each Done-when check (RED).
2. In `routeAdmittedRound`, append `citedRepositoryPaths` over each non-existing-task item's block text fields (task titles or the rationale fallback, `gap.rationale`, `gap.criterion`, `gap.governingClause`) to its citation list before resolution (GREEN).
3. Commit.

**Done when:**
- [test] `routeAdmittedRound` for a child-1-owned item whose work-order citations are only `src/engine/a.ts` and whose `gap.governingClause` cites `register-artifact-cli.ts` returns `host` 3, `reason` `prerequisite-paths` and `prerequisitePaths` containing `src/engine/register-artifact-cli.ts`, and returns `kind` `routed`, not a halt.
- [test] `routeAdmittedRound` for a child-1-owned item whose block text cites only `src/engine/a.ts` and `brand-new.ts` returns `host` 1 with `reason` `residue-judged`, and its frozen allocation for host 1 carries the item's rem block.
- [test] `routeAdmittedRound` for an existing-task item owned by child 1 whose `gap.governingClause` cites `register-artifact-cli.ts` but whose work-order citations are only `src/engine/a.ts` returns `host` 1.
- [test] With `closed/c1` unreadable and a child-1-owned item whose block text cites `register-artifact-cli.ts`, `routeAdmittedRound` returns a needs-human halt naming child 1 and `git for-each-ref refs/conductor/demo/` output is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — block-text citations
- `src/conductor/test/engine/routing/round-router-citations.realgit.test.ts` — block-text cases

**Dependencies:** Task 4

### Task 6: The admission fence keeps precedence over block-text routing
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write a failing conductor-level test in `src/conductor/test/engine/routing/conductor-routed-citation-fence.test.ts` (new). Reuse the #3445 open-audit-round fence fixture (search hints: `checkRoundAdmissionFence`, the open-round cases in `round-admission.realgit.test.ts`). The test holds an open audit round with a `pending` host, then has the whole-feature audit route a new finding owned by child 1 whose block text cites a leaf-only file. The third check fails before Task 5's block-text citations exist (RED).
2. Fix any ordering defect in `conductor.ts` so `routeAdmittedRound` returns routed work and the fence decides admission (GREEN).
3. Commit.

**Done when:**
- [test] The conductor's routed audit path ends the run with `.pipeline/HALT.class` `mechanical` and a HALT first line naming the open round, and the HALT does not contain `needs-human`.
- [test] The same run creates no new `refs/conductor/demo/routes/r2` ref and emits no `remediation_routed` event to `.pipeline/events.jsonl`.
- [test] With the open round closed and no marker, the same conductor path creates `refs/conductor/demo/routes/r2` whose item for the finding stores `host` 3 and `prerequisitePaths` containing the resolved leaf-only file.
- [test] With no open round and a child-1-owned finding whose work-order and block-text files all exist at `closed/c1`, the conductor path creates `refs/conductor/demo/routes/r2` whose item stores `host` 1, writes a repair marker naming r2 and host 1, and admits host 1.

**Files likely touched:**
- `src/conductor/test/engine/routing/conductor-routed-citation-fence.test.ts` — new conductor-level test
- `src/conductor/src/engine/conductor.ts` — only if the ordering defect exists

**Dependencies:** Task 5

### Task 7: Verify claims against resolved files
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` over the three-child fixture, with an open round r1 hosted on child 1 and the marker set, for each Done-when check (RED).
2. In `verifyPrerequisiteClaim`, resolve the claimed paths and the stored `prerequisitePaths` through `resolveCitedPaths` against the leaf branch tip, keep only resolved `inputs`, and run the existing presence checks on those files (GREEN).
3. Commit.

**Done when:**
- [test] With r1's child-1 item storing `prerequisitePaths` `['src/engine/']`, `settleRoutedBuildClaim` for a claim `{ outcome: 'blocked-by-prerequisite', child: 3, paths: ['src/engine/register-artifact-cli.ts'] }` returns `rerouted`, and the repair marker then names host 3.
- [test] `settleRoutedBuildClaim` for a claim with `paths: ['register-artifact-cli.ts']` naming child 3 returns `rerouted`, the repair marker then names host 3, and r1's `fallback` entry lists `src/engine/register-artifact-cli.ts` as evidence.
- [test] With r1's item storing `prerequisitePaths` `['src/engine/a.ts']`, `verifyPrerequisiteClaim` for a claim of `src/engine/register-artifact-cli.ts` naming child 3 returns `verified` after an `ls-tree` of `src/engine/a.ts` at child 3's tree `refs/heads/feat/daemon-demo`, and with a git runner reporting that path absent from that ref it returns `unverified` with detail containing `lacks prerequisite paths`.

**Files likely touched:**
- `src/conductor/src/engine/routing/prerequisite-claim.ts` — resolver-backed comparison
- `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` — claim tests

**Dependencies:** Task 2

### Task 8: Claims that name no prerequisite file fail as ordinary attempts
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` for each Done-when check (RED).
2. In `verifyPrerequisiteClaim`, return `unverified` with detail `claim names no prerequisite file` when resolution leaves no claimed file and the claim names no symbol (GREEN).
3. Commit.

**Done when:**
- [test] `settleRoutedBuildClaim` for a claim with `paths: ['src/engine/a.ts']` naming child 3 returns `failed` with detail containing `already present at host 1`, and `feat/c1/demo`, `closed/c1` and the repair marker resolve to their pre-claim values.
- [test] `settleRoutedBuildClaim` for a claim with only `paths: ['src/engine/']` returns `failed` with detail containing `claim names no prerequisite file`, and `feat/c1/demo`, `closed/c1`, the repair marker and `git for-each-ref refs/conductor/demo/` output are unchanged.
- [test] `settleRoutedBuildClaim` for a claim with only `paths: ['index.ts']` returns `failed` with detail containing `claim names no prerequisite file`, and no ref moves.
- [test] With r1's item storing `prerequisitePaths` `['src/engine/register-artifact-cli.ts']`, `settleRoutedBuildClaim` for a valid claim naming child 2 returns `failed` with detail containing `lacks prerequisite paths`, and no ref moves.
- [test] For each claim in the four checks above, a conductor routed BUILD on child 1 returning it records that build attempt as unsuccessful with output equal to the settlement detail, charged to child 1's region, writes no `.pipeline/HALT`, and leaves the round's host at child 1.

**Files likely touched:**
- `src/conductor/src/engine/routing/prerequisite-claim.ts` — empty-claim detail
- `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` — negative cases
- `src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts` — conductor failed-attempt case

**Dependencies:** Task 7

## Task Dependency Graph

```
Task 1 ──┐
Task 2 ──┴─ Task 3 ── Task 4 ── Task 5 ── Task 6
Task 2 ──── Task 7 ── Task 8
```

## Integration Points

- After Task 3: the #3550 shape routes to the leaf through `routeAdmittedRound` with real git.
- After Task 6: the conductor's routed audit path stores resolved `prerequisitePaths`, and the admission fence still decides admission.
- After Task 8: the conductor's routed-BUILD claim boundary (`settleRoutedBuildClaim`) verifies and refuses claims on resolved files.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | no-change | none | Routing entry and classification of admitted work are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D2 | no-change | none | Mechanical owner derivation for task-bound work is not changed; only the host can move. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | no-change | none | The residue routing judgement, its schema and the `residue-default` earliest-candidate owner are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | task | task-3, task-2, task-4, task-5 | returns an item with `host` 3, `owner` 1, `reason` `prerequisite-paths` and `prerequisitePaths` `['src/engine/register-artifact-cli.ts']` |
| adr-2026-10-12-routed-whole-feature-repair#D5 | task | task-7, task-8 | returns `rerouted`, and the repair marker then names host 3 |
| adr-2026-10-12-routed-whole-feature-repair#D6 | no-change | none | The route record schema is unchanged; `prerequisitePaths` stays a string array holding resolved files. |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-6 | ends the run with `.pipeline/HALT.class` `mechanical` and a HALT first line naming the open round |
| adr-2026-10-12-routed-whole-feature-repair#D8 | no-change | none | The cursor and execution-child resolver are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | no-change | none | Routed task append at region entry is not changed; block bodies are rendered exactly as today. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | no-change | none | The round receipt and its single charge are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D11 | no-change | none | Repair obligation keying and re-targeting on reroute are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | The host `build_review` snapshot base is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | no-change | none | Routed exit restacks are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D14 | no-change | none | The re-validation queue is not read or written. |
| adr-2026-10-12-routed-whole-feature-repair#D15 | no-change | none | Leaf gate re-pending on queue drain is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D16 | no-change | none | No event is added; `remediation_routed` and `remediation_rerouted` keep their payloads. |
| adr-2026-10-12-routed-whole-feature-repair#D17 | no-change | none | A flat N=1 feature never enters routing, so resolution never runs for it. |
| adr-2026-10-12-routed-whole-feature-repair#D18 | existing | none | Routing stays behind the existing `routingSettingOn` flag; this change adds no flag and changes no default. |

## Verification

- [ ] Every happy-path and negative-path criterion is covered by at least one task. The coherence mapping records the criterion rows.
- [ ] Every task has 2–5 single-line `Done when:` checks naming the mechanism.
- [ ] Dependencies are acyclic.
- [ ] No task edits another feature's sealed artifact.
