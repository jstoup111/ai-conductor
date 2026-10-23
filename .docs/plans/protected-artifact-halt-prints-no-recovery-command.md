# Implementation Plan: Protected-artifact halt prints no recovery command

**Date:** 2026-10-21
**Design:** .docs/track/protected-artifact-halt-prints-no-recovery-command.md (technical track, no PRD)
**Stories:** .docs/stories/protected-artifact-halt-prints-no-recovery-command.md
**Conflict check:** Not required (Tier S)

## Summary

The BUILD/SHIP protected-artifact seal halt appends the exact `ai-conductor reseal` invocation that
approves the change, naming the worktree slug and every path reseal must name. The hint comes from a
read-only dry run of reseal's own pre-write checks, so it is printed only when the printed command
would pass them. Five tasks.

## Technical Approach

- **Reseal split (behavior-preserving).** In `src/conductor/src/engine/protected-artifact-seal.ts`,
  move everything `resealProtectedArtifactSeal` does before `persistProtectedArtifactSealRotation`
  (empty-path check, protected/sealed target checks, target-commit check, the no-base deleted-target
  check, `inspectSeal` with the named paths excluded, the per-missing-path inherited-deletion
  inspection, and `createScopedProtectedArtifactSeal`, including its uncommitted-changes check) into
  an exported `prepareProtectedArtifactReseal(options)` that writes nothing and returns the inputs
  persist needs (`recomputed`, `survivingPaths`, `prune`). `resealProtectedArtifactSeal` becomes
  `prepareProtectedArtifactReseal` followed by the existing persist call, in the same order with the
  same messages. Every refusal it raises is an exported `ProtectedArtifactResealRefusal` (an `Error`
  subclass, same `message` as today) carrying an optional `path`: the target path for target checks,
  and the failure verdict's `path` when `inspectSeal` refuses.
- **Verdict path.** The failure arm of `ProtectedArtifactSealVerdict` gains optional `path?: string`.
  Every failure verdict whose reason names one protected path sets it: changed, added, deleted
  (inspection and rotation forms), uncommitted protected artifact changed, unvouched engine
  remediation append, provenance undeterminable (missing base ref, no merge-base, inheritance probe
  failed), and indeterminate protected artifact target. Reason strings are unchanged.
- **Hint builder.** In `src/conductor/src/engine/reseal-cli.ts`, export
  `describeResealRecovery(worktreePath: string, namedPath: string | undefined): Promise<string | undefined>`.
  It returns `undefined` when `namedPath` is absent, when `basename(dirname(worktreePath))` is not
  `.worktrees`, when `.pipeline/protected-artifact-seal.json` is unreadable or unparseable, or on any
  thrown error (it never throws). Otherwise, with `slug = basename(worktreePath)`, `toCommit = git
  rev-parse HEAD`, `featureDesc = slug`, and the base branch from a new exported
  `resolveResealBaseBranch(worktree)` (`originDefaultBranch(makeGitRunner(worktree)) ?? 'main'`, the
  resolver `dispatchResealCommand` now also uses as its default), it calls
  `prepareProtectedArtifactReseal` with `paths = [namedPath]`. On a `ProtectedArtifactResealRefusal`
  whose `path` is a sealed path not yet in the set, it adds that path and retries, at most once per
  sealed artifact; any other refusal returns `undefined`. On success it renders, with the paths
  sorted by the seal module's path order:
  line 1 `Approve this change as an operator amendment by running, from the repository root that contains .worktrees/<slug>, in an interactive terminal:`
  and line 2 `  ai-conductor reseal --slug <slug> --path <p> ... --reason "«why»" --clear-halt`.
  A slug or path matching `^[A-Za-z0-9._/-]+$` prints bare; any other value prints through the
  existing `shellQuote` from `src/conductor/src/engine/canonical-launcher.ts`. The rendering string
  sits inside `// ai-conductor:session-command-context=operator-only` ...
  `// /ai-conductor:session-command-context` markers, as `kickback-budget-view.ts`
  `renderKickbackRecoveryHint` does, so the session-command audit accepts it.
