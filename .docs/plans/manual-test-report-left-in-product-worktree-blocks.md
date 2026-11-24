# Implementation Plan: Validator output never leaves the product worktree dirty

**Date:** 2026-11-15
**Design:** none (technical track, Tier S — see `.docs/track/manual-test-report-left-in-product-worktree-blocks.md`)
**Stories:** .docs/stories/manual-test-report-left-in-product-worktree-blocks.md
**Conflict check:** Not required (Tier S)

## Summary

A validation dispatch (`manual_test`, `prd_audit` or `architecture_review_as_built`) can leave untracked files in the feature worktree. Before the engine acts on that dispatch's outcome, those files are moved under `.pipeline/validator-residue/`, so a routed host entry no longer halts with `worktree is dirty` (#3683). Tracked edits, and untracked files that existed before the dispatch, are never moved and still block. The manual-test skill names `.pipeline/manual-test-evidence/` as the home for its evidence. Five tasks.

> **Amended 2026-11-19 by #3685:** In fallback validation, the engine captures unreviewed product changes from the dispatch-owned checkout for the owning BUILD task before residue cleanup. Report quarantine and the dirty-switch guard continue to apply to the feature worktree.


## Technical Approach

- **Verified shape (main at `5d2f96421a`).**
  - Routed host entry runs `enterHostRegion` in `src/conductor/src/engine/routing/host-region-entry.ts`. That calls `switchToChild` in `src/conductor/src/engine/child-lifecycle.ts`, which runs `git status --porcelain` and refuses with `worktree is dirty: <paths>` when the output is not empty. The conductor turns the refusal into the needs-human HALT `routed host <n> entry refused: …` (`enterRoutedHostRegion` in `conductor.ts`). That refusal is NOT changed here (`adr-2026-10-07-per-child-build-region` decision: switching is refused on a dirty tree and never autostashes).
  - The SHIP-tail validation group is `VALIDATION_GROUP` in `src/conductor/src/engine/steps.ts`; `getGroupForStep(step)` returns it for its three members. A member runs serially (one `this.stepRunner.run` per attempt inside the serial attempt loop of `conductor.ts`; the `result = …` dispatch is wrapped in a `try … finally` that is followed by the completion check), or fanned out through the `dispatchGroupRound` closure. That closure is called once for the first round and once per retry round. The join then calls `computeAndWriteVerdict` for each member and emits `gate_verdict`.
  - A manual_test FAIL is routed from FAIL rows in `.pipeline/manual-test-results.md` no matter what the gate verdict is (`handleManualTestFailKickback` on the serial path, and the join's kickback). A gate-level dirtiness check therefore could not stop the incident, so the residue has to be gone before routing.
  - Rebase already moves untracked files aside. `confirmUntrackedRebasePaths(git, projectRoot, paths)` checks that every path is confined and that git reports it as `??`. `moveRebaseUntrackedPathsToQuarantine(projectRoot, paths)` checks every source and destination before the first `rename` and refuses to overwrite. Both live in `src/conductor/src/engine/rebase.ts`, with `REBASE_UNTRACKED_QUARANTINE_DIR` and `makeGitRunner`. Their event `rebase_untracked_quarantined { paths, directory }` is declared in `src/conductor/src/types/events.ts`, with a `persist: true` row in `EVENT_SINKS` (`src/conductor/src/engine/event-sinks.ts`, which `satisfies Record<ConductorEvent['type'], SinkDeclaration>`).
  - Each of the three validator steps writes its outputs under `.pipeline/`. Consumer `.gitignore` files ignore `.pipeline/` (`GITIGNORE_SKELETON` in `registry-cli.ts`), so `git status --porcelain --untracked-files=all` does not list those outputs.
- **Helper (new `src/conductor/src/engine/validator-residue.ts`).**
  - `listUntrackedPaths(git)` parses `git status --porcelain=v1 -z --untracked-files=all` and returns the `??` paths, which are untracked and not ignored.
  - `quarantineValidatorResidue({ projectRoot, git, baseline, source })` computes the current untracked paths minus `baseline`. It returns `{ kind: 'none' }` when that set is empty. Otherwise it confirms the paths with `confirmUntrackedRebasePaths` and moves them with `moveRebaseUntrackedPathsToQuarantine`, which gains an optional `directory` argument that defaults to `REBASE_UNTRACKED_QUARANTINE_DIR`. The destination is the per-dispatch directory `.pipeline/validator-residue/<source>-<ISO timestamp with ':' replaced by '-'>`. The helper returns `{ kind: 'moved', paths, directory }` (directory relative to the worktree), or `{ kind: 'refused', reason }` when anything throws. Every check runs before the first rename, so a refusal moves nothing.
  - `source` is a validation `StepName` on the serial path, and the literal `'validation'` on the grouped path.
- **Wiring (`conductor.ts`).** In the serial attempt loop, when `getGroupForStep(step.name)?.name === VALIDATION_GROUP.name`:
  - Take the baseline before the dispatch starts.
  - After the dispatch's `finally` settles and before the completion check, call the helper.
  - On a `moved` result, emit `validator_residue_quarantined`. On a `refused` result, write `this.log?.('WARNING: validator residue quarantine refused — <reason>')`.

  `dispatchGroupRound` does the same: baseline at entry, then quarantine and emit (or log) before it returns its outcomes. Every round, retries included, is therefore clean before the join runs.
- **Event.** Add `{ type: 'validator_residue_quarantined'; source: StepName | 'validation'; paths: string[]; directory: string }` to `ConductorEvent`, with an `EVENT_SINKS` row `{ render: false, persist: true, audit: false, otel: false }`.
- **Skill.** `skills/manual-test/SKILL.md` §4 and its Verification checklist name `.pipeline/manual-test-evidence/` as the only evidence destination. Open PR #3679 edits §0, §5 and a different checklist bullet of the same file, so these edits do not overlap its hunks.
- **Test patterns.**
  - Helper tests use a real temporary git repository (`mkdtemp`, `git init`, a committed `.gitignore` containing `.pipeline/`), together with `makeGitRunner` from `rebase.ts`, as the untracked-quarantine cases in `test/engine/rebase.test.ts` do.
  - Wiring tests follow `test/engine/validation-group-handshake-retry.test.ts`: a `Conductor` from `test/test-conductor.ts`, a fake `StepRunner` whose `run(step)` writes files into the fixture, and state seeded up to `manual_test`. Make the fixture directory a git repository with an initial commit.
  - Read persisted events from `.pipeline/events.jsonl`, or subscribe to the `ConductorEventEmitter`.
- **Not changed:** the `switchToChild` dirty refusal; build's uncommitted-paths completion check (`dirtyWorktreeCompletionOrNull`); `build_review` and other non-validation steps; whether validators may commit product code (#3685).

## Prerequisites

- None.

## Tasks

### Task 1: Move a validation dispatch's new untracked files under .pipeline/validator-residue
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/validator-residue.test.ts` against a real temporary git repository: an initial commit containing `.gitignore` with `.pipeline/` and one tracked file `src/app.ts`, using `makeGitRunner` from `rebase.ts`.
   - Cover new-file quarantine, preserved pre-existing and tracked dirt (then call `switchToChild` with the same runner on a fixture branch), a destination collision, a regular file sitting at `.pipeline/validator-residue`, a vanished path (wrap the runner so `status` also reports `?? ghost.txt`, which does not exist on disk), and the no-op case. After each refusal fixture, call `switchToChild` again.
2. Verify the tests fail (RED).
3. Implement `listUntrackedPaths` and `quarantineValidatorResidue` in `src/conductor/src/engine/validator-residue.ts`.
   - Add the optional `directory` parameter to `moveRebaseUntrackedPathsToQuarantine`, defaulting to `REBASE_UNTRACKED_QUARANTINE_DIR`.
   - Wrap confirm and move in `try`/`catch` so that any throw becomes `{ kind: 'refused', reason }`.
4. Verify the tests pass (GREEN), and that the existing untracked-quarantine cases in `test/engine/rebase.test.ts` still pass unchanged.
5. Commit: "Quarantine untracked validator residue under .pipeline".

**Done when:**
- [test] With a baseline from `listUntrackedPaths` taken before `docs/reports/manual-test-step17/report.html` is written, `quarantineValidatorResidue` returns `kind: 'moved'` listing exactly that path and a directory under `.pipeline/validator-residue/`, the file exists at `<directory>/docs/reports/manual-test-step17/report.html` with byte-identical content, and `git status --porcelain` prints nothing.
- [test] With an uncommitted edit to tracked `src/app.ts` and an untracked `notes.txt` already in the baseline, `quarantineValidatorResidue` moves neither (both stay at their original paths), and `switchToChild` on that repository then returns `refused` with a reason starting `worktree is dirty` that names both `src/app.ts` and `notes.txt`.
- [test] In each of three refusal fixtures — a new path's destination already exists under the per-dispatch directory, a regular file sits at `.pipeline/validator-residue`, and a git runner that also reports `?? ghost.txt` for a path absent on disk — `quarantineValidatorResidue` returns `kind: 'refused'` with a non-empty reason, every new untracked source path that exists on disk (including a second, non-colliding one) is still at its original location, and `switchToChild` then returns `refused` with a reason starting `worktree is dirty` that names `docs/reports/manual-test-step17/report.html`.
- [test] When the dispatch wrote only under the ignored `.pipeline/`, `quarantineValidatorResidue` returns `kind: 'none'` and no `.pipeline/validator-residue/` directory exists afterwards.
- `moveRebaseUntrackedPathsToQuarantine` called without a directory argument still moves into `.pipeline/rebase-untracked-quarantine`, and the existing untracked-quarantine cases in `src/conductor/test/engine/rebase.test.ts` pass unmodified.

**Files likely touched:**
- `src/conductor/src/engine/validator-residue.ts` — new helper
- `src/conductor/src/engine/rebase.ts` — optional destination directory on `moveRebaseUntrackedPathsToQuarantine`
- `src/conductor/test/engine/validator-residue.test.ts` — new tests

**Dependencies:** none

### Task 2: Declare the validator_residue_quarantined event on the spine
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Add `validator_residue_quarantined` to the persisted-types list in `src/conductor/test/engine/event-sinks.test.ts`, and add a case asserting that an `EventPersister` writes an emitted event of that type to `.pipeline/events.jsonl` with its `source`, `paths` and `directory` fields.
2. Verify the tests fail (RED).
3. Add the variant `{ type: 'validator_residue_quarantined'; source: StepName | 'validation'; paths: string[]; directory: string }` to `ConductorEvent` in `src/conductor/src/types/events.ts`, and the row `{ render: false, persist: true, audit: false, otel: false }` to `EVENT_SINKS`.
4. Verify the tests pass (GREEN).
5. Commit: "Add validator_residue_quarantined event".

**Done when:**
- [test] The event-sinks persisted-types test lists `validator_residue_quarantined` and passes, and `EVENT_SINKS.validator_residue_quarantined.persist` is `true`.
- [test] An emitted `validator_residue_quarantined` event with `source: 'manual_test'`, one path and a directory is written by `EventPersister` as one line of `.pipeline/events.jsonl` carrying those three field values.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new `ConductorEvent` variant
- `src/conductor/src/engine/event-sinks.ts` — sink row
- `src/conductor/test/engine/event-sinks.test.ts` — persisted-types list and persister case

**Dependencies:** none

### Task 3: Quarantine residue after each serial validation attempt
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/validator-residue-wiring.test.ts`. Follow `test/engine/validation-group-handshake-retry.test.ts`: a daemon `Conductor` from `test/test-conductor.ts`, a fake `StepRunner`, and a git-initialised fixture with an initial commit that includes `.gitignore` containing `.pipeline/`.
   - Seed state so that `prd_audit` and `architecture_review_as_built` are already `done`. That leaves `manual_test` as the only dispatchable member, so the serial attempt loop runs it.
   - The fake `run('manual_test')` writes `docs/reports/manual-test-step17/report.html` and a `.pipeline/manual-test-results.md` attempt with one FAIL row.
   - Add a second case where the fake runner first writes a regular file at `.pipeline/validator-residue`. Add two `vi.mock` cases in which `quarantineValidatorResidue` returns `refused` with the destination-collision reason and with the vanished-path reason, the two refusals that Task 1's fixtures prove the real helper produces.
   - Add a third case that runs a `build` dispatch whose fake runner writes an untracked `src/new.ts`.
   - Add a fourth case where the fake `run('manual_test')` writes only `.pipeline/manual-test-results.md`.
2. Verify the tests fail (RED).
3. Implement in the serial attempt loop of `conductor.ts`. When `getGroupForStep(step.name)?.name === VALIDATION_GROUP.name`:
   - Take `listUntrackedPaths(makeGitRunner(this.projectRoot))` before the dispatch.
   - After the dispatch's `finally` and before the completion check, call `quarantineValidatorResidue` with `source: step.name`.
   - On `moved`, emit `validator_residue_quarantined` through `emitTracked`. On `refused`, call `this.log?.('WARNING: validator residue quarantine refused — ' + reason)`.
4. Verify the tests pass (GREEN).
5. Commit: "Quarantine serial validation residue before routing".

**Done when:**
- [test] After the serial `manual_test` attempt with a FAIL row, `docs/reports/manual-test-step17/report.html` exists byte-identical under `.pipeline/validator-residue/manual_test-*/`, `git status --porcelain` in the fixture prints nothing, and `.pipeline/events.jsonl` holds exactly one `validator_residue_quarantined` event with `source: 'manual_test'`, that path, and that directory, recorded before the run's first `step_failed` event for `manual_test`.
- [test] After that run, the routed host entry's dirty-tree probe `switchToChild` (the call `enterHostRegion` makes) switches the fixture worktree to a fixture child branch and returns `completed`, not a `worktree is dirty` refusal.
- [test] For each refused quarantine — the real refusal caused by a regular file the fake runner placed at `.pipeline/validator-residue`, and, with `quarantineValidatorResidue` replaced through `vi.mock`, a destination-collision refusal (reason `refusing to overwrite quarantined path: docs/reports/manual-test-step17/report.html`) and a vanished-path refusal (reason `refusing to quarantine missing path: ghost.txt`) — the report stays at `docs/reports/manual-test-step17/report.html`, no `validator_residue_quarantined` event is emitted, and the conductor `log` option receives the line `WARNING: validator residue quarantine refused — <reason>` carrying exactly that refusal's reason.
- [test] A `build` dispatch whose fake runner writes untracked `src/new.ts` leaves `src/new.ts` in place, emits no `validator_residue_quarantined` event, and the build completion check returns `missing: 'uncommitted'` with a reason naming `src/new.ts`.
- [test] A serial `manual_test` attempt whose fake runner writes only `.pipeline/manual-test-results.md` emits no `validator_residue_quarantined` event and leaves no `.pipeline/validator-residue/` directory.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — serial attempt-loop wiring
- `src/conductor/test/engine/validator-residue-wiring.test.ts` — new wiring tests

**Dependencies:** Task 1, Task 2

### Task 4: Quarantine residue after each grouped validation round, before the join
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/validator-residue-wiring.test.ts` with all three members dispatchable, so the validation fan-out runs, and a tracked `src/app.ts` in the fixture's initial commit. The fake `run('architecture_review_as_built')` writes `docs/reports/as-built/report.html` and edits tracked `src/app.ts` without committing it.
   - Seed an untracked, non-ignored `scratch.txt` before the run starts.
   - In a retry case, the first round's `manual_test` dispatch throws, and the retried round's `manual_test` writes `docs/reports/retry/report.html`.
2. Verify the tests fail (RED).
3. Implement in the `dispatchGroupRound` closure of `conductor.ts`:
   - Take `listUntrackedPaths` at entry.
   - After the members settle and before returning outcomes, call `quarantineValidatorResidue` with `source: 'validation'`.
   - Emit `validator_residue_quarantined` on `moved`, or write the same `WARNING: validator residue quarantine refused` log line on `refused`.
4. Verify the tests pass (GREEN).
5. Commit: "Quarantine grouped validation residue before the join".

**Done when:**
- [test] After the grouped run, `docs/reports/as-built/report.html` exists byte-identical under `.pipeline/validator-residue/validation-*/`, and exactly one `validator_residue_quarantined` event with `source: 'validation'` naming that path and directory is emitted before the join's first `gate_verdict` event.
- [test] `scratch.txt`, untracked before the group started, and an uncommitted edit the fake `architecture_review_as_built` runner makes to tracked `src/app.ts` both remain in place afterwards, and neither path appears in any `validator_residue_quarantined` event's `paths`.
- [test] In the retry case, `docs/reports/retry/report.html`, written during the retried round, is moved under `.pipeline/validator-residue/validation-*/`, and `git status --porcelain` lists only `scratch.txt` and `src/app.ts` once the join has run.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `dispatchGroupRound` wiring
- `src/conductor/test/engine/validator-residue-wiring.test.ts` — grouped cases

**Dependencies:** Task 1, Task 2, Task 3

### Task 5: The manual-test skill names .pipeline/manual-test-evidence as the evidence destination
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. In `skills/manual-test/SKILL.md` §4 "Walk Through Stories", replace "Take screenshots of key states as manual-test evidence" with an instruction to save screenshots, HTML reports, logs and every other manual-test evidence file under `.pipeline/manual-test-evidence/` in the feature worktree, creating it if missing, and never anywhere else in the product tree.
2. Add a Verification checklist item, placed after "Every story (happy + negative paths) tested manually": all evidence files were written under `.pipeline/manual-test-evidence/`, and the run added no file outside `.pipeline/` to the product tree.
3. Commit: "manual-test: keep evidence under .pipeline/manual-test-evidence".

**Done when:**
- §4 of `skills/manual-test/SKILL.md` directs screenshots, HTML reports, logs and other manual-test evidence to `.pipeline/manual-test-evidence/`, says to create the directory if it is missing, and forbids writing evidence anywhere else in the product tree.
- The skill's Verification checklist contains an item requiring that all evidence files were written under `.pipeline/manual-test-evidence/` and that the run added no file outside `.pipeline/` to the product tree.
- No sentence in `skills/manual-test/SKILL.md` names a path outside `.pipeline/` (such as `docs/`, `reports/` or `tmp/`) as a place to keep manual-test evidence.

**Files likely touched:**
- `skills/manual-test/SKILL.md` — evidence destination in §4 and the Verification checklist

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 3 ─▶ Task 4
Task 2 ─┘
Task 5 (independent)
```

## Integration Points

- After Task 3: a serial manual_test attempt that leaves a report behind ends with a clean worktree, and the persisted event names what was moved.
- After Task 4: the grouped validation fan-out is clean before its join recomputes verdicts.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature worktree with no untracked files, when a serially dispatched `manual_test` attempt creates the untracked file `docs/reports/manual-test-step17/report.html` and records a FAIL row, then before the completion check reads that attempt the file is moved to `docs/reports/manual-test-step17/report.html` beneath a new per-dispatch directory under `.pipeline/validator-residue/`, `git status --porcelain` in the worktree prints nothing, and the routed host entry that follows proceeds without a `worktree is dirty` refusal. | 3 | "After the serial `manual_test` attempt with a FAIL row, `docs/reports/manual-test-step17/report.html` exists byte-identical under `.pipeline/validator-residue/manual_test-*/`, `git status --porcelain` in the fixture prints nothing" | diff-local |
| Story 1 happy: Given the validation group fans out `manual_test`, `prd_audit` and `architecture_review_as_built` in parallel, when any member creates an untracked file that is not ignored, then after every member of that dispatch round has settled and before the join recomputes any member verdict, the file is moved beneath a per-dispatch directory under `.pipeline/validator-residue/`, keeping its relative path. | 4 | "After the grouped run, `docs/reports/as-built/report.html` exists byte-identical under `.pipeline/validator-residue/validation-*/`" | diff-local |
| Story 1 happy: Given a validation dispatch that moved one or more files, when the move completes, then one `validator_residue_quarantined` event naming the validation step or group, every moved path, and the destination directory is persisted to `.pipeline/events.jsonl`. | 3 | "`.pipeline/events.jsonl` holds exactly one `validator_residue_quarantined` event with `source: 'manual_test'`, that path, and that directory" | diff-local |
| Story 1 negative: Given a validation dispatch that edits a tracked file and does not commit it, when the dispatch settles, then the tracked edit stays in place, no event is emitted for it, and the next routed host entry is still refused with `worktree is dirty` naming that path. | 1, 4 | "With an uncommitted edit to tracked `src/app.ts` and an untracked `notes.txt` already in the baseline, `quarantineValidatorResidue` moves neither" | diff-local |
| Story 1 negative: Given an untracked, non-ignored file that already existed before the validation dispatch began, when the dispatch settles, then that file is not moved and still makes the next routed host entry refuse with `worktree is dirty` naming it. | 1, 4 | "`switchToChild` on that repository then returns `refused` with a reason starting `worktree is dirty` that names both `src/app.ts` and `notes.txt`" | diff-local |
| Story 1 negative: Given a validation dispatch whose untracked output includes a path whose destination already exists under `.pipeline/validator-residue/`, or a path that can no longer be found, when the move is attempted, then no file is moved, the engine logs the refusal reason, and the existing dirty-tree refusal at routed host entry still applies. | 1, 3 | "`quarantineValidatorResidue` returns `kind: 'refused'` with a non-empty reason, every new untracked source path that exists on disk (including a second, non-colliding one) is still at its original location" | diff-local |
| Story 1 negative: Given a `build` dispatch that leaves an untracked file, when it settles, then the file is not moved and build's existing uncommitted-paths completion check still reports it. | 3 | "A `build` dispatch whose fake runner writes untracked `src/new.ts` leaves `src/new.ts` in place, emits no `validator_residue_quarantined` event, and the build completion check returns `missing: 'uncommitted'` with a reason naming `src/new.ts`." | diff-local |
| Story 1 negative: Given a validation dispatch that creates no untracked, non-ignored files (for example only `.pipeline/` writes), when it settles, then nothing is moved and no `validator_residue_quarantined` event is emitted. | 1, 3 | "When the dispatch wrote only under the ignored `.pipeline/`, `quarantineValidatorResidue` returns `kind: 'none'` and no `.pipeline/validator-residue/` directory exists afterwards." | diff-local |
| Story 2 happy: Given `skills/manual-test/SKILL.md`, when it instructs the agent to capture screenshots, HTML reports, logs or other manual-test evidence, then the skill directs every such file to `.pipeline/manual-test-evidence/` in the feature worktree, creating the directory if it is missing. | 5 | "§4 of `skills/manual-test/SKILL.md` directs screenshots, HTML reports, logs and other manual-test evidence to `.pipeline/manual-test-evidence/`, says to create the directory if it is missing" | diff-local |
| Story 2 happy: Given the skill's Verification checklist, when an agent self-checks a run, then one item requires that all evidence files were written under `.pipeline/manual-test-evidence/` and that the run added no file outside `.pipeline/` to the product tree. | 5 | "The skill's Verification checklist contains an item requiring that all evidence files were written under `.pipeline/manual-test-evidence/` and that the run added no file outside `.pipeline/` to the product tree." | diff-local |
| Story 2 negative: Given the skill, when it describes any evidence destination, then it names no path outside `.pipeline/` (for example `docs/`, `reports/` or `tmp/`) as a place to keep manual-test evidence. | 5 | "No sentence in `skills/manual-test/SKILL.md` names a path outside `.pipeline/` (such as `docs/`, `reports/` or `tmp/`) as a place to keep manual-test evidence." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-R1: src/conductor/src/engine/validator-residue.ts: add a required `now: Date` field to QuarantineValidatorResidueInput and build the residue directory name from `input.now.toISOString()` instead of `new Date()`. In src/conductor/src/engine/conductor.ts, pass `now: new Date()` from the quarantineValidationResidue call site, since conductor.ts is already allowlisted for clock. Update src/conductor/test/engine/validator-residue.test.ts callers to pass a fixed Date, and assert the returned directory equals `.pipeline/validator-residue/<source>-<ISO with ':' replaced by '-'>` for that Date. Remove the `engine/validator-residue.ts -> clock` line from src/conductor/test/structural/boundary-allowlist.txt and confirm the structural boundary-ratchet test passes.
**Gate:** as-built
**Rationale:** Verified: src/conductor/src/engine/validator-residue.ts:63 calls zero-argument `new Date()` to stamp the per-dispatch residue directory, and this branch adds `engine/validator-residue.ts -> clock` to src/conductor/test/structural/boundary-allowlist.txt, which breaks ADR adr-2026-11-07-external-boundary-ports-registry-and-ratchet D4 (the allowlist may only shrink). The approved architecture already settles the fix, so no architectural decision is needed. The only caller, conductor.ts:9061, is already allowlisted as `engine/conductor.ts -> clock`. Inject the timestamp through the input and remove the added allowlist line. Plan Task 1, which created validator-residue.ts and its tests, admits this change. It preserves every Task 1 criterion: the directory stays under .pipeline/validator-residue/<source>-<timestamp>, and the moved, none and refused behavior is unchanged. Sibling check: no other file this branch adds is on the allowlist.
**Governing clause:** adr-2026-11-07-external-boundary-ports-registry-and-ratchet decision 4
**Done when:**
- adr-2026-11-07-external-boundary-ports-registry-and-ratchet decision 4 is satisfied by this task.
- The repair for task rem-as-built-R1 is committed and its targeted tests pass.
