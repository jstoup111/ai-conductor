# Implementation Plan: Stack-aware feature identity and per-child state foundation (#2940)

**Date:** 2026-10-03
**Design:** .docs/decisions/adr-2026-10-03-stacked-child-plans-identity-and-state.md
**Stories:** .docs/stories/engine-cannot-represent-more-than-one-branch-step-.md
**Conflict check:** Clean as of 2026-10-03

## Summary

Lands the stacked-delivery foundation in 29 TDD tasks: an N=1 golden byte-identity suite committed
before any production change, one feature-branch identity module adopted by every branch consumer,
a child-context seam (`ChildId`, `MAX_CHILD_ID = 9`, `pipelinePathFor`) that places per-child region
state under `.pipeline/children/<k>/`, an optional `child` event field, and `--child <k>` on `rewind`,
`task` and `kickback-budget inspect`. Everything excluded by the track file (active-child resolution,
base override, caps, teardown, `max_slices`) stays out.

## Technical Approach

- **Structural N=1 first.** Task 1 records the golden fixtures from the build's base commit with zero
  production diff. Every later task keeps them green. "No child" is always `undefined`; absence selects
  today's paths, so no new directory, key or event field is written for today's features.
- **One identity owner.** `src/conductor/src/engine/feature-branch-identity.ts` returns a discriminated
  union (`leaf`, `child`, `spec`, `interactive`, `unrecognized`). The four private parsers
  (`finish-record-cli.ts`, `halt-pr-reconciliation.ts`, `daemon-halt-pr-operations.ts`,
  `github-operations-cli.ts`) and the branch consumers (`park-reconciliation.ts`, `overlap-sources.ts`,
  `daemon-deps.ts`, `mergeable-sweep.ts`, `src/daemon-cli.ts`) adopt it. Non-child inputs keep today's
  expression verbatim (moved into the module where shared); the child arm is added ahead of it and
  proven by table-driven parity tests. `childBranchFor` is called from the parser's canonicalization
  round-trip so `feat/c01/x` is rejected. Prefix stripping lives only in `parseFeatureRef` for the
  intake-overlap enumeration. Attribution is not authority: a child gains a leaf-exists precondition on
  top of the unchanged committed-owner check, finish-record refuses children, and park never deletes one.
- **One child-context seam.** `src/conductor/src/engine/child-context.ts` owns `ChildId` (branded
  integer built only by `parseChildId`), `MAX_CHILD_ID = 9`, `pipelinePathFor(root, relative, child?)`,
  `isRegionStep`, `childStateExists` and `listExistingChildren`. Per-child files are whole copies of the
  flat schema: the conduct-state store is instantiated at a child path, `verdictPathFor` and the
  kickback-ledger read/lease take an optional trailing `child`. Flat enumerations never descend into
  `children/`; the fresh-session ledger clear removes child ledgers by explicit enumeration only.
  Production never imports `plan-slices.ts`, never references `stacked_prs`, and never uses the
  capitalized slice-section token; child identity for `task --child` comes from the coverage-binding
  envelope's `sliceMembership`.
- **Events.** `ConductorEvent = (existing union) & { child?: ChildId }` with conditional spread, so a
  no-child record is byte-identical. `operator_rewind` carries it for a child rewind. Rollups ignore it.
- **CLIs.** `--child` is accepted only for a valid `ChildId` whose `.pipeline/children/<k>/` exists.
  `rewind` demotes child k's region from the target, every region step of each existing child above k,
  and every downstream whole-feature step, each through the port, in the order child k, children above k
  ascending, flat file; rollback uses compensating port mutations per store (today's `rollbackRewindState`
  shape); verdict clearing runs after all demotions and HALT is left in place on any failure
  (adr-2026-08-19 D4 order). `task --child` validates membership and writes nothing new;
  `current-task` stays flat because the commit hook reads it. `kickback-budget inspect --child` reads the
  child ledger; `raise`/`reset` with `--child` fall through as an unrecognized flag does today.
- **Release surface (plan note).** No task touches `bin/conduct`, `bin/install`, `hooks/` or
  `settings*.json`, so per `adr-2026-08-01-scoped-run-verb-release-surface` the implementation PR needs
  no migration block and no waiver. Its release metadata is `Release-Disposition: note`,
  `Release-Category: Added`, `Release-Semver: minor`.
- **Concurrent-change note.** In-flight daemon features add `ConductorEvent` members and edit rewind
  verdict clearing. Golden fixtures are recorded at the final rebase base, and the golden scenario emits
  only events the bounded run and `operator_rewind` already produce. Task 24's clearing change is
  additive (per-path verdict list) so it rebases over those edits.

### Focused local pattern context

- **Golden fixtures** (precedent `src/conductor/test/engine/pr-body-regions-baseline.test.ts`,
  `src/conductor/test/fixtures/pr-body-regions-baseline-*.md`). Traits to keep: committed fixture files
  whose first line is `<!-- Recorded from <sha> -->` naming the commit they were recorded from, stripped
  by the test before comparison; production entry points exercised with injected git, gh, clock and
  step-runner fakes; no `__snapshots__`. Allowed variation: several surfaces and three flag/slice cells.
  Search hints: `Recorded from`, `createProductionFinishPublicationCoordinator`, `test/test-conductor.ts`.
- **Per-path store instantiation** (precedent `createFilesystemConductStateStore(path)`,
  `withKickbackLedgerLease(projectRoot, op)` leasing beside `KICKBACK_LEDGER_PATH`,
  `remediationCaseStorePath`). Traits to keep: a store is constructed from a path, holds its lease per
  path, and treats a missing file as the absent base case. Allowed variation: an optional trailing
  `child` parameter resolved through `pipelinePathFor`. Search hints: `KICKBACK_LEDGER_PATH`,
  `createConductStateLease`, `GATES_DIR`.
- **Operator CLI flag maps** (precedent `detectHaltClearCommand` and `detectKickbackBudgetCommand` in
  `src/conductor/src/cli.ts`). Traits to keep: an allowlisted flag map read in `(flag, value)` pairs, a
  repeated flag or missing value returns `null`, and `null` lets `src/conductor/src/index.ts` fall through
  to today's `error: unknown command '<name>'` text with exit 1. Allowed variation: `rewind` adds `--to`
  and `--child`; `task` keeps its positional grammar and returns `{ kind: 'guide' }` (exit 2) for a
  malformed `--child`. Search hints: `values.has(flag)`, `detectRewindCommand`, `detectTaskCommand`.

## Prerequisites

- Node and the repository's vitest/tsx toolchain installed under `src/conductor/`; `git` on PATH for
  real-local-git fixtures (pinned identity and dates, no remotes except where the remote is the subject).
- The build's base commit sha (`git merge-base origin/main HEAD` when Task 1 runs; `833b75868` at plan
  authoring) is known, so Task 1 can name it in every fixture header.
- `.docs/track/engine-cannot-represent-more-than-one-branch-step-.md` scope boundary is binding; the
  consolidated design's base-override and active-child parts are #2942 and are not implemented here.

## Tasks

### Task 1: Golden N=1 byte-identity suite (fixtures and tests only)
**Story:** Story 1 — all four happy criteria and all four negative criteria; Story 6 Done When (no `.pipeline/children/` entry for a feature with no child); supports Story 7 criterion 71, Story 8 criterion 82 and Story 9 criterion 90 as the byte-identity pin
**Type:** infrastructure