- **Conductor wiring.** In `src/conductor/src/engine/conductor.ts`, where a failed BUILD/SHIP
  `verifyProtectedArtifactSeal` verdict sets `protectedArtifactIssue`, set it to
  `` `${sealVerdict.reason}\n${hint}` `` when `describeResealRecovery(this.projectRoot, sealVerdict.path)`
  returns a hint, and to `sealVerdict.reason` unchanged otherwise. Both existing HALT writes (attempt
  2 and the refusal path) already use that text with class `protected-artifact`, so neither changes.

Local test patterns: `test/acceptance/no-operator-command-to-reseal-a-protected-decide-a.acceptance.test.ts`
`makeFixture()` builds `<tmp>/.worktrees/<slug>` as a real git repo on `main`, seals at the baseline
with `createProtectedArtifactSeal`, then branches; its `dispatchReseal()` runs `detectResealCommand`
and `dispatchResealCommand` with `cwd: fixture.root` and the `isInteractive` seam.
`test/engine/conductor-protected-artifact-advisory.test.ts` drives `new Conductor({... fromStep:
'build', maxRetries: 2 }).run()` and reads `.pipeline/HALT` and `.pipeline/HALT.class`. Search hints:
`makeFixture(`, `dispatchReseal(`, `keeps a failed seal on the protected-artifact halt path`.
Vitest runs set `TMPDIR` to a scratch directory.

## Prerequisites

- None.

## Tasks