**Steps:**
1. Follow the golden-fixture pattern: committed fixture files under `src/conductor/test/fixtures/n1-golden/`, each opening with `<!-- Recorded from <sha> -->` where `<sha>` is the build's base commit (`git merge-base origin/main HEAD` at recording time); the test strips exactly that first line. Record the fixtures by running the harness below against the base commit and committing the outputs; the committed fixtures must pass unchanged against that commit.
2. Write `src/conductor/test/engine/n1-golden-state.test.ts` (no `Covers:` marker). Build a fixture root per cell: `.ai-conductor/config.yml` with `stacked_prs: { enabled: false }` or `{ enabled: true }`, and a fixture-root plan file named `n1-golden.md` (inside the temporary fixture root, never this repository's own plans directory) either unsliced or carrying a slice-manifest table (the `Slice`/`Title`/`Tasks` table `validatePlanSlices` parses) declaring three slices (positions 1, 2, 3) over its tasks with strict `**Dependencies:**` lines. Load config through the production `loadConfig(root)`. Bound the `Conductor.run()` per write-tests §3: pre-resolve every step before `acceptance_specs` as `done` in `conduct-state.json`, `fromStep: 'acceptance_specs'`, a mocked `StepRunner` returning success for `acceptance_specs`, `build`, `test_suite` and `build_review`, `verifyArtifacts: false`, an injected `runId`, and an injected sentinel failure at `manual_test` that ends the run; attach the test's own `EventPersister` with an injected `IntervalClock`; pin `USER`, git identity and `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`. After the run call `bumpKickbackGateInLedger(root, 'build_review', ...)` once (the ledger's production writer) and `runTaskStart(root, '2')` (the task CLI) so `kickback-ledger.json`, `task-status.json` and `current-task` are produced by production code.
3. Normalize ONLY: ISO-8601 timestamp strings, the epoch-ms values of the keys `ts`, `at`, `checkedAt`, `run_started_at`, `session_started_at`, `startedAtMs`, `appliedAt`, `committedAt`, and the fixture root path (replaced by `<ROOT>`). Drop ONLY the interval-timing keys `observedIntervals` and `activeInterval` from each `events.jsonl` record before comparison. Never sort keys. Compare: `conduct-state.json`, `task-status.json`, `current-task`, the sorted list of `gates/*.json` paths (`gate-paths`) and each verdict file, `events.jsonl`, `kickback-ledger.json`. After each cell assert `readdir('.pipeline')` has no `children` entry; if it does, fail naming `.pipeline/children/<entry>`. Assert `events.jsonl` contains no `"child"` substring.
4. Write `src/conductor/test/engine/n1-golden-renderings.test.ts` (no `Covers:` marker) over the same three cells: write `.pipeline/HALT` and `.pipeline/HALT.class` then run `dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, { emit: undefined })` capturing stdout and the appended `operator_rewind` line; `dispatchKickbackBudgetCommand({ kind: 'kickback-budget', action: 'inspect', feature, format })` for `human` and `json` with injected `resolveMainRoot` and `print`; `runDaemonStatus({ registryPath, out, clock })` over a registry naming the fixture project; `renderDashboard(await scanInheritedState({ ... }))`; the finish-publication PR body through `createProductionFinishPublicationCoordinator` exactly as `pr-body-regions-baseline.test.ts` does; and `renderShippedRecordWithCost(fields, await computeCostRollup(root))`. Do NOT render or compare `appendTimingSection` (the Time block).
5. Implement a shared `expectGolden(name, actual)` helper that throws `golden mismatch in <fixture>: line <n>` with the expected and actual line; add a self-test comparing a fixture to a one-byte-altered copy.
6. Verify RED is impossible here (no production change); verify GREEN against the base; commit with message: "test(golden): N=1 byte-identity fixtures recorded from <sha> (#2940 task 1)".
7. Note for later tasks: if a later rebase onto a new base legitimately changes a covered byte because of another feature, re-record from the new base in a separate commit whose message names that base sha, and update every fixture header to it.

**Done when:**
- `test/engine/n1-golden-state.test.ts` runs the bounded production flow (loadConfig, Conductor.run from `acceptance_specs`, bumpKickbackGateInLedger, runTaskStart) in each of the three cells (flag off with an unsliced plan, flag on with an unsliced plan, flag off with a plan declaring three slices) and asserts that, after normalizing only timestamp fields and the fixture root path and dropping only the `observedIntervals` and `activeInterval` interval-timing keys, the bytes of `conduct-state.json`, `task-status.json`, `current-task`, the sorted set of gate verdict file paths and each verdict file, `events.jsonl`, and `kickback-ledger.json` equal the committed fixtures under `test/fixtures/n1-golden/`, each of which opens with a `<!-- Recorded from <sha> -->` header naming the build's base commit.
- After every cell the state test asserts no `.pipeline/children/` directory exists, failing with a message naming the created path when one does, and asserts the produced `events.jsonl` contains no `"child"` substring so an added child key fails the `events.jsonl` comparison.
- `test/engine/n1-golden-renderings.test.ts` renders, in each of the three cells, `dispatchRewindCommand` stdout for `rewind --to build` and its appended `operator_rewind` record, `dispatchKickbackBudgetCommand` inspect output in human and json formats, `runDaemonStatus` lines, `renderDashboard(await scanInheritedState(...))` text, the finish-publication PR body and the `renderShippedRecordWithCost` Cost block, and asserts each rendering equals its fixture under the same normalization; the shipped-record Time block is neither rendered nor compared.
- The shared `expectGolden` helper fails naming the output file or rendering and the first differing line, proven by a self-test that compares a fixture against a copy with one altered byte and asserts the thrown message names that fixture and the line number.
- Neither golden test file imports a module introduced by this feature, no golden test carries a `Covers:` marker, and the task's commit touches only `src/conductor/test/engine/n1-golden-state.test.ts`, `src/conductor/test/engine/n1-golden-renderings.test.ts` and `src/conductor/test/fixtures/n1-golden/`.

**Files:**
- `src/conductor/test/engine/n1-golden-state.test.ts` — new golden state test
- `src/conductor/test/engine/n1-golden-renderings.test.ts` — new golden renderings test
- `src/conductor/test/fixtures/n1-golden/` — committed fixtures with `Recorded from` headers

**Dependencies:** none

### Task 2: Child-context module (`ChildId`, `MAX_CHILD_ID`, `pipelinePathFor`, child state probes)
**Story:** Story 2 Done When (child-id ceiling 9; land bound no greater than the ceiling); Story 6 criteria 55 and 56 (path formation)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/child-context.test.ts`: `parseChildId` accepts `'1'`..`'9'` and numbers 1..9, rejects `'0'`, `'10'`, `'two'`, `'-1'`, `'1.5'`, `''`; `pipelinePathFor` flat vs child paths; `isRegionStep`; `childStateExists`; `listExistingChildren` skipping `foo` and `12`; `MAX_PLAN_SLICES <= MAX_CHILD_ID` (this TEST imports `src/engine/plan-slices.ts`; production never does).
2. Verify RED.
3. Implement `src/conductor/src/engine/child-context.ts`: `export type ChildId = number & { readonly __brand: 'ChildId' }`; `export const MAX_CHILD_ID = 9`; `parseChildId(raw: string | number): ChildId | undefined` (`/^\d+$/` digits only for strings, integer, `1 <= k <= MAX_CHILD_ID`); `export const CHILD_REGION_STEPS = ['acceptance_specs', 'build', 'test_suite', 'build_review'] as const`; `isRegionStep(step)`; `pipelinePathFor(root, relative, child?)` returning `join(root, '.pipeline', relative)` or `join(root, '.pipeline', 'children', String(child), relative)`; `childStateExists(root, child)` (stat isDirectory, false on ENOENT); `listExistingChildren(root)` (readdir `.pipeline/children`, keep entries `parseChildId` accepts, ascending, `[]` on ENOENT, never mkdir). No import of `plan-slices.ts`; do not write the token `stacked_prs` or the capitalized slice-section token anywhere in the file.
4. Verify GREEN; verify `test/engine/plan-slices-consumer-boundary.test.ts` still passes unmodified.
5. Commit with message: "feat(engine): child-context module with ChildId, MAX_CHILD_ID and pipelinePathFor (#2940 task 2)".

**Done when:**
- `src/conductor/src/engine/child-context.ts` exports `MAX_CHILD_ID` equal to 9 and `parseChildId`, which returns a branded `ChildId` for `1` through `9` and `undefined` for `0`, `10`, `two`, `-1`, `1.5` and the empty string, as asserted by `test/engine/child-context.test.ts`.
- `pipelinePathFor(root, relative)` returns today's `.pipeline/<relative>` path and `pipelinePathFor(root, relative, child)` returns `.pipeline/children/<k>/<relative>` with the same file name, and `isRegionStep` is true for exactly `acceptance_specs`, `build`, `test_suite` and `build_review`.
- `childStateExists(root, child)` is true only when `.pipeline/children/<k>/` is a directory, and `listExistingChildren(root)` returns the ascending child ids of the `children/` subdirectories `parseChildId` accepts, skipping `foo` and `12`, and returns an empty list without creating anything when `children/` is absent.
- `test/engine/child-context.test.ts` imports `MAX_PLAN_SLICES` from `plan-slices.ts` and asserts `MAX_PLAN_SLICES <= MAX_CHILD_ID`, while `child-context.ts` imports no `plan-slices` module and contains no `stacked_prs` token, and `test/engine/plan-slices-consumer-boundary.test.ts` is unmodified.

**Files:**
- `src/conductor/src/engine/child-context.ts` — new module
- `src/conductor/test/engine/child-context.test.ts` — new tests

**Dependencies:** none

### Task 3: Feature-branch identity — strict parser and branch constructors
**Story:** Story 2 criteria 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23
**Type:** happy-path

**Steps:**
1. Write a failing table test in `src/conductor/test/engine/feature-branch-identity.test.ts` with every input named in the Done when (happy and negative), plus `leafBranchFor` and `childBranchFor` cases.
2. Verify RED.
3. Implement `src/conductor/src/engine/feature-branch-identity.ts`: `export const LEAF_PREFIX = 'feat/daemon-'`, `SPEC_PREFIX = 'spec/'`, `INTERACTIVE_PREFIX = 'feature/'`; `export type FeatureBranchIdentity = { kind: 'leaf'; slug } | { kind: 'child'; slug; child: ChildId } | { kind: 'spec'; slug } | { kind: 'interactive'; slug } | { kind: 'unrecognized'; raw; reason }`; `parseFeatureBranch(raw)`: leaf when `raw.startsWith(LEAF_PREFIX)` and the remainder is non-empty (today's permissive rule, `/` allowed; empty remainder → `unrecognized` reason `empty slug`); child when `raw` matches `^feat/c(\d+)(?:/(.*))?$` — digits parsed by `parseChildId` (failure → reason `invalid child id "<digits>"`), a missing or empty remainder → reason `missing slug`, a remainder containing `/` → reason `multi-segment slug`, then `childBranchFor(slug, k)` must reproduce `raw` exactly (otherwise reason `invalid child id` for non-canonical forms such as `c01`); `feat/c<non-digits>/...` such as `feat/cool/x` → reason `invalid child id`; `spec/<rest>` and `feature/<rest>` with non-empty rest; everything else `unrecognized`. `leafBranchFor(slug)` is the pure template `${LEAF_PREFIX}${slug}`. `childBranchFor(slug, child: number)` returns `{ ok: true, branch }` or `{ ok: false, reason }` naming the invalid child id (`parseChildId` fails) or the invalid slug (empty or containing `/`).
4. Verify GREEN. Commit with message: "feat(engine): feature-branch identity parser and constructors (#2940 task 3)".

**Done when:**
- `parseFeatureBranch` in `src/conductor/src/engine/feature-branch-identity.ts` returns leaf of `x` for `feat/daemon-x`, leaf of `c1` for `feat/daemon-c1`, leaf of `a/b` for `feat/daemon-a/b`, child 2 of `x` for `feat/c2/x`, child 9 of `engine-cannot-represent-more-than-one-branch-step-` for `feat/c9/engine-cannot-represent-more-than-one-branch-step-`, spec of `x` for `spec/x` and interactive of `x` for `feature/x`, as asserted by the table test in `test/engine/feature-branch-identity.test.ts`.
- The same table asserts `unrecognized` with a reason naming an invalid child id for `feat/c0/x`, `feat/c10/x`, `feat/c01/x` (rejected because `childBranchFor(slug, 1)` does not reproduce the raw name) and `feat/cool/x`; `unrecognized` with a reason naming a missing slug for `feat/c1` and `feat/c1/` and a multi-segment slug for `feat/c1/a/b`; `unrecognized` with an empty-slug reason for `feat/daemon-`, `spec/` and `feature/`; and `unrecognized` for `refs/heads/feat/c1/x`, `origin/feat/c1/x` and `main`.
- `leafBranchFor(slug)` returns `feat/daemon-` immediately followed by the slug unchanged, with no validation, for `x`, `a/b` and `trailing-`, and the exported `LEAF_PREFIX`, `SPEC_PREFIX` and `INTERACTIVE_PREFIX` equal `feat/daemon-`, `spec/` and `feature/`.
- `childBranchFor('x', 3)` returns `{ ok: true, branch: 'feat/c3/x' }`; `childBranchFor('x', 0)` and `childBranchFor('x', 10)` return `{ ok: false }` with a reason naming the invalid child id and no `branch` property; `childBranchFor('a/b', 1)` and `childBranchFor('', 1)` return `{ ok: false }` with a reason naming the invalid slug and no `branch` property.

**Files:**
- `src/conductor/src/engine/feature-branch-identity.ts` — new module
- `src/conductor/test/engine/feature-branch-identity.test.ts` — new table tests

**Dependencies:** Task 2

### Task 4: Feature-branch identity — ref parser, ref globs and daemon-owned predicate
**Story:** Story 2 criterion 16 (identity half); Story 4 criterion 36 (predicate half)
**Type:** happy-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/feature-branch-identity.test.ts` for `parseFeatureRef`, `CHILD_REF_GLOBS`, `LEAF_REF_GLOBS`, `SPEC_REF_GLOBS`, `isDaemonOwnedBranchName` and `featureSlugOf`.
2. Verify RED.
3. Implement in `feature-branch-identity.ts`: `parseFeatureRef(ref)` strips `refs/heads/`, else `refs/remotes/<one segment>/`, else — when `parseFeatureBranch(ref)` is `unrecognized` and the first segment is none of `feat`, `spec`, `feature` — one leading `<remote>/` segment, then calls `parseFeatureBranch` (so `origin/feat/c1/a/b` stays unrecognized). `CHILD_REF_GLOBS = ['refs/heads/feat/c[1-9]/*', 'refs/remotes/*/feat/c[1-9]/*']`, `LEAF_REF_GLOBS = ['refs/heads/feat/daemon-*', 'refs/remotes/*/feat/daemon-*']`, `SPEC_REF_GLOBS = ['refs/heads/spec/*', 'refs/remotes/*/spec/*']`. `isDaemonOwnedBranchName(name) = name.startsWith(LEAF_PREFIX) || parseFeatureBranch(name).kind === 'child'` (keeps `requiresShippedRecord('feat/daemon-') === true`). `featureSlugOf(identity)` returns `slug` or `undefined` for `unrecognized`.
4. Verify GREEN. Commit with message: "feat(engine): feature-ref parser, ref globs and daemon-owned predicate (#2940 task 4)".

**Done when:**
- `parseFeatureRef` returns child 1 of `x` for both `refs/heads/feat/c1/x` and `origin/feat/c1/x`, leaf of `x` for `refs/remotes/origin/feat/daemon-x` and `origin/feat/daemon-x`, spec of `x` for `origin/spec/x`, and `unrecognized` for `origin/spec/` and `origin/feat/c1/a/b`, as asserted in `test/engine/feature-branch-identity.test.ts`, and the prefix stripping lives only in `parseFeatureRef`.
- `CHILD_REF_GLOBS` equals `refs/heads/feat/c[1-9]/*` and `refs/remotes/*/feat/c[1-9]/*`, `LEAF_REF_GLOBS` equals `refs/heads/feat/daemon-*` and `refs/remotes/*/feat/daemon-*`, and `SPEC_REF_GLOBS` equals `refs/heads/spec/*` and `refs/remotes/*/spec/*`.
- `isDaemonOwnedBranchName` is true for `feat/daemon-x`, `feat/daemon-` and `feat/c1/x` and false for `spec/x`, `feature/x`, `feat/c0/x`, `feat/c1` and `main`; `featureSlugOf` returns the slug of a leaf, child, spec or interactive identity and `undefined` for `unrecognized`.

**Files:**
- `src/conductor/src/engine/feature-branch-identity.ts` — ref parser, globs, predicate
- `src/conductor/test/engine/feature-branch-identity.test.ts` — added cases

**Dependencies:** Task 3

### Task 5: finish-record adopts the identity module and refuses a child branch
**Story:** Story 3 criteria 24 and 28; Story 4 criterion 38 and Story 4 Done When (child `worktree_branch` exits 1, state byte-unchanged)
**Type:** negative-path

**Steps:**
1. Add a failing table test to `src/conductor/test/engine/finish-record-cli.test.ts` over `dispatchFinishRecord` with injected `runGit`/`runGh`/`stateStore`: `spec/x`, `feature/x`, `feat/daemon-x` (slug `x`, identical writes); `feat/daemon-`, `spec/`, `feature/`, `main` (today's refusal text, exit 1, no writes, no git/gh calls); `feat/c1/x` (child refusal). Capture today's refusal message bytes from the current implementation before changing it.
2. Verify RED.
3. Implement in `src/conductor/src/engine/finish-record-cli.ts`: replace the regex and `featureSlugFromDaemonBranch` with `parseFeatureBranch(worktreeBranch)`; `spec`/`interactive`/`leaf` → slug; `child` → `console.error(\`finish-record: worktree_branch "${worktreeBranch}" is a stacked child branch (feat/c<k>/<slug>); only the leaf ${LEAF_PREFIX}<slug> records a ship — refusing to record PR ${cmd.prUrl}\`)` and `return 1` before any git or gh call; `unrecognized` → today's message composed as `` `finish-record: worktree_branch "${worktreeBranch}" is not a valid ${SPEC_PREFIX}<slug>, ${INTERACTIVE_PREFIX}<slug>, or ${LEAF_PREFIX}<slug> branch identity — refusing to record PR ${cmd.prUrl}` `` (byte-identical output). Remove the `featureSlugFromDaemonBranch` import.
4. Verify GREEN. Commit with message: "refactor(finish-record): resolve the worktree branch through the identity module and refuse children (#2940 task 5)".

**Done when:**
- `dispatchFinishRecord` derives the slug through `parseFeatureBranch`; for `worktree_branch` `spec/x`, `feature/x` and `feat/daemon-x` it passes slug `x` to `evaluateShipmentEvidence` and writes the same `pr_url` mutation, `finish-choice` marker and `DONE` bytes as the pre-migration code, as asserted by a table test in `test/engine/finish-record-cli.test.ts`.
- For `worktree_branch` `feat/daemon-`, `spec/`, `feature/` and `main`, the table asserts exit 1 with today's stderr message naming the branch and `spec/<slug>, feature/<slug>, or feat/daemon-<slug> branch identity` (composed from `SPEC_PREFIX`, `INTERACTIVE_PREFIX` and `LEAF_PREFIX`), no git or gh call, and `conduct-state.json`, `finish-choice` and `DONE` untouched.
- For `worktree_branch` `feat/c1/x`, `finish-record --choice pr` exits 1 with a stderr message containing `feat/c<k>/<slug>`, `only the leaf` and `records a ship`, makes no git or gh call, and leaves `conduct-state.json` byte-unchanged with no `pr_url` written, no `finish-choice` marker and no `DONE` or shipped record written.
- `src/conductor/src/engine/finish-record-cli.ts` no longer imports `featureSlugFromDaemonBranch` and contains no `feat/daemon-`, `spec/` or `feature/` literal outside comments.

**Files:**
- `src/conductor/src/engine/finish-record-cli.ts` — identity adoption, child refusal
- `src/conductor/test/engine/finish-record-cli.test.ts` — parity table and child refusal

**Dependencies:** Task 3

### Task 6: Halt-PR reconciliation adopts the identity module and probes the leaf for a child
**Story:** Story 3 criteria 25, 31, 32 (sweep half); Story 4 criterion 34
**Type:** happy-path

**Steps:**
1. Add a failing table test to `src/conductor/test/engine/halt-pr-reconciliation.test.ts` recording the injected `runGit` argv per marked PR head: `feat/daemon-x`, `feat/daemon-a/b`, `feat/daemon-` (empty remainder, today's no-action path), `feat/c1/x`, `main`, `hotfix/y`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/halt-pr-reconciliation.ts`: delete `DAEMON_BRANCH_PREFIX` and `featureSlugFromDaemonBranch`; at the resolution check compute `const identity = parseFeatureBranch(pr.headRefName ?? '')`, `slug = featureSlugOf(identity)` only for `leaf` and `child` (spec/interactive/unrecognized keep today's null path), and `probeBranch = identity.kind === 'child' ? leafBranchFor(slug) : pr.headRefName`; call `hasShippedRecordOnBranch(git, projectRoot, probeBranch, slug)` (it already probes `[branch, origin/branch]`), and use `probeBranch` in the emitted text in place of `pr.headRefName`.
4. Verify GREEN. Commit with message: "refactor(halt-pr): resolve PR heads through the identity module and probe the leaf for children (#2940 task 6)".

**Done when:**
- `reconcileHaltPrs` resolves each marked PR head through `parseFeatureBranch`; for head `feat/daemon-x` the injected `runGit` records exactly `cat-file -e feat/daemon-x:.docs/shipped/x.md` and then `cat-file -e origin/feat/daemon-x:.docs/shipped/x.md`, and for head `feat/daemon-a/b` it records `cat-file -e feat/daemon-a/b:.docs/shipped/a/b.md`, as asserted by a table test in `test/engine/halt-pr-reconciliation.test.ts`.
- For head `feat/c1/x` the sweep attributes the PR to feature `x` and probes `feat/daemon-x:.docs/shipped/x.md` then `origin/feat/daemon-x:.docs/shipped/x.md` through `hasShippedRecordOnBranch(runGit, projectRoot, leafBranchFor('x'), 'x')`, never a `feat/c1/x:` ref, and clears the halt presentation when that probe succeeds.
- For heads `main` and `hotfix/y` the sweep records no `cat-file` probe and performs no clear for that PR, exactly today's unrecognized-head behavior, as asserted with a marked-conforming fixture whose injected `runGit` and mutation runner record zero calls for it.
- `featureSlugFromDaemonBranch` and the private `DAEMON_BRANCH_PREFIX` are deleted from `src/conductor/src/engine/halt-pr-reconciliation.ts`, which contains no `feat/daemon-` literal outside comments.

**Files:**
- `src/conductor/src/engine/halt-pr-reconciliation.ts` — identity adoption, leaf probe
- `src/conductor/test/engine/halt-pr-reconciliation.test.ts` — parity table and child case

**Dependencies:** Task 3

### Task 7: Daemon halt-PR operations adopt the identity module with a leaf-exists guard
**Story:** Story 3 criteria 25, 31, 32 (daemon-operations half); Story 4 criteria 37, 42, 43
**Type:** negative-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/daemon-halt-pr-operations.test.ts`: a parity table over heads `feat/daemon-x`, `feat/daemon-a/b`, `main`, `hotfix/y`, `feat/daemon-` asserting the returned runner's provenance fields (or `undefined`) equal the pre-change results; child cases with an injected `git` whose `show-ref` answers exit 0 / non-zero / throws; a `reconcileHaltPrs` fixture with a child PR followed by a `feat/daemon-y` PR.
2. Verify RED.
3. Implement in `src/conductor/src/engine/daemon-halt-pr-operations.ts`: delete the exported `DAEMON_BRANCH_PREFIX`; export `leafRefExists(git: GitRunner, slug): Promise<'present' | 'absent' | 'error'>` running `['show-ref', '--verify', '--quiet', \`refs/heads/${leafBranchFor(slug)}\`]` then, on non-zero, `['show-ref', '--verify', '--quiet', \`refs/remotes/origin/${leafBranchFor(slug)}\`]`, returning `error` when `git` throws; in the factory, `parseFeatureBranch(branch)`: `leaf` → today's runner (slug from identity, `specBranch: branch`); `child` → the same guarded runner for the parent slug with `specBranch: branch`, wrapped so `run(request)` first awaits `leafRefExists` and resolves `{ kind: 'refused', reason: 'invalid-target' }` without delegating unless the result is `present`; every other kind → `undefined` as today. Keep the factory synchronous so `daemon-runner.ts`, `daemon-deps.ts` and `halt-pr-reconciliation.ts` signatures are unchanged.
4. Verify GREEN. Commit with message: "refactor(daemon): halt-PR operations resolve heads through the identity module with a leaf-exists guard (#2940 task 7)".

**Done when:**
- `createDaemonHaltPrOperations(options)(pr)` returns a guarded runner for head `feat/daemon-x` with `featureMarker` `.docs/intake/x.md` and `specBranch` `feat/daemon-x`, a runner for head `feat/daemon-a/b` with `featureMarker` `.docs/intake/a/b.md`, and `undefined` for heads `main`, `hotfix/y` and `feat/daemon-`, matching today's results field for field, as asserted by a table test in `test/engine/daemon-halt-pr-operations.test.ts`.
- For head `feat/c1/x` with an existing `feat/daemon-x`, the factory returns a runner for feature `x` (`featureMarker` `.docs/intake/x.md`, `specBranch` `feat/c1/x`) whose `run` first awaits the exported `leafRefExists(git, 'x')`, which runs `show-ref --verify --quiet refs/heads/feat/daemon-x` and, if that exits non-zero, `show-ref --verify --quiet refs/remotes/origin/feat/daemon-x`, and delegates to the guarded runner when either exits 0.
- When both probes exit non-zero, `run` resolves to `{ kind: 'refused', reason: 'invalid-target' }` without invoking `gh`; when the probe `git` call throws, `leafRefExists` returns `error` and `run` resolves to the same refusal without invoking `gh`; a `reconcileHaltPrs` fixture listing that child PR before a `feat/daemon-y` PR asserts the `feat/daemon-y` PR is still healed.
- The exported `DAEMON_BRANCH_PREFIX` is deleted from `src/conductor/src/engine/daemon-halt-pr-operations.ts`, which contains no `feat/daemon-` literal outside comments.

**Files:**
- `src/conductor/src/engine/daemon-halt-pr-operations.ts` — identity adoption, `leafRefExists`, lazy guard
- `src/conductor/test/engine/daemon-halt-pr-operations.test.ts` — new tests

**Dependencies:** Task 3

### Task 8: GitHub-operations scope check — non-child parity and child-to-leaf resolution
**Story:** Story 3 criteria 26, 29, 30; Story 5 criteria 47, 48
**Type:** happy-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/github-ownership/22-expose-guarded-cli-operations-to-supported-hosts.test.ts` over `dispatchGithubOperationCommand` with injected `git`, `gh`, `remoteGit`, `resolveMachineOwner`: a parity table over current branches `feat/daemon-x`, `spec/x`, `feature/x`, `feat/daemon-`, `spec/`, `main` with `context.feature: 'x'`; child cases where only the local or only the origin `show-ref` probe exits 0.
2. Verify RED.
3. Implement in `src/conductor/src/engine/github-operations-cli.ts` `featureMutationForRequest`: `const identity = parseFeatureBranch(branch)`; when `identity.kind === 'child'`, `const leaf = await leafRefExists(gitForCwd, identity.slug)`; `leaf !== 'present'` → `{ kind: 'refused', reason: 'invalid-target' }`; otherwise `slug = identity.slug`. For every other kind keep today's expression verbatim: `slug = branch.startsWith(LEAF_PREFIX) ? branch.slice(LEAF_PREFIX.length) : branch.replace(/^spec\//, '')` rewritten with the identity module's constants only as `branch.startsWith(LEAF_PREFIX) ? branch.slice(LEAF_PREFIX.length) : branch.startsWith(SPEC_PREFIX) ? branch.slice(SPEC_PREFIX.length) : branch`, so that `feat/daemon-` and `spec/` yield the empty string and `feature/x` yields `feature/x` exactly as before. Then the existing `context.feature` comparison and `resolveFeatureRemoteMutation({ slug, branch, ... })` run unchanged. Replace the `DAEMON_BRANCH_PREFIX` import with `parseFeatureBranch`, `LEAF_PREFIX`, `SPEC_PREFIX` and `leafRefExists`.
4. Verify GREEN. Commit with message: "refactor(github-operations): resolve the current branch through the identity module with leaf-exists for children (#2940 task 8)".

**Done when:**
- `featureMutationForRequest` keeps today's slug expression for every non-child branch (`feat/daemon-x` and `spec/x` give slug `x`, `feature/x` gives `feature/x`, `feat/daemon-` and `spec/` give the empty string, `main` gives `main`), so a request whose `context.feature` is `x` from branch `feature/x`, `feat/daemon-` or `spec/` is refused `invalid-target` with zero `gh` and `remoteGit` calls, exactly as today, as asserted by a table test over `dispatchGithubOperationCommand` in `test/engine/github-ownership/22-expose-guarded-cli-operations-to-supported-hosts.test.ts`.
- From branch `feat/daemon-x` or `spec/x` with `context.feature` `x`, the operation reaches the unchanged committed-owner check: `resolveMachineOwner` is invoked and the provenance carries `featureMarker` `.docs/intake/x.md`, as today.
- From branch `feat/c1/x` with `context.feature` `x`, when `leafRefExists` finds `refs/heads/feat/daemon-x` locally, or finds only `refs/remotes/origin/feat/daemon-x`, the operation resolves slug `x` and proceeds to the same committed-owner check with `featureMarker` `.docs/intake/x.md`, asserted by two dispatch tests whose injected `git` answers exit 0 to only one of the two `show-ref` probes.
- `src/conductor/src/engine/github-operations-cli.ts` imports `parseFeatureBranch` and `leafRefExists` in place of `DAEMON_BRANCH_PREFIX` and contains no `feat/daemon-` or `spec/` literal outside comments.

**Files:**
- `src/conductor/src/engine/github-operations-cli.ts` — identity adoption, child-to-leaf resolution
- `src/conductor/test/engine/github-ownership/22-expose-guarded-cli-operations-to-supported-hosts.test.ts` — parity table and child happy cases

**Dependencies:** Task 3, Task 7

### Task 9: GitHub-operations scope check — child refusals and push-target containment
**Story:** Story 5 criteria 49, 50, 51, 52, 53, 54; Story 5 Done When (no transport call on any refusal)
**Type:** negative-path

**Steps:**
1. Add failing tests to the same test file: child with no leaf anywhere; child with `context.feature: 'y'`; probe `git` throws; committed owner mismatch from `feat/c1/x` vs `feat/daemon-x`; an authorized push from `feat/c1/x` recording every `git`, `gh` and `remoteGit` argv.
2. Verify RED.
3. Implement any remaining ordering in `featureMutationForRequest` so the child refusal and the `context.feature` refusal both return before `resolveFeatureRemoteMutation`, and `leafRefExists` `error` maps to `{ kind: 'refused', reason: 'invalid-target' }`. The push destination is unchanged: `resolveFeatureRemoteMutation({ branch })` with the checked-out child branch.
4. Verify GREEN. Commit with message: "feat(github-operations): refuse child writes without a leaf and keep the push target on the child (#2940 task 9)".

**Done when:**
- From branch `feat/c1/x` with no `feat/daemon-x` locally or on origin, `dispatchGithubOperationCommand` returns `{ kind: 'refused', reason: 'invalid-target' }` before any write: the injected `git` records only `branch --show-current` and the two `show-ref` probes, and the injected `gh` and `remoteGit` record zero calls.
- From branch `feat/c1/x` with `context.feature` `y`, the result is `{ kind: 'refused', reason: 'invalid-target' }` with zero `gh` and `remoteGit` calls and no git write; when the leaf probe `git` call throws, the result is `{ kind: 'refused', reason: 'invalid-target' }` with zero `gh` and `remoteGit` calls and no git write.
- From branch `feat/c1/x` whose committed `.docs/intake/x.md` names an owner other than the resolved machine operator, the result is `{ kind: 'refused', reason: 'other-owner' }`, deep-equal to the result the same fixture yields from branch `feat/daemon-x`.
- For an authorized push from `feat/c1/x`, `resolveFeatureRemoteMutation` is called with `branch: 'feat/c1/x'` so the remote-ref target is `refs/heads/feat/c1/x`, the PR binding read is `gh pr view feat/c1/x`, and the recorded `remoteGit` push argv contains `HEAD:refs/heads/feat/c1/x` while no recorded `git`, `gh` or `remoteGit` argv contains `feat/daemon-x` as a destination (only the two `show-ref` probes name it).

**Files:**
- `src/conductor/src/engine/github-operations-cli.ts` — refusal ordering
- `src/conductor/test/engine/github-ownership/22-expose-guarded-cli-operations-to-supported-hosts.test.ts` — child negative cases

**Dependencies:** Task 8

### Task 10: Leaf template sites use `leafBranchFor`
**Story:** Story 3 criteria 27, 33
**Type:** refactor

**Steps:**
1. Add failing assertions: `test/engine/daemon-deps.test.ts` (`createWorktree` for slugs `x`, `a/b`, `trailing-`), `test/engine/mergeable-sweep.test.ts` (teardown branch for `x` and `a/b`), and a new `src/conductor/test/daemon-cli-leaf-branch.test.ts` source-scan test reading `src/conductor/src/daemon-cli.ts`.
2. Verify RED (the source-scan test fails while the literals remain).
3. Implement: `daemon-deps.ts:175` `const branch = leafBranchFor(slug)`; `mergeable-sweep.ts:418` `branch: leafBranchFor(entry.slug)`; `src/daemon-cli.ts:1998` `const branch = leafBranchFor(slug)`; `src/daemon-cli.ts:2779` `headRefName: leafBranchFor(entry.slug)`. No other change at those sites.
4. Verify GREEN. Commit with message: "refactor(daemon): build the leaf branch name through leafBranchFor (#2940 task 10)".

**Done when:**
- `daemon-deps.ts` `createWorktree(slug)` passes `leafBranchFor(slug)` as the branch to `ensureWorktree`, so for slugs `x`, `a/b` and `trailing-` the returned branch equals `feat/daemon-x`, `feat/daemon-a/b` and `feat/daemon-trailing-`, as asserted in `test/engine/daemon-deps.test.ts`.
- `mergeable-sweep.ts` teardown passes `branch: leafBranchFor(entry.slug)` to `teardownWorktree`, asserted in `test/engine/mergeable-sweep.test.ts` to equal `feat/daemon-x` for slug `x` and `feat/daemon-a/b` for slug `a/b`.
- `src/daemon-cli.ts` builds the shipped-record probe branch (`cat-file -e <leaf>:.docs/shipped/<slug>.md`, then `origin/<leaf>`) and the CI-fix `headRefName` with `leafBranchFor`, asserted by `test/daemon-cli-leaf-branch.test.ts`, which finds `leafBranchFor(` at both sites and no `feat/daemon-` literal in the file, so with Task 3's template proof both sites yield today's `feat/daemon-<slug>` string for `x`, `a/b` and `trailing-`.
- None of `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/src/engine/mergeable-sweep.ts` and `src/conductor/src/daemon-cli.ts` contains a `feat/daemon-` literal outside comments.

**Files:**
- `src/conductor/src/engine/daemon-deps.ts` — `leafBranchFor`
- `src/conductor/src/engine/mergeable-sweep.ts` — `leafBranchFor`
- `src/conductor/src/daemon-cli.ts` — `leafBranchFor` at the probe and CI-fix sites
- `src/conductor/test/engine/daemon-deps.test.ts` — added slugs
- `src/conductor/test/engine/mergeable-sweep.test.ts` — added slugs
- `src/conductor/test/daemon-cli-leaf-branch.test.ts` — new source-scan test

**Dependencies:** Task 3

### Task 11: Intake overlap enumerates child refs with strict post-filtering before any further git call
**Story:** Story 2 criterion 16 (enumeration half); Story 4 criteria 44, 46
**Type:** negative-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/overlap-scan-branch-set.test.ts`, `enumerateUnmergedBranches(git, base, patterns, onFailure, acceptCandidate)` with an injected `git` whose `for-each-ref` returns `feat/c1/a/b` and `feat/c1/` asserts both are dropped and no `rev-list` argv names either; in `src/conductor/test/engine/intake-overlap-branches.test.ts` (real local git, pinned identity and dates), branches `feat/cool/x` and `feat/c1-x/baz` are absent from `selectInFlightBranches`, and `feat/c1/x` plus `origin/feat/c1/x` (bare remote in the fixture) both appear.
2. Verify RED.
3. Implement: `overlap-scan.ts` `enumerateUnmergedBranches` gains a fifth parameter `acceptCandidate?: (ref: string) => boolean` applied to the split `for-each-ref` lines before the `rev-list` loop. `overlap-sources.ts`: `IN_FLIGHT_REF_PATTERNS = [...SPEC_REF_GLOBS, ...LEAF_REF_GLOBS, ...CHILD_REF_GLOBS]`; `selectInFlightBranches` passes `(ref) => parseFeatureRef(ref).kind !== 'unrecognized'`.
4. Verify GREEN. Commit with message: "feat(intake): enumerate child refs with a strict pre-rev-list filter (#2940 task 11)".

**Done when:**
- `IN_FLIGHT_REF_PATTERNS` in `overlap-sources.ts` is `[...SPEC_REF_GLOBS, ...LEAF_REF_GLOBS, ...CHILD_REF_GLOBS]` from the identity module, and `enumerateUnmergedBranches` in `overlap-scan.ts` accepts an `acceptCandidate` predicate that it applies to each `for-each-ref` line before any `rev-list` call; `selectInFlightBranches` passes `(ref) => parseFeatureRef(ref).kind !== 'unrecognized'`.
- With an injected `git` whose `for-each-ref` returns `feat/c1/a/b` and `feat/c1/`, `selectInFlightBranches` excludes both, the injected `git` records no git command of any kind (including `rev-list`, `cat-file` and `log`) naming either after the `for-each-ref` call, and `skipNotes` is empty.
- In a real local repository holding branches `feat/cool/x` and `feat/c1-x/baz`, `selectInFlightBranches` returns neither, as asserted in `test/engine/intake-overlap-branches.test.ts`.
- In a real local repository holding `refs/heads/feat/c1/x` and `refs/remotes/origin/feat/c1/x`, the `for-each-ref` short names `feat/c1/x` and `origin/feat/c1/x` both resolve through `parseFeatureRef` to child 1 of `x` and both appear in `selectInFlightBranches`.

**Files:**
- `src/conductor/src/engine/overlap-scan.ts` — `acceptCandidate` parameter
- `src/conductor/src/engine/engineer/intake/overlap-sources.ts` — globs from the identity module, predicate
- `src/conductor/test/engine/overlap-scan-branch-set.test.ts` — filter-before-rev-list test
- `src/conductor/test/engine/intake-overlap-branches.test.ts` — real-git child cases

**Dependencies:** Task 4

### Task 12: Intake overlap attributes child rows to the parent and excludes shipped children
**Story:** Story 4 criteria 35, 45
**Type:** happy-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/intake-overlap-branches.test.ts`: `traceBranchIssue` and `isShippedBranch` probe argv for `feat/daemon-x` and `feat/c2/x`; a real repository with `.docs/shipped/x.md` committed on `main` excluding both `feat/c1/x` and `feat/daemon-x`.
2. Verify RED.
3. Implement in `overlap-sources.ts`: replace `inFlightSlug(branch)` body with `featureSlugOf(parseFeatureRef(branch)) ?? null` restricted to `spec`, `leaf` and `child` kinds (interactive stays excluded as today).
4. Verify GREEN. Commit with message: "feat(intake): attribute child branches to the parent feature in overlap (#2940 task 12)".

**Done when:**
- `inFlightSlug` is replaced by `featureSlugOf(parseFeatureRef(branch))` for spec, leaf and child kinds, so for `feat/daemon-x` and `feat/c2/x` both rows resolve feature `x`: `traceBranchIssue` reads `<branch>:.docs/intake/x.md` for each, `isShippedBranch` probes `<base>:.docs/shipped/x.md` for each, and no probe names `c2.md` or `x-c2.md`, as asserted in `test/engine/intake-overlap-branches.test.ts`.
- In a real local repository where `.docs/shipped/x.md` is committed on the default branch, `selectInFlightBranches` excludes `feat/c1/x` exactly as it excludes `feat/daemon-x`, and both remain included when the record is absent.
- `src/conductor/src/engine/engineer/intake/overlap-sources.ts` contains no `feat/daemon-` or `spec/` literal outside comments.

**Files:**
- `src/conductor/src/engine/engineer/intake/overlap-sources.ts` — slug attribution
- `src/conductor/test/engine/intake-overlap-branches.test.ts` — attribution and shipped-exclusion cases

**Dependencies:** Task 11

### Task 13: Park treats children as daemon-owned and refuses a child candidate before the record precondition
**Story:** Story 4 criteria 36, 39, 40 (branch-listed half)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/park-reconciliation.test.ts` using the existing `makeGit` world: `requiresShippedRecord` table; a parked `x` whose worktree lists `feat/c1/x` run through `reconcileParkedFeatures` with `onEvent`, `requestRecordRepair` and `runGh` spies.
2. Verify RED.
3. Implement in `src/conductor/src/engine/park-reconciliation.ts`: `requiresShippedRecord(branch)` returns true when `branch` is undefined or `isDaemonOwnedBranchName(branch)` is true (replacing the `startsWith('feat/daemon-')` test); add `'child-branch'` to `RefusalReason`; in `reconcileMergedPark`, immediately after the in-flight and live-phase-marker checks and before `gatherMergeEvidence`, `if (opts.branch !== undefined && parseFeatureBranch(opts.branch).kind === 'child') return { slug: opts.slug, steps: [], refusal: 'child-branch' }`. The sweep loop already counts non-`record-missing` refusals and emits `worktree_reclaim_failed`.
4. Verify GREEN. Commit with message: "feat(park): children are daemon-owned and a child candidate is refused before the record precondition (#2940 task 13)".

**Done when:**
- `requiresShippedRecord(branch)` returns true when `branch` is undefined or `isDaemonOwnedBranchName(branch)` is true, so it is true for `feat/c1/x`, `feat/daemon-x`, `feat/daemon-` and `undefined` and false for `spec/x`, and the sweep's `hasRecordGatedCandidate` prefetch treats a `feat/c1/x` worktree as record-gated, never as a non-daemon branch reclaimable on its deletion proofs alone, as asserted in `test/engine/park-reconciliation.test.ts`.
- `RefusalReason` gains `child-branch`, and `reconcileMergedPark` returns `{ refusal: 'child-branch', steps: [] }` for a listed `feat/c1/x` branch immediately after the in-flight checks and before `gatherMergeEvidence`, the shipped-record precondition and any `gh pr list` lookup, so the injected `git` records no `ls-tree`, `merge-base`, `worktree remove` or `branch -d` call and the injected `gh` records zero calls.
- `reconcileParkedFeatures` counts that outcome in `counts.refused` and `refusedByReason['child-branch']`, and emits `{ type: 'worktree_reclaim_failed', slug: 'x', branch: 'feat/c1/x', refusal: 'child-branch' }`, while `.worktrees/x` and branch `feat/c1/x` remain.
- With a merged PR whose head is `feat/c1/x` and no `.docs/shipped/x.md` on `origin/main`, `requestRecordRepair` is never called and no `gh pr list --head` argv names `feat/c1/x`.

**Files:**
- `src/conductor/src/engine/park-reconciliation.ts` — daemon-owned predicate, `child-branch` refusal
- `src/conductor/test/engine/park-reconciliation.test.ts` — child candidate cases

**Dependencies:** Task 4

### Task 14: Park never deletes a child on the branch-undefined path and repairs records only from the leaf head
**Story:** Story 4 criteria 40 (branch-undefined half), 41
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/park-reconciliation-merge-evidence.test.ts` and `park-reconciliation.test.ts`: parked slug `x` with no listed branch while local `feat/daemon-x` and `feat/c1/x` both exist and both are contained in `origin/main`; compare the recorded `git`/`gh` argv and outcome with the same fixture lacking `feat/c1/x`.
2. Verify RED.
3. Implement in `gatherMergeEvidence`: when `branch === undefined`, filter `branchesBySlug.get(key)` to refs whose `parseFeatureBranch(ref).kind !== 'child'` before the ancestry loop, so `evidence.branches` and `evidence.mergedBranches` never hold a child ref; the record-missing arm and the deletion loop then see only the filtered list.
4. Verify GREEN. Commit with message: "feat(park): never delete or repair from a child branch on the branch-undefined path (#2940 task 14)".

**Done when:**
- `gatherMergeEvidence` on the branch-undefined path drops every ref whose `parseFeatureBranch` kind is `child` from `evidence.branches` and `evidence.mergedBranches`, so with local `feat/daemon-x` and `feat/c1/x` for parked slug `x` the evidence lists only `feat/daemon-x`, as asserted in `test/engine/park-reconciliation-merge-evidence.test.ts`.
- With that fixture `reconcileMergedPark` runs no `git branch -d feat/c1/x`, and its `git branch -d feat/daemon-x`, record precondition, proofs and refusal taxonomy for `feat/daemon-x` are deep-equal to the same fixture without the child branch, as asserted in `test/engine/park-reconciliation.test.ts`.
- On the record-missing arm the merged-PR lookup iterates only the filtered `evidence.branches`, so no `gh pr list --state merged --head` argv names a `feat/c1/` head.

**Files:**
- `src/conductor/src/engine/park-reconciliation.ts` — child filter in `gatherMergeEvidence`
- `src/conductor/test/engine/park-reconciliation-merge-evidence.test.ts` — evidence filter
- `src/conductor/test/engine/park-reconciliation.test.ts` — branch-undefined deletion parity

**Dependencies:** Task 13

### Task 15: Conduct-state store at a child path (isolation, absent read, conflict)
**Story:** Story 6 criteria 56 (step-status part), 61, 63, 64 (status part); Story 6 Done When (store tests for flat and child paths)
**Type:** happy-path

**Steps:**
1. Follow the per-path store pattern: the store is constructed from a path and leases per path, so a child store is `createFilesystemConductStateStore(pipelinePathFor(root, 'conduct-state.json', child))` with no store change. Write `src/conductor/test/engine/child-conduct-state-store.test.ts` covering the Done when; use `mkdtemp`, await every promise, assert no `.tmp` file remains.
2. Verify the tests pass against the existing store (this task lands tests only; no production change is expected — if a defect appears, fix it in `filesystem-conduct-state-store.ts` and add it to Files).
3. Commit with message: "test(state): conduct-state store isolation at a child path (#2940 task 15)".

**Done when:**
- `createFilesystemConductStateStore(pipelinePathFor(root, 'conduct-state.json', 2))` writes `.pipeline/children/2/conduct-state.json` with the flat `ConductState` schema, recording region step statuses and a `last_step`, and the flat `.pipeline/conduct-state.json` and `.pipeline/children/3/conduct-state.json` bytes are unchanged by that write, as asserted in `test/engine/child-conduct-state-store.test.ts`.
- `readState(pipelinePathFor(root, 'conduct-state.json', 2))` with no child file returns `ok: false` with error type `io_error`, the same result a missing flat file returns, and creates no file or directory under `.pipeline/children/`.
- Two stores on child 2's path that both read the same snapshot and then `apply` conflicting mutations to `build` yield `{ kind: 'conflict' }` for the second writer with a message naming field `build` and the submitted intent, and the file holds the first writer's value with no temporary file left behind.
- Writing `prd_audit` or `manual_test` status through the flat store while `.pipeline/children/2/` exists changes only `.pipeline/conduct-state.json`, and no file under `children/` changes.

**Files:**
- `src/conductor/test/engine/child-conduct-state-store.test.ts` — new tests

**Dependencies:** Task 2

### Task 16: Gate verdicts at a child path with a whole-feature refusal and unchanged flat enumeration
**Story:** Story 6 criteria 55 (verdict part), 56 (verdict part), 57, 58, 64 (verdict part), 65
**Type:** happy-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/gate-verdicts.test.ts` for `verdictPathFor`, `readVerdict`/`writeVerdict` with a child, the whole-feature refusal, and `readAllVerdicts` plus `readFullSuiteEvidence` with and without a populated `children/2/`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/gate-verdicts.ts`: `export function verdictPathFor(dir, step, child?)` → `child === undefined ? join(dir, GATES_DIR, \`${step}.json\`) : (isRegionStep(step) ? join(pipelinePathFor(dir, \`gates/${step}.json\`, child)) : throw new Error(\`gate verdict for whole-feature step "${step}" cannot be stored under a child\`))`; `readVerdict(dir, step, child?)` and `writeVerdict(dir, step, verdict, child?)` resolve through it (`writeVerdict` creates only the resolved file's directory). `readAllVerdicts` is unchanged (it skips non-`.json` entries, so `children` is ignored).
4. Verify GREEN. Commit with message: "feat(gates): per-child verdict paths for region steps (#2940 task 16)".

**Done when:**
- `gate-verdicts.ts` exports `verdictPathFor(dir, step, child?)`, and `readVerdict` and `writeVerdict` accept an optional trailing `child`; with no child every call resolves `.pipeline/gates/<step>.json` and writes bytes identical to the pre-change code, as asserted in `test/engine/gate-verdicts.test.ts`.
- `writeVerdict(dir, 'build_review', verdict, 2)` writes `.pipeline/children/2/gates/build_review.json` with the same `GateVerdict` schema, and rewriting it leaves `.pipeline/children/3/gates/build_review.json` and `.pipeline/gates/build_review.json` byte-unchanged.
- `verdictPathFor(dir, 'prd_audit', 2)` and `writeVerdict(dir, 'prd_audit', verdict, 2)` throw an error whose message names `prd_audit` as a whole-feature step, and no file or directory is created under `.pipeline/children/2/`; `writeVerdict(dir, 'prd_audit', verdict)` still writes the flat `.pipeline/gates/prd_audit.json` while `.pipeline/children/2/` exists.
- `readAllVerdicts(dir)` and `readFullSuiteEvidence` return results deep-equal with and without a populated `.pipeline/children/2/` directory, including no entry for any file under `children/`.

**Files:**
- `src/conductor/src/engine/gate-verdicts.ts` — `verdictPathFor`, child-aware read/write
- `src/conductor/test/engine/gate-verdicts.test.ts` — child path, refusal and sweep tests

**Dependencies:** Task 2

### Task 17: Kickback ledger at a child path (read, lease, fail-closed corrupt)
**Story:** Story 6 criteria 55 (ledger part), 56 (ledger part), 60
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/kickback-ledger.test.ts`: child read of a valid ledger, lease location, corrupt child ledger fail-closed with warning path, missing child ledger absent, flat behavior unchanged.
2. Verify RED.
3. Implement in `src/conductor/src/engine/kickback-ledger.ts`: `export function kickbackLedgerPathFor(root, child?)` = `pipelinePathFor(root, 'kickback-ledger.json', child)`; `readKickbackLedgerResult(projectRoot, child?)`, `readKickbackLedger(projectRoot, child?)` and `withKickbackLedgerLease(projectRoot, operation, child?)` resolve their path and lease through it (the lease label stays `kickback-ledger`); the warning text keeps today's shape with the resolved path.
4. Verify GREEN. Commit with message: "feat(ledger): per-child kickback ledger read and lease (#2940 task 17)".

**Done when:**
- `kickback-ledger.ts` exports `kickbackLedgerPathFor(root, child?)` built on `pipelinePathFor`, and `readKickbackLedgerResult`, `readKickbackLedger` and `withKickbackLedgerLease` accept an optional trailing `child`; with no child they read, lease and write exactly `.pipeline/kickback-ledger.json` as before, as asserted in `test/engine/kickback-ledger.test.ts`.
- `readKickbackLedger(root, 2)` reads `.pipeline/children/2/kickback-ledger.json` with the same `KickbackLedger` schema and parser, and a write under `withKickbackLedgerLease(root, op, 2)` holds its lease beside that child file and leaves the flat ledger byte-unchanged.
- For a corrupt `.pipeline/children/2/kickback-ledger.json`, `readKickbackLedgerResult(root, 2)` returns `{ kind: 'unreadable', reason: 'kickback ledger is corrupt' }` and `readKickbackLedger(root, 2)` returns a ledger for which `isUnreadableKickbackLedger` is true, never `emptyLedger()`, while its warning names `.pipeline/children/2/kickback-ledger.json`.
- A missing `.pipeline/children/2/kickback-ledger.json` reads as `{ kind: 'absent' }` and no file is created by the read.

**Files:**
- `src/conductor/src/engine/kickback-ledger.ts` — `kickbackLedgerPathFor`, child-aware read/lease
- `src/conductor/test/engine/kickback-ledger.test.ts` — child ledger tests

**Dependencies:** Task 2

### Task 18: Fresh-session ledger clear enumerates child ledgers
**Story:** Story 6 criteria 59, 62
**Type:** happy-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/kickback-ledger.test.ts` for `clearKickbackLedger` with `children/1/` and `children/2/` ledgers plus sibling files, with `children/foo/` and `children/12/` (spy `fs.readFile` via `vi.spyOn` on `node:fs/promises`), and with no `children/`; extend the fresh-session Conductor fixture in `src/conductor/test/engine/conductor-kickback-ledger.test.ts` (the one that stops after fresh-session initialization) with two child ledgers.
2. Verify RED.
3. Implement `clearKickbackLedger(projectRoot)`: today's flat removal under the flat lease, then `for (const child of await listExistingChildren(projectRoot)) await withKickbackLedgerLease(projectRoot, () => rm(kickbackLedgerPathFor(projectRoot, child), { force: true }), child)`. Explicit enumeration only; no recursive `rm` of `children/`. The caller at `conductor.ts` (fresh-session block) is unchanged.
4. Verify GREEN. Commit with message: "feat(ledger): fresh-session clear removes each child ledger by explicit enumeration (#2940 task 18)".

**Done when:**
- `clearKickbackLedger(root)` removes `.pipeline/kickback-ledger.json` as today and then, for each child id returned by `listExistingChildren(root)`, removes `.pipeline/children/<k>/kickback-ledger.json` under that child's ledger lease by explicit path, never by recursive delete, so with `children/1/` and `children/2/` ledgers the flat ledger and both child ledgers are removed and every other file under `children/` (asserted with `children/1/conduct-state.json` and `children/2/gates/build.json`) remains byte-unchanged.
- With `.pipeline/children/foo/kickback-ledger.json` and `.pipeline/children/12/kickback-ledger.json` present, `clearKickbackLedger(root)` leaves both files byte-unchanged and a `vi.spyOn` on `fs.readFile` records no read of either file.
- With no `.pipeline/children/` directory, `clearKickbackLedger(root)` performs exactly today's single flat removal and creates nothing.
- The fresh-session fixture in `test/engine/conductor-kickback-ledger.test.ts` (a Conductor whose state has no `run_started_at`, stopped after fresh-session initialization) asserts that `.pipeline/children/1/kickback-ledger.json` and `.pipeline/children/2/kickback-ledger.json` are removed by the conductor's fresh-session `clearKickbackLedger` call.

**Files:**
- `src/conductor/src/engine/kickback-ledger.ts` — child enumeration in `clearKickbackLedger`
- `src/conductor/test/engine/kickback-ledger.test.ts` — clear tests
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts` — fresh-session child ledgers

**Dependencies:** Task 2, Task 17

### Task 19: Optional `child` event field, absent when no child
**Story:** Story 10 criteria 97, 98; Story 10 Done When (persister absence/presence test; sink registry exhaustiveness unchanged)
**Type:** infrastructure

**Steps:**
1. Add failing tests to `src/conductor/test/engine/event-persister.test.ts`: no-child records for `step_started`, `step_completed`, `operator_rewind` have no `child` own property and the line has no `child` substring; a spread of a persisted no-child record persists without `child`; `{ ...event, child: 2 as ChildId }` persists `"child":2`.
2. Verify RED (type error on `child`).
3. Implement in `src/conductor/src/types/events.ts`: rename the existing union to a non-exported `ConductorEventBody` and `export type ConductorEvent = ConductorEventBody & { child?: ChildId }` with `import type { ChildId } from '../engine/child-context.js'`. No new event type; `EVENT_SINKS` unchanged. Emitters never write `child: undefined`.
4. Verify GREEN and typecheck (`EVENT_SINKS` exhaustiveness). Commit with message: "feat(events): optional child field on ConductorEvent (#2940 task 19)".

**Done when:**
- `src/conductor/src/types/events.ts` exports `ConductorEvent` as the existing union intersected with `{ child?: ChildId }` (`import type { ChildId } from '../engine/child-context.js'`), adds no event type, and `EVENT_SINKS` in `event-sinks.ts` still typechecks against `ConductorEvent['type']` with no new row.
- `test/engine/event-persister.test.ts` asserts that for `step_started`, `step_completed` and `operator_rewind` emitted without a child, the persisted `events.jsonl` line contains no `child` substring and the parsed record has no `child` own property (neither `null` nor an empty value).
- The same test asserts that an event built by spreading a persisted no-child `operator_rewind` record into a new event persists with no `child` own property, and that an event spread with `child: 2` persists a record whose parsed `child` is the number 2.

**Files:**
- `src/conductor/src/types/events.ts` — intersection type
- `src/conductor/test/engine/event-persister.test.ts` — absence/presence tests

**Dependencies:** Task 2

### Task 20: Cost and time rollups ignore the child tag
**Story:** Story 10 criteria 96, 99; Story 10 Done When (rollup test)
**Type:** happy-path

**Steps:**
1. Write tests (they are expected to pass against existing rollup code, because rollups read named fields and ignore unknown keys): `src/conductor/test/engine/cost-rollup.test.ts`, `src/conductor/test/engine/timing-rollup.test.ts`, `src/conductor/test/engine/shipped-record.test.ts` as described in Done when, building tagged and untagged ledgers from the same event list.
2. Run them; if any fails, the defect is in the rollup and must be fixed in that module (add it to Files).
3. Commit with message: "test(rollup): per-feature cost and time totals ignore the child tag (#2940 task 20)".

**Done when:**
- `test/engine/cost-rollup.test.ts` builds one `events.jsonl` with `provider_attempt` and `step_completed` events for steps `build` and `build_review`, half tagged with child 2 and half untagged, and asserts `computeCostRollup` returns `byDimension` and `tokensByDimension` entries per step and total `tokens`, `costUsd` and `dispatches` deep-equal to the rollup of the same ledger with every `child` key removed.
- `test/engine/timing-rollup.test.ts` asserts `computeTimingRollup` over `step_started`/`step_completed` pairs tagged with child 2 and untagged for one feature equals the rollup with the tags removed, field for field.
- `test/engine/shipped-record.test.ts` asserts that for events tagged with children 2 and 3 for step `build_review`, `renderShippedRecordWithCost(fields, rollup)` followed by `appendTimingSection(..., timing)` contains exactly one `## Cost` heading and exactly one `## Time` heading, the `build_review` dimension appears once in `rollup.byDimension` with the summed totals, and the rendered bytes equal those rendered from the untagged ledger.

**Files:**
- `src/conductor/test/engine/cost-rollup.test.ts` — child-tag invariance
- `src/conductor/test/engine/timing-rollup.test.ts` — child-tag invariance
- `src/conductor/test/engine/shipped-record.test.ts` — once-per-feature blocks

**Dependencies:** Task 19

### Task 21: `rewind` argv flag map with `--child`
**Story:** Story 7 criteria 71 (argv parity part), 75
**Type:** negative-path

**Steps:**
1. Follow the operator CLI flag-map pattern (`detectHaltClearCommand`/`detectKickbackBudgetCommand` in `cli.ts`: allowlisted flags read in pairs, repeated flag or missing value returns `null`, `null` falls through to `index.ts`'s `error: unknown command '<name>'`). Add failing tests to `src/conductor/test/engine/rewind.test.ts` for every argv in Done when, and a new `src/conductor/test/cli/rewind.test.ts` running `src/index.ts` through `tsx` (precedent `test/cli/kickback-budget.test.ts` "dispatches a pre-boot refusal through the executable").
2. Verify RED.
3. Implement `detectRewindCommand` in `src/conductor/src/engine/rewind.ts`: `argv[2] === 'rewind'`; pairs from index 3 over the allowlist `['--to', '--child']`; repeated flag, missing value, or unknown token → `null`; `--to` required with a value not starting with `--`; return `{ kind: 'rewind', target, ...(child === undefined ? {} : { child }) }` where `child` is the raw string. `RewindDispatch` gains `child?: string`.
4. Verify GREEN. Commit with message: "feat(rewind): flag-map argv parsing with an optional --child (#2940 task 21)".

**Done when:**
- `detectRewindCommand` parses `argv[3..]` as flag pairs from the allowlist `--to` and `--child`; `['node','conduct','rewind','--to','build']` returns `{ kind: 'rewind', target: 'build' }` with no `child` key, exactly today's object, and `rewind --to build --child 2` returns `{ kind: 'rewind', target: 'build', child: '2' }`, as asserted in `test/engine/rewind.test.ts`.
- `detectRewindCommand` returns `null` for `rewind --to build --child 2 --child 3`, `rewind --to build --child`, `rewind --to build extra`, `rewind --to`, `rewind --to --child 2` and `rewind --child 2`, the same `null` today's five-argument rule returns for every extra or missing argument.
- `test/cli/rewind.test.ts` runs `src/index.ts` through `tsx` with `rewind --to build --child 2 --child 3` and with `rewind --to build --child` in an empty temporary cwd and asserts exit code 1, stderr containing `error: unknown command 'rewind'`, and no `.pipeline` or `.daemon` entry created, matching the executable's output for `rewind --to build extra`.

**Files:**
- `src/conductor/src/engine/rewind.ts` — `detectRewindCommand` flag map
- `src/conductor/test/engine/rewind.test.ts` — detect table
- `src/conductor/test/cli/rewind.test.ts` — executable fallthrough

**Dependencies:** none

### Task 22: `rewind --child` admission checks (child id, child state, region target)
**Story:** Story 7 criteria 72, 73, 74
**Type:** negative-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/rewind-child.test.ts` with a fixture of children 1-3 and a flat state, snapshotting every `.pipeline` file's bytes before each refusal.
2. Verify RED.
3. Implement at the top of `dispatchRewindCommand` when `command.child !== undefined`: `const child = parseChildId(command.child)`; `undefined` → `console.error(\`rewind: invalid child id "${command.child}" (expected 1-9)\`)`, return 1; `!(await childStateExists(cwd, child))` → `console.error(\`rewind: child ${child} has no child state (.pipeline/children/${child}/ does not exist)\`)`, return 1; `!isRegionStep(command.target)` → `console.error('rewind: only acceptance_specs, build, test_suite and build_review can be rewound per child')`, return 1. These run before `readState`, `preflight`, store construction and emitter start. Without `command.child` the function body is unchanged.
4. Verify GREEN. Commit with message: "feat(rewind): --child admission checks before any read or write (#2940 task 22)".

**Done when:**
- `dispatchRewindCommand` with `command.child` present runs `parseChildId` first; for `--child 0`, `--child 10` and `--child two` it prints `rewind: invalid child id "<raw>" (expected 1-9)` naming the raw value, returns 1, and the `.pipeline` tree (every file's bytes, including `events.jsonl` and HALT) is unchanged, as asserted in `test/engine/rewind-child.test.ts`.
- For a valid id whose `.pipeline/children/<k>/` does not exist (`--child 4` beside children 1-3), it prints `rewind: child 4 has no child state (.pipeline/children/4/ does not exist)`, returns 1, and the `.pipeline` tree is unchanged.
- For `rewind --to prd_audit --child 2` with child 2 present, it prints `rewind: only acceptance_specs, build, test_suite and build_review can be rewound per child`, returns 1, and the `.pipeline` tree is unchanged; these three admission checks run before `preflightDerivedRecords`, before any store is constructed and before any event emitter is started.
- Without `command.child`, `dispatchRewindCommand` executes today's code path unchanged: the admission checks are not evaluated and `rewind --to build` on the existing flat fixtures produces the same stdout, state bytes and `operator_rewind` line as before this task.

**Files:**
- `src/conductor/src/engine/rewind.ts` — admission checks
- `src/conductor/test/engine/rewind-child.test.ts` — new child rewind tests

**Dependencies:** Task 2, Task 21

### Task 23: Child rewind demotion set through the mutation port
**Story:** Story 7 criteria 66, 67, 68, 69, 76
**Type:** happy-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/rewind-child.test.ts` using recording stores per path (precedent `RecordingStateStore` in `rewind.test.ts`) and the three-child fixture: children 1, 2, 3 each with `acceptance_specs`, `build`, `test_suite`, `build_review` `done` and `last_step: 'build_review'`; flat file with every step through `coverage_binding` `done`, `manual_test` and `prd_audit` `done`, `last_step: 'prd_audit'`.
2. Verify RED.
3. Implement `rewindChildState({ root, config, target, child, storeFor, readCurrentState })` in `rewind.ts`: read child k's file via `readState(pipelinePathFor(root, 'conduct-state.json', child))` (not-ok → today's `rewind: <message>` refusal); registry via `buildStepRegistry(config)`; refuse when `targetIndex >= indexOf(childState.last_step)` with `` `rewind: target "${target}" must be earlier than child ${k}'s current step "${last_step}"` ``. Demotions: child k — `CHILD_REGION_STEPS` from the target onward with `state[step] !== 'skipped'`, `last_step` → `steps[targetIndex - 1].name`; each `j` in `listExistingChildren(root)` with `j > k` — every region step with `state[step] !== 'skipped'`, `last_step` → `steps[indexOf('acceptance_specs') - 1].name` (`coverage_binding`); flat file — registry steps after `build_review` with `state[step] !== 'skipped'`, `last_step` → the registry step before the first demoted flat step. Submit each file's batch via `storeFor(path).applyBatch({ name: 'operator rewind state', mutations })` with `expected` current values and `intent` `` `operator rewind to ${target} (child ${k})` ``, in the order child k, children above ascending, flat; a `conflict` is reported as today (`Operator rewind refused <field>: expected X, current Y`). Return `{ target, child, demotions: Array<{ child?: ChildId; step: string }>, applied: Array<{ path; originalState; batch }> }` for Task 24's clearing and rollback.
4. Verify GREEN. Commit with message: "feat(rewind): per-child demotion set through the mutation port (#2940 task 23)".

**Done when:**
- `rewindChildState` in `rewind.ts` builds, for `rewind --to build --child 2` over the three-child fixture (children 1, 2, 3 each with every region step `done`, flat `manual_test` and `prd_audit` `done`, `coverage_binding` `done`), the demotion batches: child 2's `build`, `test_suite` and `build_review` to `stale` with `acceptance_specs` untouched; every non-skipped region step of child 3 to `stale`; and every non-skipped registry step after `build_review` in the flat file (`manual_test`, `prd_audit`, `architecture_review_as_built`, `rebase`, `finish`) to `stale`, with `coverage_binding` untouched and child 1's file byte-unchanged, as asserted in `test/engine/rewind-child.test.ts`.
- Each batch is submitted through `ConductStateStore.applyBatch` on the store for that file (`pipelinePathFor(root, 'conduct-state.json', k)` or the flat path) with `expected` set to each field's current value and `intent` `operator rewind to build (child 2)`, in the order child 2, then child 3, then the flat file; no `writeFile` of a conduct-state path occurs outside the port.
- Child 2's batch sets `last_step` to `acceptance_specs` (the registry step before `build`), child 3's batch sets `last_step` to `coverage_binding` (the registry step before `acceptance_specs`), and the flat batch sets `last_step` to `build_review` (the registry step before `manual_test`, the first demoted whole-feature step).
- With `children/2/conduct-state.json` whose `last_step` is `build`, `rewind --to test_suite --child 2` prints a refusal stating the target must be earlier than child 2's current step `build`, returns 1, and the `.pipeline` tree is unchanged.

**Files:**
- `src/conductor/src/engine/rewind.ts` — `rewindChildState`
- `src/conductor/test/engine/rewind-child.test.ts` — demotion set tests

**Dependencies:** Task 22

### Task 24: Child rewind derived-record clearing, HALT, event and rollback
**Story:** Story 7 criteria 70, 77, 78; Story 7 Done When (child record carries `child`, no-child record has no `child` key); Story 10 criterion 95
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/rewind-child.test.ts`: success path (verdict files removed per path, HALT pair cleared, event bytes, stdout); refusal after child 2 applied and before child 3 (an `ApplyingStateStore` for child 2 and a `RefusingStateStore` for child 3); clearing throws after all batches applied.
2. Verify RED.
3. Implement in `rewind.ts`: generalize `clearDerivedRecords(root, demotions: Array<{ child?: ChildId; step: string }>, filesystem)` to stage `verdictPathFor(root, step, child)` for each demotion (as-built pair unchanged for the flat `architecture_review_as_built`), then `clearHaltAtomically`, then delete staged — today's order and rollback; the no-child call passes `demoted.map((step) => ({ step }))`. Generalize rollback: for each applied batch in reverse, run today's `rollbackRewindState` shape against that file's store and original state. In `dispatchRewindCommand`, after a successful clear emit `{ type: 'operator_rewind', operator, target, demoted, ...(child === undefined ? {} : { child }) }` where `demoted` lists `children/<k>/<step>` for child-file entries and `<step>` for flat entries; print `Rewound child ${k} to ${target}.` for a child rewind and today's `Rewound to ${target}.` otherwise.
4. Verify GREEN; verify Task 1's golden rewind rendering is unchanged. Commit with message: "feat(rewind): child-aware verdict clearing, HALT clear, event and rollback (#2940 task 24)".

**Done when:**
- After the batches apply, `clearDerivedRecords` stages and removes the verdict of every demoted step at its own path via `verdictPathFor` (`.pipeline/children/2/gates/build.json`, `test_suite.json` and `build_review.json`, every `.pipeline/children/3/gates/*.json`, and the flat `.pipeline/gates/manual_test.json` and `prd_audit.json`), then clears `.pipeline/HALT` and `.pipeline/HALT.class` through `clearHaltAtomically` exactly as today, leaving child 1's verdicts and `.pipeline/gates/coverage_binding.json` untouched, as asserted in `test/engine/rewind-child.test.ts`.
- On success one `operator_rewind` event is emitted with `target: 'build'`, `child: 2` (present only for a child rewind, via conditional spread) and `demoted` listing every demoted entry as `children/<k>/<step>` for child files and `<step>` for the flat file; the persisted `events.jsonl` record contains the key `child` with the numeric value 2, stdout is `Rewound child 2 to build.`, and a no-child rewind's record has no `child` key and prints `Rewound to build.` as today.
- When a port batch is refused after child 2's batch applied and before child 3's, `dispatchRewindCommand` rolls back child 2 through compensating `applyBatch`/`applyCorrection` mutations (today's `rollbackRewindState` shape per store), prints `rewind: Operator rewind refused <field>: expected <expected>, current <current>`, returns 1, and child 2's and the flat `conduct-state.json` bytes equal their pre-rewind bytes while every verdict file and `.pipeline/HALT` are untouched.
- When verdict clearing throws after every batch applied, the command rolls back child 2, child 3 and the flat file to their pre-rewind bytes in reverse order, restores every staged verdict, leaves `.pipeline/HALT` and `.pipeline/HALT.class` in place, and returns 1.

**Files:**
- `src/conductor/src/engine/rewind.ts` — clearing, event, rollback for child rewinds
- `src/conductor/test/engine/rewind-child.test.ts` — clearing, event and rollback tests

**Dependencies:** Task 23, Task 16, Task 19

### Task 25: `task` CLI parses `--child <k>` once and preserves today's argv tolerance
**Story:** Story 8 criteria 82, 86, 87 (parse half)
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/task-cli.test.ts` for `detectTaskCommand` over every argv in Done when, plus `dispatchTaskCommand` byte parity for `task start 7 --foo bar` versus `task start 7` and exit 2 for the guide cases.
2. Verify RED.
3. Implement in `src/conductor/src/engine/task-cli.ts`: `TaskDispatch` `start` and `done` gain `child?: string`. For `start`, scan `argv[5..]` for `--child`: a value present and no second `--child` → `child`; a missing value or a repeat → `{ kind: 'guide' }`; every other extra argument is ignored as today. For `done`, the existing flag loop gains a `--child` branch with the same rules (missing value already returns guide; a repeat returns guide). Return the raw string; no key when absent.
4. Verify GREEN. Commit with message: "feat(task-cli): parse --child <k> once for start and done (#2940 task 25)".

**Done when:**
- `detectTaskCommand` accepts `--child <k>` once for both verbs: `task start 7 --child 2` returns `{ kind: 'start', id: '7', child: '2' }` and `task done 7 --child 2 --done-when 1=ok` returns `{ kind: 'done', id: '7', child: '2', doneWhen: [{ index: 1, evidence: 'ok' }] }`, while `task start 7` and `task done 7` return exactly today's objects with no `child` key, as asserted in `test/engine/task-cli.test.ts`.
- `task start 7 --foo bar` still returns `{ kind: 'start', id: '7' }` (extra non-`--child` arguments ignored as today), and `dispatchTaskCommand` for it writes `task-status.json` and `current-task` bytes identical to `task start 7`.
- `task start 7 --child 2 --child 2`, `task start 7 --child`, `task done 7 --child 2 --child 2` and `task done 7 --child` each return `{ kind: 'guide' }`, so `dispatchTaskCommand` prints today's task guidance to stderr, returns 2, and `.pipeline/current-task` and `task-status.json` are unchanged.
- With an injected clock, `dispatchTaskCommand` for `task start 7`, `task start 7 --foo bar`, `task done 7` and `task done 7 --done-when 1=ok`, all without `--child`, produces stdout, stderr, exit code and `task-status.json` and `current-task` bytes byte-identical to fixtures recorded from the pre-change base commit in `test/engine/task-cli.test.ts`.

**Files:**
- `src/conductor/src/engine/task-cli.ts` — `--child` parsing
- `src/conductor/test/engine/task-cli.test.ts` — detect and guide tests

**Dependencies:** none

### Task 26: `task --child` validates slice membership against the envelope
**Story:** Story 8 criteria 79, 80, 81, 83, 84, 85, 87 (unchanged-stamp half); Story 8 Done When
**Type:** happy-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/task-cli.test.ts` with a `.pipeline/coverage-binding.json` envelope (version 1, `sliceMembership.taskSlices` `{ "3": 1, "7": 2 }`, titles) written via `writeCoverageBindingEnvelope`, `.pipeline/children/2/` present or absent, and byte comparisons of every `.pipeline/` file against the no-`--child` run.
2. Verify RED.
3. Implement in `dispatchTaskCommand` before `runTaskStart`/`runTaskDone` when `cmd.child !== undefined`: `parseChildId` failure → `[task-cli] invalid child id "<raw>" (expected 1-9)`, return 1; `!childStateExists(cwd, k)` → `[task-cli] child <k> has no child state (.pipeline/children/<k>/ does not exist)`, return 1; `readCoverageBindingEnvelope(cwd, fs)` (export the adapter from `coverage-binding-void.ts` or build an identical `node:fs/promises` adapter) null or without `sliceMembership` → `[task-cli] no slice membership is recorded for the feature (coverage-binding envelope missing)`, return 1; `isEngineAppendedRemediationTaskId(id)` → accepted; `taskSlices[id] === undefined` → `[task-cli] task <id> has no recorded slice membership`, return 1; `taskSlices[id] !== k` → `[task-cli] task <id> belongs to child <p>, not child <k>`, return 1; otherwise fall through to today's `runTaskStart(cwd, id)` / `runTaskDone(...)` unchanged. `current-task` stays flat.
4. Verify GREEN. Commit with message: "feat(task-cli): --child validates task membership through the coverage-binding envelope (#2940 task 26)".

**Done when:**
- `dispatchTaskCommand` with `cmd.child` present validates before any write: `parseChildId` failure prints `[task-cli] invalid child id "<raw>" (expected 1-9)` and returns 1; a missing `.pipeline/children/<k>/` prints `[task-cli] child 2 has no child state (.pipeline/children/2/ does not exist)` and returns 1; in both cases `task-status.json` and `.pipeline/current-task` are byte-unchanged, as asserted in `test/engine/task-cli.test.ts`.
- With `.pipeline/children/2/` present and no `.pipeline/coverage-binding.json` (or an envelope without `sliceMembership`), `task start 7 --child 2` prints `[task-cli] no slice membership is recorded for the feature (coverage-binding envelope missing)`, returns 1, and `task-status.json` and `.pipeline/current-task` are byte-unchanged.
- With an envelope whose `sliceMembership.taskSlices` maps `3` to 1 and `7` to 2, `task start 3 --child 2` prints `[task-cli] task 3 belongs to child 1, not child 2`, returns 1 and leaves `.pipeline/current-task` unchanged, while `task start 7 --child 2` and `task start rem-fr10-1 --child 2` (an `isEngineAppendedRemediationTaskId` id absent from `taskSlices`) are accepted and then run `runTaskStart` unchanged, writing `.pipeline/current-task` at its flat path with bytes identical to `task start 7` and `task start rem-fr10-1`.
- `task done 7 --child 2 --done-when 1=ok` with that envelope runs `runTaskDone` unchanged and leaves every file under `.pipeline/` byte-identical to the result of `task done 7 --done-when 1=ok`; the envelope is read through `readCoverageBindingEnvelope` with the same filesystem adapter shape `coverage-binding-void.ts` uses.

**Files:**
- `src/conductor/src/engine/task-cli.ts` — membership validation
- `src/conductor/test/engine/task-cli.test.ts` — membership tests

**Dependencies:** Task 2, Task 25

### Task 27: `kickback-budget` detect accepts `--child` on `inspect` only
**Story:** Story 9 criteria 90 (parse half), 91, 94
**Type:** negative-path

**Steps:**
1. Follow the flag-map pattern already in `detectKickbackBudgetCommand`. Add failing tests to `src/conductor/test/cli/kickback-budget.test.ts` for every argv in Done when, including an executable run (`src/index.ts` through `tsx`, precedent in the same file) for `raise ... --child 2` asserting `error: unknown command 'kickback-budget'`, exit 1 and unchanged ledger bytes.
2. Verify RED.
3. Implement in `src/conductor/src/cli.ts`: add `--child` to the allowlist; `KickbackBudgetDispatch` gains `child?: string`; for `inspect`, `values.size <= (values.has('--child') ? 3 : 2) && !values.has('--gate')` and the returned object carries `child` only when given; for `raise` and `reset`, `values.has('--child')` → `null`. The existing `values.has(flag)` repeat check already returns `null` for a duplicate `--child`.
4. Verify GREEN. Commit with message: "feat(cli): kickback-budget inspect accepts --child; raise and reset fall through (#2940 task 27)".

**Done when:**
- `detectKickbackBudgetCommand` adds `--child` to its flag allowlist and returns `{ kind: 'kickback-budget', action: 'inspect', feature: 'f', format: 'human', child: '2' }` for `kickback-budget inspect --feature f --child 2` (the inspect bound becomes `values.size <= 3` only when `--child` is present), while every argv accepted today returns exactly today's object with no `child` key, as asserted in `test/cli/kickback-budget.test.ts`.
- `kickback-budget raise --feature f --gate build_review --by 1 --rationale r --child 2` and `kickback-budget reset --feature f --gate build_review --rationale r --child 2` return `null`, the same `null` an unrecognized flag returns today, so `dispatchKickbackBudgetCommand` is never reached and no ledger is read or changed (asserted by running `src/index.ts` through `tsx` and checking exit 1 with `error: unknown command 'kickback-budget'` and unchanged ledger bytes).
- `kickback-budget inspect --feature f --child 2 --child 2` returns `null`, the same `null` a repeated `--feature` returns today.

**Files:**
- `src/conductor/src/cli.ts` — `--child` in `detectKickbackBudgetCommand`
- `src/conductor/test/cli/kickback-budget.test.ts` — detect and fallthrough tests

**Dependencies:** none

### Task 28: `kickback-budget inspect --child` renders the child ledger
**Story:** Story 9 criteria 88, 89, 90 (dispatch half), 92, 93; Story 9 Done When
**Type:** happy-path

**Steps:**
1. Add failing tests to `src/conductor/test/cli/kickback-budget.test.ts` with fixtures `makeFeature` extended by `.pipeline/children/2/kickback-ledger.json` (valid and corrupt) and with no `children/3/`; capture `print` output for human and json; compare no-`--child` output bytes with the pre-change output.
2. Verify RED.
3. Implement in `src/conductor/src/engine/kickback-budget-cli.ts` `inspect`: when `command.child !== undefined`, `parseChildId` failure → `print(\`kickback-budget: invalid child id "${command.child}".\`)`, return 1; `!childStateExists(worktree, k)` → `print(\`kickback-budget: child ${k} has no child state.\`)`, return 1, both before `reconcile()`; then `readKickbackLedger(worktree, k)` in place of the flat read (flat `reconcilePendingAdjustments` unchanged); human output prefixes `Child: ${k}` and a blank line once before the blocks; json output is `{ feature, child: k, gates, ...unavailableGates }`. Without `command.child` the branch is untouched.
4. Verify GREEN; verify Task 1's golden inspect renderings are unchanged. Commit with message: "feat(kickback-budget): inspect --child reads and renders the child ledger (#2940 task 28)".

**Done when:**
- `dispatchKickbackBudgetCommand` for `inspect` with `command.child` runs `parseChildId` (failure prints `kickback-budget: invalid child id "<raw>".` and returns 1) and then `childStateExists`; with no `.pipeline/children/3/`, `inspect --feature f --child 3` prints `kickback-budget: child 3 has no child state.` and returns 1 before any ledger read, as asserted in `test/cli/kickback-budget.test.ts`.
- With `.pipeline/children/2/kickback-ledger.json` holding a `build_review` entry, `inspect --feature f --child 2` reads that ledger through `readKickbackLedger(worktree, 2)` and the human output begins with the line `Child: 2`, which occurs exactly once, immediately above the `Kickback budget (build_review)` block.
- `inspect --feature f --child 2 --format json` prints a JSON object whose parsed `child` equals the number 2 beside today's `feature` and `gates` fields, while an inspect without `--child` prints JSON with no `child` key and human output with no `Child:` line, byte-identical to before this task.
- With a corrupt `.pipeline/children/2/kickback-ledger.json`, `inspect --feature f --child 2` prints `kickback-budget: ledger is unreadable.` and returns 1.
- `dispatchKickbackBudgetCommand` for `raise` and for `reset` without `--child` produces stdout, exit code and `kickback-ledger.json` bytes byte-identical to fixtures recorded from the pre-change base commit in `test/cli/kickback-budget.test.ts`.

**Files:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — child inspect
- `src/conductor/test/cli/kickback-budget.test.ts` — child inspect tests

**Dependencies:** Task 2, Task 17, Task 27

### Task 29: Identity drift test allowlists the migrated consumers
**Story:** Story 2 Done When (drift test fails if any migrated consumer tests branch literals itself); architecture-review condition 3
**Type:** infrastructure

**Steps:**
1. Write `src/conductor/test/engine/feature-branch-identity-drift.test.ts` (precedent: `productionSources()` in `plan-slices-consumer-boundary.test.ts`, which reads every `.ts` under `src/conductor/src/`). Strip `//` line comments and `/* */` block comments before scanning.
2. Assert (a) the set of files containing `feat/daemon-` is exactly `[engine/feature-branch-identity.ts]`; (b) none of `engine/finish-record-cli.ts`, `engine/halt-pr-reconciliation.ts`, `engine/daemon-halt-pr-operations.ts`, `engine/github-operations-cli.ts`, `engine/engineer/intake/overlap-sources.ts`, `engine/park-reconciliation.ts` contains `spec/` or `feature/`; (c) `engine/daemon-deps.ts`, `engine/mergeable-sweep.ts` and `daemon-cli.ts` each contain `leafBranchFor(`; (d) a negative self-test: the scan function applied to an in-memory copy of `park-reconciliation.ts` with `branch.startsWith('feat/daemon-')` reinserted reports that file.
3. Verify the test passes against the migrated tree (RED is demonstrated by the self-test). Commit with message: "test(identity): drift test pins branch-literal ownership to the identity module (#2940 task 29)".

**Done when:**
- `test/engine/feature-branch-identity-drift.test.ts` strips comments from every production source under `src/conductor/src/` and asserts the set of files containing `feat/daemon-` is exactly `engine/feature-branch-identity.ts`.
- The same test asserts that none of the migrated consumers (`engine/finish-record-cli.ts`, `engine/halt-pr-reconciliation.ts`, `engine/daemon-halt-pr-operations.ts`, `engine/github-operations-cli.ts`, `engine/engineer/intake/overlap-sources.ts`, `engine/park-reconciliation.ts`) contains `spec/` or `feature/` outside comments, and that `engine/daemon-deps.ts`, `engine/mergeable-sweep.ts` and `daemon-cli.ts` each contain `leafBranchFor(`.
- The scan function reports `engine/park-reconciliation.ts` when applied to an in-memory copy of that file with `branch.startsWith('feat/daemon-')` reinserted, proving the test can fail.
- The same test asserts that `parseFeatureRef` is imported by exactly one production module, `engine/engineer/intake/overlap-sources.ts`, so prefix stripping is used only by the enumeration consumer.

**Files:**
- `src/conductor/test/engine/feature-branch-identity-drift.test.ts` — new drift test

**Dependencies:** Task 5, Task 6, Task 7, Task 9, Task 10, Task 12, Task 14

## Task Dependency Graph

```
1 (golden, no production diff) ──────────────────────────────────────────── independent
2 (child-context) ─┬─> 3 (identity parser) ─┬─> 4 (ref parser, globs, predicate) ─┬─> 11 ─> 12
                   │                        ├─> 5 (finish-record)                 ├─> 13 ─> 14
                   │                        ├─> 6 (halt-PR reconciliation)        │
                   │                        ├─> 7 (daemon halt-PR ops) ─> 8 ─> 9  │
                   │                        └─> 10 (leaf template sites)          │
                   ├─> 15 (conduct-state at child path)                           │
                   ├─> 16 (gate verdicts) ─────────────────────┐                  │
                   ├─> 17 (kickback ledger) ─┬─> 18 (clear)    │                  │
                   │                         └────────────┐    │                  │
                   ├─> 19 (event field) ─> 20 (rollups)   │    │                  │
                   │        │                             │    │                  │
21 (rewind detect) ┴─> 22 ─> 23 ─> 24 <── 16, 19          │    │                  │
25 (task detect) ──> 26 <── 2                             │    │                  │
27 (kickback detect) ─> 28 <── 2, 17 ─────────────────────┘    │                  │
29 (drift test) <── 5, 6, 7, 9, 10, 12, 14 ────────────────────┴──────────────────┘
```

Ready frontier at start: Tasks 1, 2, 21, 25, 27. After Task 2: 3, 15, 16, 17, 19, 22 (with 21), 26 (with 25). After Task 3: 4, 5, 6, 7, 10.

## Integration Points

- After Task 1: the N=1 byte-identity contract is pinned; every later task is checked against it.
- After Tasks 5–10: every branch consumer resolves identity through one module; `conduct finish-record`, the daemon halt-PR sweep, `ai-conductor github-operation` and the daemon worktree/teardown/probe paths can be exercised end-to-end with a child branch present.
- After Tasks 11–14: intake overlap (`overlap-scan`, intake) and the daemon park sweep attribute children to their feature and never delete one.
- After Tasks 15–18: per-child region stores exist under `.pipeline/children/<k>/` with the flat enumerations and fresh-session clear proven; no production writer creates a child yet.
- After Tasks 19–20: a child-tagged event persists with `"child":k` and no-child events are unchanged; rollups are once per feature.
- After Task 24: `conduct rewind --to <step> --child k` is reachable from `src/conductor/src/index.ts` dispatch and demotes, clears and emits with rollback.
- After Task 26: `conduct task start|done <id> --child k` validates membership through the envelope and otherwise behaves as today.
- After Task 28: `ai-conductor kickback-budget inspect --feature <slug> --child k` renders the child ledger.
- After Task 29: ownership of branch literals is pinned by a drift test.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given golden fixture files recorded from the commit before this change, when the golden suite runs a feature with `stacked_prs.enabled` false through its state-producing entry points, then the bytes of these outputs equal the fixtures after normalizing only timestamps and the fixture root path, and with interval-timing fields left out of the comparison: `conduct-state.json`, `task-status.json`, `current-task`, the set of gate verdict file paths and each verdict file, `events.jsonl`, and `kickback-ledger.json` | 1 | "the bytes of `conduct-state.json`, `task-status.json`, `current-task`, the sorted set of gate verdict file paths and each verdict file, `events.jsonl`, and `kickback-ledger.json` equal the committed fixtures" | diff-local |
| Story 1 happy: Given the same fixtures, when the golden suite runs with `stacked_prs.enabled` true and an unsliced plan, then every output listed in the first criterion equals the same fixtures | 1 | "flag on with an unsliced plan" | diff-local |
| Story 1 happy: Given the same fixtures, when the golden suite runs with `stacked_prs.enabled` false and a plan declaring three slices, then every output listed in the first criterion equals the same fixtures and no `.pipeline/children/` directory exists afterwards | 1 | "asserts no `.pipeline/children/` directory exists" | diff-local |
| Story 1 happy: Given each of the three configurations, when the golden suite renders `rewind --to <step>` output and its `operator_rewind` record, `kickback-budget inspect` output, `daemon status` lines, the dashboard view, the PR body and the shipped-record Cost block, then each rendering equals its fixture | 1 | "asserts each rendering equals its fixture under the same normalization" | diff-local |
| Story 1 negative: Given a change that alters any non-normalized byte of a golden-covered output (for example a reordered key in `conduct-state.json`), when the golden suite runs, then it fails and names the output file and the first differing line | 1 | "fails naming the output file or rendering and the first differing line" | diff-local |
| Story 1 negative: Given a change that adds a `"child"` key to any event when no child is present, when the golden suite runs, then the `events.jsonl` comparison fails | 1 | "so an added child key fails the `events.jsonl` comparison" | diff-local |
| Story 1 negative: Given a change that creates any entry under `.pipeline/children/` for a feature with no child, when the golden suite runs, then it fails naming the created path | 1 | "failing with a message naming the created path" | diff-local |
| Story 1 negative: Given a change that renders a `daemon status` line, the dashboard, the PR body or the Cost block differently, when the golden suite runs, then it fails naming the rendering and the first differing line | 1 | "fails naming the output file or rendering and the first differing line" | diff-local |
| Story 2 happy: Given `feat/daemon-x`, when the branch identity is resolved, then it is the leaf of feature `x` | 3 | "returns leaf of `x` for `feat/daemon-x`" | diff-local |
| Story 2 happy: Given `feat/c2/x`, when the branch identity is resolved, then it is child 2 of feature `x` | 3 | "child 2 of `x` for `feat/c2/x`" | diff-local |
| Story 2 happy: Given `feat/c9/engine-cannot-represent-more-than-one-branch-step-` (a slug ending in a hyphen), when the branch identity is resolved, then it is child 9 of that exact slug | 3 | "child 9 of `engine-cannot-represent-more-than-one-branch-step-` for `feat/c9/engine-cannot-represent-more-than-one-branch-step-`" | diff-local |
| Story 2 happy: Given `feat/daemon-c1`, when the branch identity is resolved, then it is the leaf of feature `c1`, not a child | 3 | "leaf of `c1` for `feat/daemon-c1`" | diff-local |
| Story 2 happy: Given `spec/x` and `feature/x`, when each branch identity is resolved, then they are the spec branch and the interactive branch of feature `x` | 3 | "spec of `x` for `spec/x` and interactive of `x` for `feature/x`" | diff-local |
| Story 2 happy: Given slug `x` and child id 3, when the child branch name is constructed, then it is `feat/c3/x` | 3 | "`childBranchFor('x', 3)` returns `{ ok: true, branch: 'feat/c3/x' }`" | diff-local |
| Story 2 happy: Given slug `x`, when the leaf branch name is constructed, then it is `feat/daemon-x` | 3 | "`leafBranchFor(slug)` returns `feat/daemon-` immediately followed by the slug unchanged, with no validation, for `x`" | diff-local |
| Story 2 happy: Given `refs/heads/feat/c1/x` and `origin/feat/c1/x` listed by the intake-overlap enumeration, when each branch identity is resolved there, then both are child 1 of feature `x` | 4, 11 | "both resolve through `parseFeatureRef` to child 1 of `x`" | diff-local |
| Story 2 negative: Given `feat/c0/x`, `feat/c10/x`, `feat/c01/x` or `feat/cool/x`, when the branch identity is resolved, then it is unrecognized, with a reason naming an invalid child id | 3 | "a reason naming an invalid child id for `feat/c0/x`, `feat/c10/x`, `feat/c01/x`" | diff-local |
| Story 2 negative: Given `feat/c1`, `feat/c1/` or `feat/c1/a/b`, when the branch identity is resolved, then it is unrecognized, with a reason naming a missing or multi-segment slug | 3 | "a reason naming a missing slug for `feat/c1` and `feat/c1/` and a multi-segment slug for `feat/c1/a/b`" | diff-local |
| Story 2 negative: Given `feat/daemon-`, when the branch identity is resolved, then it is unrecognized with an empty-slug reason | 3 | "an empty-slug reason for `feat/daemon-`" | diff-local |
| Story 2 negative: Given `refs/heads/feat/c1/x` or `origin/feat/c1/x` passed where a short branch name is expected, such as the current-branch check, when the branch identity is resolved, then it is unrecognized | 3 | "`unrecognized` for `refs/heads/feat/c1/x`, `origin/feat/c1/x` and `main`" | diff-local |
| Story 2 negative: Given slug `x` and child id 0 or 10, when a child branch name is constructed, then construction is refused naming the invalid child id and no name is returned | 3 | "a reason naming the invalid child id and no `branch` property" | diff-local |
| Story 2 negative: Given slug `a/b` or an empty slug, when a child branch name is constructed, then construction is refused naming the invalid slug and no name is returned | 3 | "a reason naming the invalid slug and no `branch` property" | diff-local |
| Story 2 negative: Given a slug containing `/` or ending in a hyphen, when the leaf branch name is constructed, then it equals `feat/daemon-` followed by that slug unchanged, exactly as today's template produces | 3 | "returns `feat/daemon-` immediately followed by the slug unchanged, with no validation, for `x`, `a/b` and `trailing-`" | diff-local |
| Story 3 happy: Given `conduct-state.json` whose `worktree_branch` is `spec/x`, `feature/x` or `feat/daemon-x`, when `finish-record --choice pr` runs, then it derives feature `x` and writes the same records as before | 5 | "passes slug `x` to `evaluateShipmentEvidence` and writes the same `pr_url` mutation, `finish-choice` marker and `DONE` bytes as the pre-migration code" | diff-local |
| Story 3 happy: Given an open PR whose head is `feat/daemon-x`, when the halt-PR reconciliation sweep and the daemon halt-PR operations run, then they act on feature `x`, probing exactly the refs they probe today | 6, 7 | "the injected `runGit` records exactly `cat-file -e feat/daemon-x:.docs/shipped/x.md` and then `cat-file -e origin/feat/daemon-x:.docs/shipped/x.md`" | diff-local |
| Story 3 happy: Given current branch `feat/daemon-x` or `spec/x`, when a feature-scoped GitHub operation runs, then it resolves feature `x` and reaches the same owner check as today | 8 | "the operation reaches the unchanged committed-owner check: `resolveMachineOwner` is invoked and the provenance carries `featureMarker` `.docs/intake/x.md`, as today" | diff-local |
| Story 3 happy: Given worktree creation, teardown, the shipped-record probe and CI-fix for feature `x`, when each runs, then each uses `feat/daemon-x`, identical to today's string | 10 | "the returned branch equals `feat/daemon-x`, `feat/daemon-a/b` and `feat/daemon-trailing-`" | diff-local |
| Story 3 negative: Given `conduct-state.json` whose `worktree_branch` is `feat/daemon-`, `spec/`, `feature/` or `main`, when `finish-record --choice pr` runs, then it refuses with today's message, exits 1 and writes nothing | 5 | "the table asserts exit 1 with today's stderr message naming the branch" | diff-local |
| Story 3 negative: Given current branch `feature/x` and a GitHub operation whose context names feature `x`, when the operation runs, then it is refused `invalid-target` exactly as today | 8 | "a request whose `context.feature` is `x` from branch `feature/x`, `feat/daemon-` or `spec/` is refused `invalid-target`" | diff-local |
| Story 3 negative: Given current branch `feat/daemon-` and a GitHub operation whose context names feature `x`, when the operation runs, then it is refused `invalid-target` exactly as today | 8 | "from branch `feature/x`, `feat/daemon-` or `spec/` is refused `invalid-target` with zero `gh` and `remoteGit` calls" | diff-local |
| Story 3 negative: Given an open PR whose head is `feat/daemon-a/b`, when the halt-PR consumers resolve it, then they resolve slug `a/b` exactly as today | 6, 7 | "for head `feat/daemon-a/b` it records `cat-file -e feat/daemon-a/b:.docs/shipped/a/b.md`" | diff-local |
| Story 3 negative: Given an open PR whose head is `main` or `hotfix/y`, when the halt-PR reconciliation sweep and the daemon halt-PR operations run, then they take no action on it, exactly as today | 6, 7 | "records no `cat-file` probe and performs no clear for that PR" | diff-local |
| Story 3 negative: Given feature slug `a/b` or a slug ending in a hyphen, when teardown, worktree creation, the shipped-record probe or CI-fix builds the leaf branch name, then the name equals today's `feat/daemon-` template output for that slug | 10 | "the returned branch equals `feat/daemon-x`, `feat/daemon-a/b` and `feat/daemon-trailing-`" | diff-local |
| Story 4 happy: Given an open PR whose head is `feat/c1/x`, when the halt-PR reconciliation sweep runs, then it attributes the PR to feature `x` and looks for `.docs/shipped/x.md` on `feat/daemon-x` and `origin/feat/daemon-x` | 6 | "probes `feat/daemon-x:.docs/shipped/x.md` then `origin/feat/daemon-x:.docs/shipped/x.md`" | diff-local |
| Story 4 happy: Given an unmerged branch `feat/c2/x` alongside `feat/daemon-x`, when intake overlap enumerates in-flight work, then both rows name feature `x` and no row names `c2` or `x-c2` as a feature | 12 | "both rows resolve feature `x`: `traceBranchIssue` reads `<branch>:.docs/intake/x.md` for each, `isShippedBranch` probes `<base>:.docs/shipped/x.md` for each, and no probe names `c2.md` or `x-c2.md`" | diff-local |
| Story 4 happy: Given a parked feature whose worktree lists branch `feat/c1/x`, when the park sweep classifies the candidate, then it is attributed to feature `x` as a daemon-owned branch, never as a non-daemon branch that is reclaimable on its deletion proofs alone | 13 | "treats a `feat/c1/x` worktree as record-gated, never as a non-daemon branch reclaimable on its deletion proofs alone" | diff-local |
| Story 4 happy: Given an open PR whose head is `feat/c1/x` and an existing `feat/daemon-x`, when the daemon halt-PR operations run, then they act for feature `x` | 7 | "returns a runner for feature `x` (`featureMarker` `.docs/intake/x.md`, `specBranch` `feat/c1/x`)" | diff-local |
| Story 4 negative: Given `conduct-state.json` whose `worktree_branch` is `feat/c1/x`, when `finish-record --choice pr` runs, then it refuses with a message naming the child branch form and stating that only the leaf records a ship. It exits 1 and writes no `pr_url`, no finish choice and no shipped record | 5 | "exits 1 with a stderr message containing `feat/c<k>/<slug>`, `only the leaf` and `records a ship`" | diff-local |
| Story 4 negative: Given a parked feature whose worktree lists branch `feat/c1/x`, when the park sweep runs, then the candidate is refused with a refusal reason reserved for child branches before the shipped-record precondition is evaluated, it is counted as refused in the sweep summary and emitted as a `worktree_reclaim_failed` event naming feature `x` and branch `feat/c1/x`, and neither the worktree nor `feat/c1/x` is removed | 13 | "counts that outcome in `counts.refused` and `refusedByReason['child-branch']`, and emits `{ type: 'worktree_reclaim_failed', slug: 'x', branch: 'feat/c1/x', refusal: 'child-branch' }`, while `.worktrees/x` and branch `feat/c1/x` remain" | diff-local |
| Story 4 negative: Given a parked feature listing `feat/c1/x`, a merged PR whose head is `feat/c1/x`, and no `.docs/shipped/x.md` on `origin/main`, when the park sweep runs, then no shipped-record repair is requested, and no merged-PR lookup uses a `feat/c1/` head | 13, 14 | "`requestRecordRepair` is never called and no `gh pr list --head` argv names `feat/c1/x`" | diff-local |
| Story 4 negative: Given a parked feature with no listed branch while both `feat/daemon-x` and `feat/c1/x` exist, when the park sweep runs, then no `git branch -d` runs for `feat/c1/x` and `feat/daemon-x` is handled exactly as it is today | 14 | "runs no `git branch -d feat/c1/x`, and its `git branch -d feat/daemon-x`, record precondition, proofs and refusal taxonomy for `feat/daemon-x` are deep-equal to the same fixture without the child branch" | diff-local |
| Story 4 negative: Given an open PR whose head is `feat/c1/x` while `feat/daemon-x` does not exist, when the daemon halt-PR operations run, then they take no action for that PR | 7 | "`run` resolves to `{ kind: 'refused', reason: 'invalid-target' }` without invoking `gh`" | diff-local |
| Story 4 negative: Given a leaf-existence check that fails with a git error, when the daemon halt-PR operations evaluate a child PR, then they take no action for that PR and continue with the next PR | 7 | "`run` resolves to the same refusal without invoking `gh`; a `reconcileHaltPrs` fixture listing that child PR before a `feat/daemon-y` PR asserts the `feat/daemon-y` PR is still healed" | diff-local |
| Story 4 negative: Given hand-made branches `feat/cool/x` and `feat/c1-x/baz`, when intake overlap enumerates, then neither appears in the report | 11 | "`selectInFlightBranches` returns neither" | diff-local |
| Story 4 negative: Given `feat/c1/x` while `.docs/shipped/x.md` is on the default branch, when intake overlap enumerates, then the child row is excluded exactly as a shipped `feat/daemon-x` row is excluded today | 12 | "`selectInFlightBranches` excludes `feat/c1/x` exactly as it excludes `feat/daemon-x`" | diff-local |
| Story 4 negative: Given branches `feat/c1/a/b` and `feat/c1/` returned by the child ref patterns, when intake overlap enumerates, then neither appears in the report, no further git command runs for either, and no skip note is written | 11 | "the injected `git` records no git command of any kind (including `rev-list`, `cat-file` and `log`) naming either after the `for-each-ref` call" | diff-local |
| Story 5 happy: Given current branch `feat/c1/x`, an existing local `feat/daemon-x`, and an operation whose context names feature `x`, when the operation runs, then it proceeds to the unchanged committed-owner check for feature `x` | 8 | "when `leafRefExists` finds `refs/heads/feat/daemon-x` locally, or finds only `refs/remotes/origin/feat/daemon-x`, the operation resolves slug `x` and proceeds to the same committed-owner check with `featureMarker` `.docs/intake/x.md`" | diff-local |
| Story 5 happy: Given current branch `feat/c1/x` and a `feat/daemon-x` that exists only on `origin`, when the operation runs for feature `x`, then it proceeds to the same owner check | 8 | "or finds only `refs/remotes/origin/feat/daemon-x`, the operation resolves slug `x` and proceeds to the same committed-owner check" | diff-local |
| Story 5 happy: Given an authorized operation from `feat/c1/x`, when it pushes or binds a PR, then the push target is `feat/c1/x` itself and the PR is the one whose head is `feat/c1/x` | 9 | "the remote-ref target is `refs/heads/feat/c1/x`, the PR binding read is `gh pr view feat/c1/x`" | diff-local |
| Story 5 negative: Given current branch `feat/c1/x` and no `feat/daemon-x` locally or on `origin`, when an operation for feature `x` runs, then it is refused `invalid-target` before any git or GitHub write | 9 | "returns `{ kind: 'refused', reason: 'invalid-target' }` before any write: the injected `git` records only `branch --show-current` and the two `show-ref` probes, and the injected `gh` and `remoteGit` record zero calls" | diff-local |
| Story 5 negative: Given current branch `feat/c1/x` and an operation whose context names feature `y`, when it runs, then it is refused `invalid-target` before any write | 9 | "From branch `feat/c1/x` with `context.feature` `y`, the result is `{ kind: 'refused', reason: 'invalid-target' }` with zero `gh` and `remoteGit` calls and no git write" | diff-local |
| Story 5 negative: Given current branch `feat/c1/x` whose feature `x` has a committed owner other than the machine's operator, when the operation runs, then it is refused by the owner check exactly as it would be from `feat/daemon-x` | 9 | "the result is `{ kind: 'refused', reason: 'other-owner' }`, deep-equal to the result the same fixture yields from branch `feat/daemon-x`" | diff-local |
| Story 5 negative: Given a leaf-existence check that fails with a git error, when an operation from `feat/c1/x` runs, then it is refused `invalid-target` and nothing is written | 9 | "when the leaf probe `git` call throws, the result is `{ kind: 'refused', reason: 'invalid-target' }` with zero `gh` and `remoteGit` calls and no git write" | diff-local |
| Story 5 negative: Given an authorized push from `feat/c1/x`, when the push runs, then no ref other than `feat/c1/x` is updated, and in particular `feat/daemon-x` is untouched | 9 | "the recorded `remoteGit` push argv contains `HEAD:refs/heads/feat/c1/x` while no recorded `git`, `gh` or `remoteGit` argv contains `feat/daemon-x` as a destination" | diff-local |
| Story 6 happy: Given no child, when step status, a gate verdict or the kickback ledger is read or written, then the path is today's `.pipeline/` path | 2, 16, 17 | "returns today's `.pipeline/<relative>` path" | diff-local |
| Story 6 happy: Given child 2, when its step status, a region gate verdict or its kickback ledger is read or written, then the path is under `.pipeline/children/2/` with the same file name and schema as the flat file, and child 2's step-status file records region step statuses and a `last_step` | 2, 15, 16, 17 | "recording region step statuses and a `last_step`" | diff-local |
| Story 6 happy: Given child 2 and child 3 each with a `build_review` verdict, when child 2's verdict is rewritten, then child 3's verdict file and the flat `gates/build_review.json` are byte-unchanged | 16 | "rewriting it leaves `.pipeline/children/3/gates/build_review.json` and `.pipeline/gates/build_review.json` byte-unchanged" | diff-local |
| Story 6 happy: Given a worktree containing `.pipeline/children/2/`, when the engine lists all gate verdicts or probes test-suite evidence, then entries under `children/` are not included and the result matches the result without that directory | 16 | "return results deep-equal with and without a populated `.pipeline/children/2/` directory, including no entry for any file under `children/`" | diff-local |
| Story 6 happy: Given a fresh session starting in a worktree with `children/1/kickback-ledger.json` and `children/2/kickback-ledger.json`, when the kickback ledger is cleared, then the flat ledger and both child ledgers are removed and every other file under `children/` remains | 18 | "the flat ledger and both child ledgers are removed and every other file under `children/` (asserted with `children/1/conduct-state.json` and `children/2/gates/build.json`) remains byte-unchanged" | diff-local |
| Story 6 negative: Given a corrupt `children/2/kickback-ledger.json`, when child 2's ledger is read, then the read fails closed with the `kickback ledger is corrupt` reason a corrupt flat ledger produces, naming the child ledger's path, and is never treated as an empty ledger | 17 | "returns `{ kind: 'unreadable', reason: 'kickback ledger is corrupt' }` and `readKickbackLedger(root, 2)` returns a ledger for which `isUnreadableKickbackLedger` is true, never `emptyLedger()`, while its warning names `.pipeline/children/2/kickback-ledger.json`" | diff-local |
| Story 6 negative: Given child 2 with no step-status file, when child 2's step status is read, then it reads as absent, the same as a missing flat file, and no file is created by the read | 15 | "returns `ok: false` with error type `io_error`, the same result a missing flat file returns, and creates no file or directory under `.pipeline/children/`" | diff-local |
| Story 6 negative: Given directories `.pipeline/children/foo/` and `.pipeline/children/12/` each holding a `kickback-ledger.json`, when the fresh-session clear runs, then neither file is removed or read | 18 | "leaves both files byte-unchanged and a `vi.spyOn` on `fs.readFile` records no read of either file" | diff-local |
| Story 6 negative: Given two writers that both read child 2's step status and then submit conflicting mutations to the same field, when both are applied, then the second writer receives a typed `conflict` result naming the field and the intent, and the file holds the first writer's value with no partial write | 15 | "yield `{ kind: 'conflict' }` for the second writer with a message naming field `build` and the submitted intent, and the file holds the first writer's value with no temporary file left behind" | diff-local |
| Story 6 negative: Given a whole-feature step such as `prd_audit` or `manual_test`, when its status or verdict is written while child state exists, then it is written to the flat `.pipeline/` path and never under `children/` | 15, 16 | "changes only `.pipeline/conduct-state.json`, and no file under `children/` changes" | diff-local |
| Story 6 negative: Given a child gate verdict path, when it is formed for a whole-feature step such as `prd_audit`, then it is refused naming the step as whole-feature, and no file is written | 16 | "throw an error whose message names `prd_audit` as a whole-feature step, and no file or directory is created under `.pipeline/children/2/`" | diff-local |
| Story 7 happy: Given children 1, 2 and 3 each with child state and every region step done, plus `manual_test` and `prd_audit` done, when `rewind --to build --child 2` runs, then child 2's `build`, `test_suite` and `build_review` are `stale` and its `acceptance_specs` is unchanged | 23 | "child 2's `build`, `test_suite` and `build_review` to `stale` with `acceptance_specs` untouched" | diff-local |
| Story 7 happy: Given the same fixture, when that rewind runs, then every region step of child 3 is `stale` and every status of child 1 is unchanged | 23 | "every non-skipped region step of child 3 to `stale`; and every non-skipped registry step after `build_review` in the flat file (`manual_test`, `prd_audit`, `architecture_review_as_built`, `rebase`, `finish`) to `stale`, with `coverage_binding` untouched and child 1's file byte-unchanged" | diff-local |
| Story 7 happy: Given the same fixture, when that rewind runs, then every non-skipped whole-feature step after `build_review`, including `manual_test` and `prd_audit`, is `stale`, and `coverage_binding` is unchanged | 23 | "every non-skipped registry step after `build_review` in the flat file (`manual_test`, `prd_audit`, `architecture_review_as_built`, `rebase`, `finish`) to `stale`, with `coverage_binding` untouched" | diff-local |
| Story 7 happy: Given the same fixture, when that rewind runs, then child 2's `last_step` names the region step before `build`, and the feature's `last_step` names the step before the first demoted whole-feature step | 23 | "Child 2's batch sets `last_step` to `acceptance_specs` (the registry step before `build`), child 3's batch sets `last_step` to `coverage_binding` (the registry step before `acceptance_specs`), and the flat batch sets `last_step` to `build_review` (the registry step before `manual_test`, the first demoted whole-feature step)" | diff-local |
| Story 7 happy: Given the same fixture, when that rewind completes, then the gate verdicts of every demoted step are removed, `.pipeline/HALT` and its class file are cleared as a rewind clears them today, and one `operator_rewind` event names the target step, child 2 and the demoted set | 24 | "stages and removes the verdict of every demoted step at its own path via `verdictPathFor`" | diff-local |
| Story 7 happy: Given any `rewind --to <step>` invocation without `--child`, when it runs, then its output, state changes and event are byte-identical to today | 1, 21, 22, 24 | "returns `{ kind: 'rewind', target: 'build' }` with no `child` key, exactly today's object" | diff-local |
| Story 7 negative: Given `rewind --to prd_audit --child 2`, when it runs, then it is refused with a message stating that only `acceptance_specs`, `build`, `test_suite` and `build_review` can be rewound per child, and nothing is written | 22 | "prints `rewind: only acceptance_specs, build, test_suite and build_review can be rewound per child`, returns 1, and the `.pipeline` tree is unchanged" | diff-local |
| Story 7 negative: Given `--child 4` where `.pipeline/children/4/` does not exist, when the rewind runs, then it is refused naming child 4 as having no child state, and nothing is written | 22 | "prints `rewind: child 4 has no child state (.pipeline/children/4/ does not exist)`, returns 1, and the `.pipeline` tree is unchanged" | diff-local |
| Story 7 negative: Given `--child 0`, `--child 10` or `--child two`, when the rewind runs, then it is refused naming the invalid child id and nothing is written | 22 | "naming the raw value, returns 1, and the `.pipeline` tree (every file's bytes, including `events.jsonl` and HALT) is unchanged" | diff-local |
| Story 7 negative: Given `rewind --to build --child 2 --child 3`, or a `--child` with no value, when the CLI parses it, then it falls through to today's `unknown command` error and exit code | 21 | "asserts exit code 1, stderr containing `error: unknown command 'rewind'`, and no `.pipeline` or `.daemon` entry created" | diff-local |
| Story 7 negative: Given `children/2/conduct-state.json` whose `last_step` is `build`, when `rewind --to test_suite --child 2` runs, then it is refused because a rewind only goes backward from the child's current position, and nothing is written | 23 | "prints a refusal stating the target must be earlier than child 2's current step `build`, returns 1, and the `.pipeline` tree is unchanged" | diff-local |
| Story 7 negative: Given a port mutation refused partway through a child rewind, after child 2's demotions were applied but before child 3's, when the rewind aborts, then child 2's and the feature's state are restored to their pre-rewind values, it reports the refused field with expected and current values, and it clears no verdict and no halt | 24 | "rolls back child 2 through compensating `applyBatch`/`applyCorrection` mutations (today's `rollbackRewindState` shape per store), prints `rewind: Operator rewind refused <field>: expected <expected>, current <current>`, returns 1, and child 2's and the flat `conduct-state.json` bytes equal their pre-rewind bytes while every verdict file and `.pipeline/HALT` are untouched" | diff-local |
| Story 7 negative: Given verdict clearing that fails after every state demotion was applied, when the rewind aborts, then every demoted state file is rolled back to its pre-rewind values and `.pipeline/HALT` is left in place, as today's rewind does for the feature state | 24 | "rolls back child 2, child 3 and the flat file to their pre-rewind bytes in reverse order, restores every staged verdict, leaves `.pipeline/HALT` and `.pipeline/HALT.class` in place, and returns 1" | diff-local |
| Story 8 happy: Given a feature with child state for child 2 and task 7 recorded in the slice membership as belonging to slice position 2, when the operator runs `task start 7 --child 2`, then the command behaves exactly as `task start 7`, and `.pipeline/current-task` is written at its usual flat path | 26 | "`task start 7 --child 2` and `task start rem-fr10-1 --child 2` (an `isEngineAppendedRemediationTaskId` id absent from `taskSlices`) are accepted and then run `runTaskStart` unchanged, writing `.pipeline/current-task` at its flat path with bytes identical to `task start 7` and `task start rem-fr10-1`" | diff-local |
| Story 8 happy: Given the same feature, when the operator runs `task done 7 --child 2` with any `--done-when` evidence, then it behaves exactly as the same command without `--child` | 26 | "runs `runTaskDone` unchanged and leaves every file under `.pipeline/` byte-identical to the result of `task done 7 --done-when 1=ok`" | diff-local |
| Story 8 happy: Given an engine-appended remediation task id that has no slice membership, when the operator runs `task start <id> --child 2`, then it is accepted | 26 | "`task start rem-fr10-1 --child 2` (an `isEngineAppendedRemediationTaskId` id absent from `taskSlices`) are accepted and then run `runTaskStart` unchanged" | diff-local |
| Story 8 happy: Given any `task` invocation with no `--child` flag, including `task start <id>` followed by extra arguments that are not `--child`, when it runs, then its output and writes are byte-identical to today | 1, 25 | "`task start 7 --foo bar` still returns `{ kind: 'start', id: '7' }` (extra non-`--child` arguments ignored as today), and `dispatchTaskCommand` for it writes `task-status.json` and `current-task` bytes identical to `task start 7`" | diff-local |
| Story 8 negative: Given task 3 whose recorded membership is slice position 1, when the operator runs `task start 3 --child 2`, then it is refused naming task 3, child 1 and child 2, and `.pipeline/current-task` is unchanged | 26 | "prints `[task-cli] task 3 belongs to child 1, not child 2`, returns 1 and leaves `.pipeline/current-task` unchanged" | diff-local |
| Story 8 negative: Given a feature with no `.pipeline/children/2/`, when `task start 7 --child 2` runs, then it is refused naming child 2 as having no child state, and nothing is written | 26 | "prints `[task-cli] child 2 has no child state (.pipeline/children/2/ does not exist)` and returns 1; in both cases `task-status.json` and `.pipeline/current-task` are byte-unchanged" | diff-local |
| Story 8 negative: Given a worktree with `.pipeline/children/2/` but no coverage-binding envelope, when `task start 7 --child 2` runs, then it is refused with a message stating that no slice membership is recorded for the feature, and nothing is written | 26 | "prints `[task-cli] no slice membership is recorded for the feature (coverage-binding envelope missing)`, returns 1, and `task-status.json` and `.pipeline/current-task` are byte-unchanged" | diff-local |
| Story 8 negative: Given `task done 7 --child 2 --child 2` or `task done 7 --child` with no value, when it is parsed, then the command prints today's task guidance and exits 2 | 25 | "each return `{ kind: 'guide' }`, so `dispatchTaskCommand` prints today's task guidance to stderr, returns 2" | diff-local |
| Story 8 negative: Given `task start 7 --child 2 --child 2` or `task start 7 --child` with no value, when it is parsed, then the command prints today's task guidance and exits 2, and `.pipeline/current-task` is unchanged | 25 | "prints today's task guidance to stderr, returns 2, and `.pipeline/current-task` and `task-status.json` are unchanged" | diff-local |
| Story 9 happy: Given `.pipeline/children/2/kickback-ledger.json` with a `build_review` entry, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the human output names child 2 once above that entry's gate block | 28 | "the human output begins with the line `Child: 2`, which occurs exactly once, immediately above the `Kickback budget (build_review)` block" | diff-local |
| Story 9 happy: Given the same ledger, when the operator runs `kickback-budget inspect --feature <slug> --child 2 --format json`, then the JSON object carries `"child": 2` alongside today's fields | 28 | "prints a JSON object whose parsed `child` equals the number 2 beside today's `feature` and `gates` fields" | diff-local |
| Story 9 happy: Given any `kickback-budget` invocation without `--child`, when it runs, then its output is byte-identical to today | 1, 27, 28 | "every argv accepted today returns exactly today's object with no `child` key" | diff-local |
| Story 9 negative: Given `kickback-budget raise` or `kickback-budget reset` with `--child 2`, when it runs, then it falls through exactly as an unrecognized flag does today, and no ledger is read or changed | 27 | "return `null`, the same `null` an unrecognized flag returns today, so `dispatchKickbackBudgetCommand` is never reached and no ledger is read or changed" | diff-local |
| Story 9 negative: Given no `.pipeline/children/3/`, when `inspect --child 3` runs, then it is refused naming child 3 as having no child state | 28 | "prints `kickback-budget: child 3 has no child state.` and returns 1 before any ledger read" | diff-local |
| Story 9 negative: Given a corrupt `children/2/kickback-ledger.json`, when `inspect --child 2` runs, then it prints today's `kickback-budget: ledger is unreadable.` error and exits 1 | 28 | "prints `kickback-budget: ledger is unreadable.` and returns 1" | diff-local |
| Story 9 negative: Given `inspect --feature <slug> --child 2 --child 2`, when it is parsed, then it falls through exactly as a repeated flag does today | 27 | "`kickback-budget inspect --feature f --child 2 --child 2` returns `null`, the same `null` a repeated `--feature` returns today" | diff-local |
| Story 10 happy: Given a child rewind of child 2, when its `operator_rewind` event is persisted, then the `events.jsonl` record contains `"child":2` | 24 | "the persisted `events.jsonl` record contains the key `child` with the numeric value 2" | diff-local |
| Story 10 happy: Given events tagged with child 2 and events with no child, all for one feature, when cost and time are rolled up for the shipped record, then each step's totals equal the totals computed with the child tags removed, so Cost and Time are reported once per feature | 20 | "deep-equal to the rollup of the same ledger with every `child` key removed" | diff-local |
| Story 10 negative: Given an event emitted with no child, when it is persisted, then the record contains no `child` key at all, neither `null` nor an empty value | 19 | "the persisted `events.jsonl` line contains no `child` substring and the parsed record has no `child` own property (neither `null` nor an empty value)" | diff-local |
| Story 10 negative: Given an event built by spreading an existing event that had no child, when it is persisted, then the record still contains no `child` key | 19 | "an event built by spreading a persisted no-child `operator_rewind` record into a new event persists with no `child` own property" | diff-local |
| Story 10 negative: Given events tagged with two different children for the same step, when cost and time are rolled up, then that step appears once in the Cost and Time blocks with the summed totals, never once per child | 20 | "contains exactly one `## Cost` heading and exactly one `## Time` heading, the `build_review` dimension appears once in `rollup.byDimension` with the summed totals" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D1 | task | task-3, task-4, task-11, task-29 | `parseFeatureBranch` in `src/conductor/src/engine/feature-branch-identity.ts` returns leaf of `x` for `feat/daemon-x` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D2 | task | task-5, task-6, task-7, task-8, task-9, task-10, task-11, task-12, task-13, task-14 | keeps today's slug expression for every non-child branch |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D3 | task | task-7, task-8, task-9, task-13 | proceeds to the same committed-owner check with `featureMarker` `.docs/intake/x.md` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D4 | task | task-3 | a reason naming a missing slug for `feat/c1` and `feat/c1/` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D5 | task | task-2, task-26 | exports `MAX_CHILD_ID` equal to 9 and `parseChildId` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D6 | no-change | none | The leaf-as-highest-position rule only applies once children exist; nothing in this ticket creates child state or resolves an active child, which is implemented by #2942 per decision 10. The leaf branch name stays `feat/daemon-<slug>` (Task 3). |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D7 | no-change | none | Position immutability guard belongs to `coverage_binding` and is implemented by #2942 per decision 7; no producer of children exists in this ticket. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D8 | task | task-2, task-15, task-16, task-17, task-18 | `pipelinePathFor(root, relative, child)` returns `.pipeline/children/<k>/<relative>` with the same file name |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D9 | no-change | none | Per-child cap scope is enabled and the cap ADRs amended by #2942 per decision 9; this ticket leaves `bumpKickbackGate` and both caps untouched. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D10 | no-change | none | The active-child contract is implemented by #2942 per decision 10; in this ticket the active child is always no child, so every engine write uses the flat paths. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D11 | no-change | none | The base-override producer `resolveChildBase` and its site consumption are implemented by #2942 per decision 11; no base site changes here. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D12 | task | task-19, task-20, task-24 | exports `ConductorEvent` as the existing union intersected with `{ child?: ChildId }` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | task | task-21, task-22, task-23, task-24, task-25, task-26, task-27, task-28 | prints `rewind: child 4 has no child state (.pipeline/children/4/ does not exist)`, returns 1, and the `.pipeline` tree is unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | task | task-1, task-5, task-6, task-7, task-8 | each of which opens with a `<!-- Recorded from <sha> -->` header naming the build's base commit |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | no-change | none | Leaf-only placement of the `security` rubric is implemented by #2942 per decision 15; `build_review` rubric placement is untouched here. |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D1 | task | task-17, task-18 | with no child they read, lease and write exactly `.pipeline/kickback-ledger.json` as before |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D2 | existing | none | `classifyBuildProgress` compares `HEAD^{tree}` hashes in `src/conductor/src/engine/kickback-escalation.ts`; unchanged. |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D3 | existing | none | `bumpKickbackGate` in `src/conductor/src/engine/kickback-ledger.ts` keys the count on `treeHash` and `resolvedBefore`, never on reason text; unchanged. |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D4 | existing | none | Cap terminals call the `this.writeHaltMarker(..., 'needs-human')` method in `src/conductor/src/engine/conductor.ts` (build_review cumulative cap; gap-member no-op halt naming the gate); unchanged. |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D5 | existing | none | `checkKickbackToBuildEscalation(gapName)` / `captureKickbackToBuildContext(gapName)` in `conductor.ts` run per validation-group gap member, of which `wiring_check` is a dispatchable member; unchanged. |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D6 | existing | none | `kickback_escalation.enabled` in `src/conductor/src/types/config.ts` gates the tree-hash witness; unchanged. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D1 | existing | none | `reconcileMergedPark` proves deletion by `isContainedInMain` ancestry and `proveByMergedPrHead` head identity in `src/conductor/src/engine/park-reconciliation.ts`; this ticket adds no proof. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D2 | no-change | none | No proof is added to the set; the `child-branch` refusal (Task 13) and the child filter (Task 14) narrow deletion, as the #2940 amendment to this ADR records. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D3 | task | task-13 | `RefusalReason` gains `child-branch` |
| adr-2026-08-01-multi-proof-park-deletion-authority#D4 | task | task-13 | counts that outcome in `counts.refused` and `refusedByReason['child-branch']` |
| adr-2026-08-01-multi-proof-park-deletion-authority#D5 | task | task-14 | record precondition, proofs and refusal taxonomy for `feat/daemon-x` are deep-equal to the same fixture without the child branch |
| adr-2026-08-01-multi-proof-park-deletion-authority#D6 | existing | none | `listRegisteredWorktrees` reads `git worktree list --porcelain` and unions it with operator parks in `park-reconciliation.ts`; unchanged. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D7 | existing | none | `gatherMergeEvidence(..., branch)` keys proofs on the listed branch (`park-reconciliation.ts`); unchanged for leaf branches. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D8 | task | task-13 | `requiresShippedRecord(branch)` returns true when `branch` is undefined or `isDaemonOwnedBranchName(branch)` is true |
| adr-2026-08-01-multi-proof-park-deletion-authority#D9 | task | task-13 | the sweep's `hasRecordGatedCandidate` prefetch treats a `feat/c1/x` worktree as record-gated |
| adr-2026-08-01-multi-proof-park-deletion-authority#D10 | existing | none | The `git status --porcelain` probe before the destructive step refuses `dirty-worktree` in `park-reconciliation.ts`; unchanged. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D11 | task | task-13 | emits `{ type: 'worktree_reclaim_failed', slug: 'x', branch: 'feat/c1/x', refusal: 'child-branch' }` |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D1 | existing | none | The cumulative `build_review` cap terminal writes `needs-human` and `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` maps it in `halt-classification.ts`; unchanged. |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D2 | existing | none | `recordKickbackCapEvidence` persists typed cap evidence in `kickback-ledger.ts`; unchanged. |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D3 | existing | none | `consumeKickbackResumeAuthorization` (`kickback-ledger.ts`) and the daemon halted-feature boundary in `daemon-rekick.ts`; unchanged. |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D4 | task | task-27, task-28 | reads that ledger through `readKickbackLedger(worktree, 2)` and the human output begins with the line `Child: 2` |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D5 | existing | none | `stageKickbackBudgetAdjustment` (defined in `kickback-ledger.ts`, called from `kickback-budget-cli.ts`) grows the `laps` or `growth` allowance the live evidence names; unchanged. |
| adr-2026-09-29-plan-slice-manifest#D1 | existing | none | `validatePlanSlices` in `src/conductor/src/engine/plan-slices.ts` parses the slice-manifest table; unchanged. |
| adr-2026-09-29-plan-slice-manifest#D2 | existing | none | `test/engine/plan-slices-consumer-boundary.test.ts` pins `plan-slices.ts` importers to `land-spec.ts` and `step-runners.ts`; it stays unmodified and no production module here imports `plan-slices.ts`. |
| adr-2026-09-29-plan-slice-manifest#D3 | task | task-2 | asserts `MAX_PLAN_SLICES <= MAX_CHILD_ID` |
| adr-2026-09-29-plan-slice-manifest#D4 | existing | none | Strict `**Dependencies:**` grammar for sliced plans is validated in `plan-slices.ts`; unchanged. |
| adr-2026-09-29-plan-slice-manifest#D5 | existing | none | `landSpec` throws `landGateError('plan-slices', …)` in `src/conductor/src/engine/engineer/land-spec.ts`; unchanged. |
| adr-2026-09-29-plan-slice-manifest#D6 | task | task-26 | the envelope is read through `readCoverageBindingEnvelope` with the same filesystem adapter shape `coverage-binding-void.ts` uses |
| adr-2026-09-29-plan-slice-manifest#D7 | existing | none | `plan_slices_changed` is emitted by `runCoverageBinding` in `step-runners.ts` with its `EVENT_SINKS` row; unchanged. |
| adr-2026-09-29-plan-slice-manifest#D8 | no-change | none | No consumer of `stacked_prs.enabled` is added; the flag stays reserved and `stacked_prs` appears only in `config.ts` and `types/config.ts` (consumer-boundary test unmodified). Task 1 proves flag on and off produce identical outputs. |
| adr-2026-09-29-plan-slice-manifest#D9 | existing | none | The skill-example drift test parses `skills/plan/SKILL.md`'s manifest with `validatePlanSlices`; unchanged. |
| adr-2026-09-11-github-operation-ownership#D1 | existing | none | `createGuardedGithubOperationRunner` in `src/conductor/src/engine/tracker-client.ts` is the single guarded boundary; unchanged. |
| adr-2026-09-11-github-operation-ownership#D2 | task | task-7, task-8, task-9 | when `leafRefExists` finds `refs/heads/feat/daemon-x` locally, or finds only `refs/remotes/origin/feat/daemon-x`, the operation resolves slug `x` and proceeds to the same committed-owner check |
| adr-2026-09-11-github-operation-ownership#D3 | existing | none | `createGithubIntakeAuthorization` in `engineer/intake/github-issues.ts`; unchanged. |
| adr-2026-09-11-github-operation-ownership#D4 | existing | none | `requestExplicitGithubOperationApproval` in `github-operation-approval.ts`; unchanged. |
| adr-2026-09-11-github-operation-ownership#D5 | existing | none | `executeRemoteGit` in `remote-git-operations.ts` calls `resolveRemoteGitTargets` (defined in `remote-git-targets.ts`) and authorizes every affected ref before running; the child push keeps `HEAD:refs/heads/<branch>` (Task 9 asserts it). |
| adr-2026-09-11-github-operation-ownership#D6 | existing | none | `GithubOperationRunnerRefusal` and the `github_operation_refused` event in `github-operations.ts`; the child arm reuses the typed `invalid-target` reason. |
| adr-2026-09-11-github-operation-ownership#D7 | existing | none | The `github-boundary-audit` CLI and `test/engine/github-ownership/` audit tests; no new raw transport is introduced. |
| adr-2026-09-11-github-operation-ownership#D8 | existing | none | Gated announcements in `pr-labels.ts` never write to a foreign-owned PR; unchanged. |
| adr-2026-09-11-github-operation-ownership#D9 | existing | none | Write-credential selection inside `makeProductionGh` / `makeProductionGit` and `github-bot-auth-refusal.ts`; unchanged. |
| adr-2026-09-11-github-operation-ownership#D10 | existing | none | Bot co-author stamping through the worktree `prepare-commit-msg` hook and the engine commit helper; unchanged. |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D1 | task | task-21, task-22, task-23 | prints `rewind: only acceptance_specs, build, test_suite and build_review can be rewound per child` |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D2 | task | task-23 | Each batch is submitted through `ConductStateStore.applyBatch` on the store for that file |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D3 | task | task-23 | every non-skipped registry step after `build_review` in the flat file |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D4 | task | task-24 | then clears `.pipeline/HALT` and `.pipeline/HALT.class` through `clearHaltAtomically` exactly as today |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D5 | task | task-24 | one `operator_rewind` event is emitted with `target: 'build'`, `child: 2` |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D6 | existing | none | `dispatchRewindCommand` is called only from `src/conductor/src/index.ts`, pinned by `rewind.test.ts` "keeps the rewind command boundary reachable only from the CLI entry module"; unchanged. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work (Task 1 is the one large recording task required by architecture-review condition 1)
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Every changed cross-boundary behavior has exactly one integration-owning task whose `Done when:` states observable behavior through a production entry point (finish-record CLI: 5; halt-PR sweep: 6; daemon halt-PR operations: 7; `github-operation` CLI: 8, 9; intake overlap enumeration: 11, 12; park sweep: 13, 14; fresh-session ledger clear: 18; `rewind` dispatch: 21–24; `task` dispatch: 25, 26; `kickback-budget` dispatch: 27, 28)
- [ ] Dependencies are explicit and acyclic
- [ ] Task 1 has zero production-file changes and golden tests import no module introduced by this feature
- [ ] No task touches `bin/conduct`, `bin/install`, `hooks/` or `settings*.json`; no task writes documentation
- [ ] `test/engine/plan-slices-consumer-boundary.test.ts` is unmodified and no production module imports `plan-slices.ts` or references `stacked_prs`