### Task 1: Reseal's pre-write checks run without writing
**Story:** 2
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/protected-artifact-seal.test.ts` under a new `describe('prepareProtectedArtifactReseal')`, using a real git fixture shaped like the reseal acceptance `makeFixture()` (sealed `P1` and `P2`, feature branch commits changes to both): (a) `prepareProtectedArtifactReseal` with `paths: [P1]` throws a `ProtectedArtifactResealRefusal` whose `message` equals the message `resealProtectedArtifactSeal` throws for the same inputs and whose `path` is `P2`; (b) with `paths: [P1, P2]` it resolves, and the seal file bytes and the absence of `.pipeline/events.jsonl` are unchanged after the call; (c) a target not in the seal throws a refusal whose `path` is that target.
2. Verify RED.
3. Implement per the Technical Approach: the verdict `path` field, `ProtectedArtifactResealRefusal`, `prepareProtectedArtifactReseal`, and `resealProtectedArtifactSeal` as prepare plus the existing persist.
4. Verify GREEN with every existing `resealProtectedArtifactSeal` test unchanged, and commit.

**Done when:**
- [test] `prepareProtectedArtifactReseal` for `paths: [P1]` with `P2` also changed throws a `ProtectedArtifactResealRefusal` whose `path` is `P2` and whose `message` equals the message `resealProtectedArtifactSeal` throws for the same fixture, as asserted by the unlisted-drift refusal test.
- [test] `prepareProtectedArtifactReseal` for `paths: [P1, P2]` resolves while `.pipeline/protected-artifact-seal.json` stays byte-identical and no `.pipeline/events.jsonl` is created, as asserted by the no-write test.
- [test] Every pre-existing test in `src/conductor/test/engine/protected-artifact-seal.test.ts` and `src/conductor/test/engine/reseal-cli.test.ts` passes without modification.

**Files likely touched:**
- src/conductor/src/engine/protected-artifact-seal.ts
- src/conductor/test/engine/protected-artifact-seal.test.ts

**Dependencies:** none

### Task 2: Reseal hint names the slug and every committed changed path
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/reseal-cli.test.ts` under `describe('describeResealRecovery')`, with a real git fixture at `<tmp>/.worktrees/feat-x` (repo on `main`, sealed baseline, then a feature branch): (a) a committed change to sealed .docs/decisions/adr-2026-10-17-example.md → returns exactly the two lines `Approve this change as an operator amendment by running, from the repository root that contains .worktrees/feat-x, in an interactive terminal:` and `  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-example.md --reason "«why»" --clear-halt`; (b) committed changes to sealed .docs/decisions/adr-2026-10-17-a.md and .docs/decisions/adr-2026-10-17-b.md, called with `namedPath` .docs/decisions/adr-2026-10-17-a.md → line 2 is `  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-a.md --path .docs/decisions/adr-2026-10-17-b.md --reason "«why»" --clear-halt`; (c) a committed change to sealed `.docs/decisions/adr 2026 space.md` → line 2 contains `--path '.docs/decisions/adr 2026 space.md'` and `--slug feat-x` unquoted; (d) the fixture of (a) built at `<tmp>/work/feat-x` (no `.worktrees` parent) → `undefined`.
2. Verify RED.
3. Implement `resolveResealBaseBranch` (and use it as `dispatchResealCommand`'s default base-branch resolver) and `describeResealRecovery` per the Technical Approach, with the rendering inside operator-only session-command-context markers.
4. Verify GREEN and commit.

**Done when:**
- [test] `describeResealRecovery` for one committed changed sealed ADR in `.worktrees/feat-x` returns exactly `Approve this change as an operator amendment by running, from the repository root that contains .worktrees/feat-x, in an interactive terminal:` followed by `  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-example.md --reason "«why»" --clear-halt`.
- [test] `describeResealRecovery` for two committed changed sealed ADRs, named with the first, returns the command line `  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-a.md --path .docs/decisions/adr-2026-10-17-b.md --reason "«why»" --clear-halt` with both paths in sorted order.
- [test] `describeResealRecovery` prints a changed sealed path containing a space as the single-quoted value `'.docs/decisions/adr 2026 space.md'` and prints `--slug feat-x` without quotes, as asserted by the quoting test.
- [test] `describeResealRecovery` returns `undefined` for the same committed change when the worktree directory's parent is not named `.worktrees`, as asserted by the layout test.
- [test] The repository session-command audit test in `src/conductor/test/engine/session-command-audit-integration.test.ts` passes with the new `ai-conductor reseal` rendering in `src/conductor/src/engine/reseal-cli.ts`.

**Files likely touched:**
- src/conductor/src/engine/reseal-cli.ts
- src/conductor/test/engine/reseal-cli.test.ts

**Dependencies:** Task 1

### Task 3: No reseal hint when reseal would refuse
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/reseal-cli.test.ts` under `describe('describeResealRecovery')` with the Task 2 fixture: (a) committed change to sealed .docs/decisions/adr-2026-10-17-a.md plus committed new unsealed .docs/decisions/adr-2026-10-17-new.md, named `adr-2026-10-17-a.md` → `undefined`; (b) uncommitted workspace change to sealed .docs/decisions/adr-2026-10-17-a.md → `undefined`; (c) sealed .docs/decisions/adr-2026-10-17-a.md deleted in a feature-branch commit → `undefined`; (d) `.pipeline/protected-artifact-seal.json` replaced by `not json` → `undefined` without throwing, and a valid seal file in a `.worktrees/feat-x` directory that is not a git repository (so `git rev-parse HEAD` fails) → `undefined` without throwing; (e) after each of (a)-(c) and after Task 2's two-path success case, the seal file bytes are unchanged and `.pipeline/events.jsonl` contains no `protected_artifact_reseal` or `protected_artifact_reseal_refused` event.
2. Verify RED where the assertions exercise new behavior.
3. Adjust `describeResealRecovery` only if a case is not already refused by `prepareProtectedArtifactReseal`.
4. Verify GREEN and commit.

**Done when:**
- [test] `describeResealRecovery` returns `undefined` for a committed changed sealed ADR accompanied by a committed new unsealed ADR, as asserted by the added-artifact test.
- [test] `describeResealRecovery` returns `undefined` for an uncommitted change to a sealed ADR and for a sealed ADR deleted in a feature-branch commit, as asserted by the uncommitted and deletion tests.
- [test] `describeResealRecovery` returns `undefined` without throwing when the seal file content is `not json` and when the worktree is not a git repository so its git probe fails, as asserted by the unreadable-seal and git-probe-failure tests.
- [test] After `describeResealRecovery` runs for the added, uncommitted, deletion, and two-path fixtures, `.pipeline/protected-artifact-seal.json` is byte-identical to its prior content and no `protected_artifact_reseal` or `protected_artifact_reseal_refused` event is recorded, as asserted by the no-approval test.

**Files likely touched:**
- src/conductor/src/engine/reseal-cli.ts
- src/conductor/test/engine/reseal-cli.test.ts

**Dependencies:** Task 2

### Task 4: The BUILD seal halt carries the reseal hint
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-protected-artifact-advisory.test.ts`: (a) real git fixture at `<tmp>/.worktrees/feat-x` with a sealed baseline and a feature-branch commit changing .docs/decisions/adr-2026-10-17-example.md; run `new Conductor({ stateFilePath, stepRunner, events, projectRoot: <worktree>, config: {} as never, fromStep: 'build', mode: 'default', maxRetries: 2, baseBranch: 'main' }).run()` with a runner that throws if dispatched, no seal mock → `.pipeline/HALT` lines are `Protected artifact changed: .docs/decisions/adr-2026-10-17-example.md`, `Attribution: feature-authored (committed on this branch since merge-base <sha>)`, then the two reseal hint lines for slug `feat-x`; `.pipeline/HALT.class` is `protected-artifact`; no dispatch; (b) the two-ADR fixture → the HALT's first line names only `adr-2026-10-17-a.md` and its command line names both paths; (c) the added-unsealed, uncommitted-change, and feature-branch-deletion fixtures from Task 3 → for each, `.pipeline/HALT` with trailing newlines removed equals the `verifyProtectedArtifactSeal` reason for that fixture, with no `ai-conductor reseal` line and `HALT.class` `protected-artifact`; (d) the existing mocked-verdict test, plus variants whose `projectRoot` is `<tmp>/.worktrees/feat-x` with no seal file, and `<tmp>/.worktrees/feat-x` holding a valid seal file but no git repository → HALT text unchanged from the verdict reason; (e) in fixture (a), the seal file bytes before and after the halting run are identical and `.pipeline/events.jsonl` holds no `protected_artifact_reseal` or `protected_artifact_reseal_refused` event.
2. Verify RED.
3. Implement the conductor wiring per the Technical Approach.
4. Verify GREEN and commit.

**Done when:**
- [test] `Conductor.run()` at BUILD for a `.worktrees/feat-x` worktree with one committed changed sealed ADR writes a HALT whose first line is `Protected artifact changed: .docs/decisions/adr-2026-10-17-example.md`, whose second line starts `Attribution: feature-authored (committed on this branch since merge-base `, whose remaining lines are the two reseal hint lines for slug `feat-x` and that path, with `HALT.class` `protected-artifact` and no step dispatch; that halting run leaves `.pipeline/protected-artifact-seal.json` byte-identical to its pre-run content and records no `protected_artifact_reseal` or `protected_artifact_reseal_refused` event.
- [test] `Conductor.run()` for the two-ADR fixture writes a HALT whose first line names only .docs/decisions/adr-2026-10-17-a.md and whose command line is `  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-a.md --path .docs/decisions/adr-2026-10-17-b.md --reason "«why»" --clear-halt`.
- [test] `Conductor.run()` for each of the added-unsealed, uncommitted-change, and feature-branch-deletion fixtures writes a HALT whose text with trailing newlines removed is byte-identical to that fixture's `verifyProtectedArtifactSeal` reason, containing no `ai-conductor reseal` line, with `HALT.class` `protected-artifact`.
- [test] `Conductor.run()` with a mocked failed seal verdict writes a HALT whose text with trailing newlines removed is byte-identical to the verdict reason for a project root outside any `.worktrees/` directory, for a `.worktrees/feat-x` root with no seal file, and for a `.worktrees/feat-x` root whose git probe fails because it is not a git repository, with `HALT.class` `protected-artifact`.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-protected-artifact-advisory.test.ts

**Dependencies:** Task 2, Task 3

### Task 5: The printed reseal command succeeds as shown
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-protected-artifact-advisory.test.ts` using Task 4's two-ADR fixture after `Conductor.run()` halts: take the HALT's command line, split it into argv with a POSIX shell (`sh -c 'printf "%s\0" "$@"' sh <command line arguments>` via `set --` so quoting is the shell's), drop the leading `ai-conductor`, prefix `['node', 'ai-conductor']`, and pass it to `detectResealCommand` and `dispatchResealCommand` with `cwd` set to the repository root containing `.worktrees/feat-x`: (a) `isInteractive: true` → exit 0, output `Resealed protected artifacts: .docs/decisions/adr-2026-10-17-a.md, .docs/decisions/adr-2026-10-17-b.md`, `.pipeline/HALT` and `.pipeline/HALT.class` absent, and `verifyProtectedArtifactSeal({ projectRoot, featureDesc: 'feat-x', baseBranch: 'main' })` returns `ok: true`; (b) `isInteractive: false` → exit 1, stderr `reseal: requires an interactive terminal.`, HALT, HALT class, and seal file bytes unchanged.
2. Verify RED.
3. No production change is expected beyond Tasks 2 and 4; fix whatever the test exposes in `describeResealRecovery`.
4. Verify GREEN and commit.

**Done when:**
- [test] Running the HALT's printed command line, tokenized by a POSIX shell, through `detectResealCommand` and `dispatchResealCommand` from the repository root with an interactive terminal exits 0, prints `Resealed protected artifacts: .docs/decisions/adr-2026-10-17-a.md, .docs/decisions/adr-2026-10-17-b.md`, and removes `.pipeline/HALT` and `.pipeline/HALT.class`.
- [test] After that reseal, `verifyProtectedArtifactSeal` for the worktree with `baseBranch: 'main'` returns `ok: true`, as asserted by the post-reseal guard test.
- [test] The same printed command run without an interactive terminal exits 1 with `reseal: requires an interactive terminal.` and leaves `.pipeline/HALT`, `.pipeline/HALT.class`, and `.pipeline/protected-artifact-seal.json` byte-identical.

**Files likely touched:**
- src/conductor/test/engine/conductor-protected-artifact-advisory.test.ts

**Dependencies:** Task 4

## Task Dependency Graph

- Task 1 → Task 2 → Task 3 → Task 4 → Task 5

## Integration Points

- Task 4 owns the production boundary: a real `Conductor.run()` BUILD entry writes the HALT with the hint.
- Task 5 proves the printed command through the reseal command's production detector and dispatcher.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature worktree at `.worktrees/feat-x` whose branch commits a change to the sealed .docs/decisions/adr-2026-10-17-example.md, when the BUILD entry seal check halts, then `.pipeline/HALT` keeps `Protected artifact changed: .docs/decisions/adr-2026-10-17-example.md` as its first line and its `Attribution: feature-authored (committed on this branch since merge-base <sha>)` line, and is followed by the reseal hint whose command line is exactly `  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-example.md --reason "«why»" --clear-halt`, with `.pipeline/HALT.class` still `protected-artifact`. | 4, 2 | "writes a HALT whose first line is `Protected artifact changed: .docs/decisions/adr-2026-10-17-example.md`" | diff-local |
| Story 1 happy: Given a feature worktree at `.worktrees/feat-x` whose branch commits changes to two sealed artifacts .docs/decisions/adr-2026-10-17-a.md and .docs/decisions/adr-2026-10-17-b.md, when the BUILD entry seal check halts, then the HALT's first line still names only .docs/decisions/adr-2026-10-17-a.md and the reseal hint's command line is exactly `  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-a.md --path .docs/decisions/adr-2026-10-17-b.md --reason "«why»" --clear-halt`. | 4, 2 | "writes a HALT whose first line names only .docs/decisions/adr-2026-10-17-a.md" | diff-local |
| Story 1 negative: Given a feature whose project root is not a directory directly under a `.worktrees/` directory, when the seal check halts on a committed changed artifact, then the HALT text is identical to its text before this change and contains no `ai-conductor reseal` line. | 2, 4 | "returns `undefined` for the same committed change when the worktree directory's parent is not named `.worktrees`" | diff-local |
| Story 1 negative: Given a changed sealed artifact whose path contains a space, when the seal check halts, then the reseal hint prints that `--path` value single-quoted so a POSIX shell passes it as one argument, and prints every other value without quotes. | 2 | "prints a changed sealed path containing a space as the single-quoted value `'.docs/decisions/adr 2026 space.md'`" | diff-local |
| Story 1 negative: Given the reseal hint cannot be computed because the seal file is unreadable or a git probe fails, when the seal check halts, then the HALT is still written with class `protected-artifact` and its text is identical to its text before this change, with no `ai-conductor reseal` line. | 3, 4 | "for a `.worktrees/feat-x` root whose git probe fails because it is not a git repository, with `HALT.class` `protected-artifact`" | diff-local |
| Story 2 happy: Given the HALT from Story 1's two-artifact scenario, when the operator runs its printed command line unchanged in an interactive terminal from the repository root that contains `.worktrees/feat-x`, then reseal exits 0 printing `Resealed protected artifacts: .docs/decisions/adr-2026-10-17-a.md, .docs/decisions/adr-2026-10-17-b.md`, removes `.pipeline/HALT` and `.pipeline/HALT.class`, and the next BUILD entry seal check for that worktree passes. | 5 | "from the repository root with an interactive terminal exits 0, prints `Resealed protected artifacts: .docs/decisions/adr-2026-10-17-a.md, .docs/decisions/adr-2026-10-17-b.md`, and removes `.pipeline/HALT` and `.pipeline/HALT.class`" | diff-local |
| Story 2 negative: Given a seal check that halts and prints the reseal hint, when the halt is written, then `.pipeline/protected-artifact-seal.json` is byte-identical to its content before the check and no `protected_artifact_reseal` or `protected_artifact_reseal_refused` event is recorded, so printing the hint approves nothing. | 4, 3, 1 | "that halting run leaves `.pipeline/protected-artifact-seal.json` byte-identical to its pre-run content and records no `protected_artifact_reseal` or `protected_artifact_reseal_refused` event" | diff-local |
| Story 2 negative: Given the printed command line is run without an interactive terminal, when reseal dispatches, then it refuses with `reseal: requires an interactive terminal.`, exits 1, and leaves the HALT, the HALT class, and the seal file unchanged. | 5 | "exits 1 with `reseal: requires an interactive terminal.` and leaves `.pipeline/HALT`, `.pipeline/HALT.class`, and `.pipeline/protected-artifact-seal.json` byte-identical" | diff-local |
| Story 3 happy: Given a protected-artifact halt that prints no reseal hint, when the operator reads it, then its text is identical to the halt text this scenario produced before this change. | 4 | "for each of the added-unsealed, uncommitted-change, and feature-branch-deletion fixtures writes a HALT whose text with trailing newlines removed is byte-identical to that fixture's `verifyProtectedArtifactSeal` reason" | diff-local |
| Story 3 negative: Given a feature branch that commits a change to the sealed .docs/decisions/adr-2026-10-17-a.md and also commits the new, unsealed .docs/decisions/adr-2026-10-17-new.md, when the seal check halts, then the HALT contains no `ai-conductor reseal` line. | 4, 3 | "for each of the added-unsealed, uncommitted-change, and feature-branch-deletion fixtures writes a HALT whose text with trailing newlines removed is byte-identical to that fixture's `verifyProtectedArtifactSeal` reason, containing no `ai-conductor reseal` line" | diff-local |
| Story 3 negative: Given a sealed artifact whose change is present in the workspace but not committed, when the seal check halts, then the HALT contains no `ai-conductor reseal` line. | 4, 3 | "for each of the added-unsealed, uncommitted-change, and feature-branch-deletion fixtures writes a HALT whose text with trailing newlines removed is byte-identical to that fixture's `verifyProtectedArtifactSeal` reason, containing no `ai-conductor reseal` line" | diff-local |
| Story 3 negative: Given a sealed artifact deleted on the feature branch rather than inherited from the base branch, when the seal check halts, then the HALT contains no `ai-conductor reseal` line. | 4, 3 | "for each of the added-unsealed, uncommitted-change, and feature-branch-deletion fixtures writes a HALT whose text with trailing newlines removed is byte-identical to that fixture's `verifyProtectedArtifactSeal` reason, containing no `ai-conductor reseal` line" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
