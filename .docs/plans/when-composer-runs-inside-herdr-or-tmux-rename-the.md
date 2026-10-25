# Implementation Plan: composer labels its pane with the idea slug and DECIDE phase

**Date:** 2026-10-24
**Stories:** .docs/stories/when-composer-runs-inside-herdr-or-tmux-rename-the.md
**Conflict check:** skipped — tier S

## Summary

Adds a best-effort pane-label helper, a `compose phase` subcommand that uses it, labelling inside
the `worktree`, `plan-review`, `land`, and `handoff` primitives, and one composer-skill sentence.
8 tasks.

## Technical Approach

- **Helper.** New `src/conductor/src/engine/engineer/pane-label.ts` exports
  `labelComposerPane({ slug, phase, env, run, warn })` and `defaultPaneLabelRunner`. The label is
  `` `${slug} · ${phase}` `` (U+00B7 between single spaces). Targets are computed from `env` only:
  herdr when `env.HERDR_ENV === '1'` and `env.HERDR_PANE_ID` is non-empty →
  `run('herdr', ['pane', 'rename', HERDR_PANE_ID, label])`; tmux when `env.TMUX_PANE` is non-empty →
  `run('tmux', ['select-pane', '-t', TMUX_PANE, '-T', label])`. Both targets run when both apply;
  `TMUX` alone never produces a tmux call. When both targets apply, the two calls run concurrently, so the whole helper stays within 2000 ms. Each call is raced against a 2000 ms timer; a rejection
  or timeout writes one `compose: pane label skipped (<tool>): <reason>` line through `warn` and the
  helper resolves. The helper never throws.
- **Injection, not default.** `DispatchEngineerOpts` gains `paneLabelRunner?`. When it is absent,
  `dispatchEngineer` performs no labelling at all, so every existing test that calls
  `dispatchEngineer` stays free of real `herdr`/`tmux` processes. Only `src/conductor/src/index.ts`
  passes `defaultPaneLabelRunner` (execa with `timeout: 2000`). Tests inject a recording mock and
  never spawn a multiplexer (repository test-isolation rule; the shared tmux fixture has not landed).
  `env` is `opts.env ?? process.env`, matching the existing `env` option.
- **Slug.** Resolved from the worktree's checked-out branch with the existing
  `resolvePlanReviewFeatureSlug(worktree)` in `engineer-cli.ts` (`spec/<slug>` → `<slug>`, otherwise
  `undefined`). `compose worktree` uses the slug it just created.
- **`compose phase`.** Added to `ENGINEER_SUBCOMMANDS`, the descriptor union, `SUBCOMMAND_HELP`, and
  the per-subcommand flag record in `test/cli-engineer.test.ts`. Flags `--worktree` and `--phase`
  are required (missing → existing `guide` behaviour); unknown flags → existing `reject`. Phase must
  match `/^[a-z0-9-]+$/`, else exit 1 naming the phase. A worktree with no `spec/<slug>` branch →
  exit 1 naming the path. Neither error path calls the runner. Success exits 0 regardless of the
  label outcome.
- **Primitives.** `plan-review`, `land`, and `handoff` label `<slug> · <subcommand>` as the first
  action of their dispatch case (before the registry lookup), skipping silently when the worktree
  has no spec slug; `worktree` labels `<slug> · worktree` after creation succeeds. The label call is
  awaited but cannot change the primitive's output or exit code.
- **Event spine.** No new channel: the label is an outward display write, not an observation
  that another component reads.

## Prerequisites

- none

## Tasks

### Task 1: Pane-label helper targets herdr and tmux from the environment
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/pane-label.test.ts` with a recording mock runner: herdr env issues one herdr call; `TMUX_PANE` env issues one tmux call; both envs issue both; empty env and `TMUX`-only env issue none.
2. Verify the tests fail (RED).
3. Implement `labelComposerPane` and `defaultPaneLabelRunner` in `src/conductor/src/engine/engineer/pane-label.ts` per Technical Approach.
4. Verify the tests pass (GREEN).
5. Commit: "feat(compose): add best-effort pane-label helper".

**Done when:**
- [test] With `HERDR_ENV=1` and `HERDR_PANE_ID=w1:p1`, `labelComposerPane` calls the runner exactly once with `herdr pane rename w1:p1 "<slug> · <phase>"`.
- [test] With `TMUX_PANE=%3`, `labelComposerPane` calls the runner exactly once with `tmux select-pane -t %3 -T "<slug> · <phase>"`.
- [test] With both herdr and `TMUX_PANE` set, `labelComposerPane` issues both calls with the same `<slug> · <phase>` label.
- [test] With an env lacking `HERDR_ENV=1`/`HERDR_PANE_ID` and `TMUX_PANE`, including one with only `TMUX` set, `labelComposerPane` makes zero runner calls.

**Files likely touched:**
- src/conductor/src/engine/engineer/pane-label.ts — new helper and default runner
- src/conductor/test/engine/engineer/pane-label.test.ts — helper unit tests

**Dependencies:** none

### Task 2: Pane-label failures and hangs warn and never throw
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/pane-label.test.ts`: a rejecting runner, and a never-settling runner under fake timers advanced 2000 ms.
2. Verify the tests fail (RED).
3. Implement the 2000 ms race and single warning line in `labelComposerPane`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(compose): bound pane-label failures to a warning".

**Done when:**
- [test] A runner that rejects makes `labelComposerPane` resolve without throwing and call `warn` exactly once with a line starting `compose: pane label skipped (herdr)`.
- [test] A runner that never settles makes `labelComposerPane` resolve once fake timers advance 2000 ms, with exactly one `compose: pane label skipped` warning.

**Files likely touched:**
- src/conductor/src/engine/engineer/pane-label.ts — timeout race and warning
- src/conductor/test/engine/engineer/pane-label.test.ts — failure and hang tests

**Dependencies:** Task 1

### Task 3: `compose phase` labels the pane through the compose CLI
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-phase.test.ts`: a temp git repo checked out on `spec/demo-idea`, `dispatchEngineer` on `compose phase --worktree <repo> --phase stories` with an injected recording `paneLabelRunner` and herdr env, then tmux env, then a second call with `--phase plan`, then a rejecting runner; a help test for `compose phase --help`.
2. Verify the tests fail (RED).
3. Implement: add `phase` to `ENGINEER_SUBCOMMANDS`, the descriptor union, the parser (`--worktree`, `--phase`), `SUBCOMMAND_HELP`, the `paneLabelRunner` option, the dispatch case calling `labelComposerPane`, the flag record in `src/conductor/test/cli-engineer.test.ts`, and `paneLabelRunner: defaultPaneLabelRunner` in `src/conductor/src/index.ts`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(compose): add compose phase subcommand".

**Done when:**
- [test] `dispatchEngineer` on `compose phase --worktree <spec/demo-idea repo> --phase stories` with herdr env makes the injected runner issue `herdr pane rename <HERDR_PANE_ID> "demo-idea · stories"` and returns 0.
- [test] The same call with `TMUX_PANE=%3` issues `tmux select-pane -t %3 -T "demo-idea · plan"` for `--phase plan` and returns 0, and a second call with a different phase issues the new label.
- [test] The same call with a runner that rejects, and with a runner that never settles once fake timers advance 2000 ms, each returns 0 and prints exactly one `compose: pane label skipped` line to stderr.
- [test] `compose phase --help` prints a `SUBCOMMAND_HELP.phase` entry naming `--worktree` and `--phase`, and the #524 sync guard in `engineer-cli-help.test.ts` passes with `phase` in `ENGINEER_SUBCOMMANDS`.
- `src/conductor/src/index.ts` passes `paneLabelRunner: defaultPaneLabelRunner` to `dispatchEngineer`, and `dispatchEngineer` without `paneLabelRunner` makes no label call.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — subcommand, parser, help, option, dispatch case
- src/conductor/src/index.ts — production runner wiring
- src/conductor/test/engine/engineer/engineer-cli-phase.test.ts — CLI tests
- src/conductor/test/cli-engineer.test.ts — per-subcommand flag record

**Dependencies:** Tasks 1, 2

### Task 4: `compose phase` rejects invalid phases and non-spec worktrees
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-phase.test.ts`: an env with no multiplexer, `--phase ""`, `--phase "a b"`, `--phase $'\e]2;x\a'`, `--phase Stories`, and a worktree checked out on `main`, each with herdr and tmux env set.
2. Verify the tests fail (RED).
3. Implement the phase pattern check and spec-slug check before any label call.
4. Verify the tests pass (GREEN).
5. Commit: "feat(compose): validate compose phase input".

**Done when:**
- [test] Each invalid `--phase` value (empty, containing a space, containing an escape sequence, containing an uppercase letter) makes `dispatchEngineer` return 1, prints an error naming the phase value, and the injected runner records zero calls.
- [test] A `--worktree` checked out on `main` makes `dispatchEngineer` return 1, prints an error naming the worktree path, and the injected runner records zero calls.
- [test] With an env that has neither `HERDR_ENV=1` nor `TMUX_PANE`, `dispatchEngineer` on `compose phase --worktree <spec/demo-idea repo> --phase stories` returns 0 and the injected runner records zero calls.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — phase and slug validation
- src/conductor/test/engine/engineer/engineer-cli-phase.test.ts — negative tests

**Dependencies:** Task 3

### Task 5: `plan-review`, `land`, and `handoff` label the pane as they start
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-primitive-labels.test.ts`: for each primitive, `dispatchEngineer` with a recording runner, herdr env, `--worktree` on `spec/demo-idea`, and a project name absent from a temp registry so the primitive fails at its registry lookup. Add a `land` run that follows a `compose phase --phase stories` call with no further phase call, then a `compose phase --phase plan` call.
2. Verify the tests fail (RED).
3. Implement the label call as the first action of the `plan-review`, `land`, and `handoff` dispatch cases, skipping when the worktree has no spec slug.
4. Verify the tests pass (GREEN).
5. Commit: "feat(compose): label the pane from plan-review, land, and handoff".

**Done when:**
- [test] `dispatchEngineer` for `plan-review`, `land`, and `handoff` each makes the injected runner issue `herdr pane rename <HERDR_PANE_ID>` with `demo-idea · plan-review`, `demo-idea · land`, and `demo-idea · handoff` respectively.
- [test] For each of the three primitives failing at the unknown-project lookup, the return code and the printed stdout/stderr lines are identical between a run with the recording runner and a run with no `paneLabelRunner`.
- [test] After a `compose phase --phase stories` call followed by a skipped phase call, a `land` run relabels the pane to `demo-idea · land` and returns the same code and stdout as a `land` run with no `paneLabelRunner`, and a following `compose phase --phase plan` call relabels it to `demo-idea · plan` and returns 0.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — label calls in three dispatch cases
- src/conductor/test/engine/engineer/engineer-cli-primitive-labels.test.ts — primitive label tests

**Dependencies:** Task 3

### Task 6: `compose worktree` labels the pane after creating the worktree
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/engineer/engineer-cli-primitive-labels.test.ts`: a temp registered git repo, `dispatchEngineer` on `compose worktree --project <name> --idea "Demo idea"` with a recording runner, under tmux env and again under herdr env, each run twice so the second run reuses the worktree. Search hint: reuse the registry/temp-repo fixture used by existing `compose worktree` tests under `src/conductor/test/engine/engineer/`.
2. Verify the test fails (RED).
3. Implement the label call after `createEngineerWorktree` succeeds, using its returned slug.
4. Verify the test passes (GREEN).
5. Commit: "feat(compose): label the pane from compose worktree".

**Done when:**
- [test] `dispatchEngineer` on `compose worktree --idea "Demo idea"` returns 0, prints the `{ slug, branch, worktreePath, reconcile }` JSON with slug `demo-idea`, and the injected runner issues `tmux select-pane -t <TMUX_PANE> -T "demo-idea · worktree"` under tmux env and `herdr pane rename <HERDR_PANE_ID> "demo-idea · worktree"` under herdr env, both on the first run (reconcile `created`) and on a second run for the same idea (reconcile `reused`).
- [test] The second `compose worktree` run for the same idea prints `reconcile` `reused` and the same `worktreePath` as the first run.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — label call in the worktree dispatch case
- src/conductor/test/engine/engineer/engineer-cli-primitive-labels.test.ts — worktree label test

**Dependencies:** Task 3

### Task 7: A failing multiplexer leaves every primitive's result unchanged
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/engineer-cli-primitive-labels.test.ts`: rerun the Task 5 and Task 6 fixtures with a runner that rejects and a runner that never settles (fake timers), comparing against a run with no `paneLabelRunner`.
2. Verify the tests fail (RED) if any primitive lets a label failure escape.
3. Fix any primitive whose label call is not isolated.
4. Verify the tests pass (GREEN).
5. Commit: "test(compose): label failures never change primitive results".

**Done when:**
- [test] For `worktree`, `plan-review`, `land`, and `handoff`, a rejecting runner and a never-settling runner (fake timers advanced 2000 ms) each yield the same return code, the same stdout lines, and the same worktree HEAD and `git status --porcelain` output as the no-runner run, and stderr differs only by one added `compose: pane label skipped` line.
- [test] The `compose worktree` run with a rejecting runner still creates the worktree directory on branch `spec/demo-idea`.

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — isolate any escaping label call
- src/conductor/test/engine/engineer/engineer-cli-primitive-labels.test.ts — failure parity tests

**Dependencies:** Tasks 5, 6

### Task 8: Composer skill asks for a phase label at each DECIDE step
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Add one sentence to the DECIDE section (§3) of `skills/composer/SKILL.md`: "As each DECIDE step starts, run `ai-conductor compose phase --worktree <worktreePath> --phase <step>`."
2. Commit: "docs(composer): label the pane at each DECIDE step".

**Done when:**
- `skills/composer/SKILL.md` §3 contains exactly one new sentence instructing the agent to run `ai-conductor compose phase --worktree <worktreePath> --phase <step>` as each DECIDE step starts.
- The diff to `skills/composer/SKILL.md` adds that one sentence and changes no other line.

**Files likely touched:**
- skills/composer/SKILL.md — one-sentence instruction

**Dependencies:** Task 3

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─┬─▶ Task 4
                            ├─▶ Task 5 ─┐
                            ├─▶ Task 6 ─┴─▶ Task 7
                            └─▶ Task 8
```

## Integration Points

- After Task 3: `ai-conductor compose phase` relabels a real herdr pane or tmux pane title.
- After Task 6: a full composer run labels the pane at every primitive.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a composer session inside a herdr pane (`HERDR_ENV=1`, `HERDR_PANE_ID` set) and an engineer worktree on branch `spec/<slug>`, when `ai-conductor compose phase --worktree <worktreePath> --phase stories` runs, then that herdr pane's label becomes `<slug> · stories` and the command exits 0 | 3 | "`dispatchEngineer` on `compose phase --worktree <spec/demo-idea repo> --phase stories` with herdr env makes the injected runner issue `herdr pane rename <HERDR_PANE_ID> "demo-idea · stories"` and returns 0." | diff-local |
| Story 1 happy: Given a composer session inside a tmux pane (`TMUX_PANE` set), when `ai-conductor compose phase --worktree <worktreePath> --phase plan` runs, then the title of the pane named by `TMUX_PANE` becomes `<slug> · plan` and the command exits 0 | 3 | "The same call with `TMUX_PANE=%3` issues `tmux select-pane -t %3 -T "demo-idea · plan"` for `--phase plan` and returns 0" | diff-local |
| Story 1 happy: Given a session inside both a tmux pane and a herdr pane, when `compose phase` runs, then both the herdr pane label and the tmux pane title become `<slug> · <phase>` | 1 | "With both herdr and `TMUX_PANE` set, `labelComposerPane` issues both calls with the same `<slug> · <phase>` label." | diff-local |
| Story 1 happy: Given a labelled pane, when `compose phase` runs again with a different phase, then the label is replaced by `<slug> · <new phase>` | 3 | "a second call with a different phase issues the new label" | diff-local |
| Story 1 negative: Given neither herdr (`HERDR_ENV` unset or not `1`) nor tmux (`TMUX_PANE` unset), when `compose phase` runs, then no `herdr` or `tmux` process is started and the command exits 0 | 4 | "With an env that has neither `HERDR_ENV=1` nor `TMUX_PANE`, `dispatchEngineer` on `compose phase --worktree <spec/demo-idea repo> --phase stories` returns 0 and the injected runner records zero calls." | diff-local |
| Story 1 negative: Given `TMUX` is set but `TMUX_PANE` is unset, when `compose phase` runs, then no `tmux` command is issued, so no implicitly targeted pane is ever relabelled | 1 | "including one with only `TMUX` set, `labelComposerPane` makes zero runner calls" | diff-local |
| Story 1 negative: Given a `--phase` value that is empty or contains anything other than lowercase letters, digits, and hyphens (for example an escape sequence or a space), when `compose phase` runs, then it exits non-zero naming the invalid phase and no pane is relabelled | 4 | "Each invalid `--phase` value (empty, containing a space, containing an escape sequence, containing an uppercase letter) makes `dispatchEngineer` return 1, prints an error naming the phase value, and the injected runner records zero calls." | diff-local |
| Story 1 negative: Given a `--worktree` path whose checked-out branch is not `spec/<slug>`, when `compose phase` runs, then it exits non-zero naming the path and no pane is relabelled | 4 | "A `--worktree` checked out on `main` makes `dispatchEngineer` return 1, prints an error naming the worktree path, and the injected runner records zero calls." | diff-local |
| Story 1 negative: Given the `herdr` or `tmux` command fails or does not finish within 2 seconds, when `compose phase` runs, then it prints a one-line warning to stderr and still exits 0 | 3 | "The same call with a runner that rejects, and with a runner that never settles once fake timers advance 2000 ms, each returns 0 and prints exactly one `compose: pane label skipped` line to stderr." | diff-local |
| Story 2 happy: Given a composer session inside herdr or tmux, when `compose worktree` creates or reuses a worktree, then the pane label becomes `<slug> · worktree` using the slug it printed | 6 | "`dispatchEngineer` on `compose worktree --idea "Demo idea"` returns 0, prints the `{ slug, branch, worktreePath, reconcile }` JSON with slug `demo-idea`, and the injected runner issues `tmux select-pane -t <TMUX_PANE> -T "demo-idea · worktree"` under tmux env and `herdr pane rename <HERDR_PANE_ID> "demo-idea · worktree"` under herdr env, both on the first run (reconcile `created`) and on a second run for the same idea (reconcile `reused`)." | diff-local |
| Story 2 happy: Given a composer session inside herdr or tmux, when `compose plan-review`, `compose land`, or `compose handoff` starts, then the pane label becomes `<slug> · plan-review`, `<slug> · land`, or `<slug> · handoff` respectively | 5 | "`dispatchEngineer` for `plan-review`, `land`, and `handoff` each makes the injected runner issue `herdr pane rename <HERDR_PANE_ID>` with `demo-idea · plan-review`, `demo-idea · land`, and `demo-idea · handoff` respectively." | diff-local |
| Story 2 negative: Given the multiplexer command fails or times out, when any of those four primitives runs, then its stdout, side effects, and exit code are identical to a run with no multiplexer present, and its only added output is the one-line stderr warning | 7 | "For `worktree`, `plan-review`, `land`, and `handoff`, a rejecting runner and a never-settling runner (fake timers advanced 2000 ms) each yield the same return code, the same stdout lines, and the same worktree HEAD and `git status --porcelain` output as the no-runner run, and stderr differs only by one added `compose: pane label skipped` line." | diff-local |
| Story 2 negative: Given a primitive that itself fails (for example `land` rejecting a DRAFT artifact), when it runs inside herdr or tmux, then its failure output and exit code are unchanged by the labelling | 5 | "For each of the three primitives failing at the unknown-project lookup, the return code and the printed stdout/stderr lines are identical between a run with the recording runner and a run with no `paneLabelRunner`." | diff-local |
| Story 3 happy: Given the composer skill, when an agent reads its DECIDE section, then it finds one short instruction to run `ai-conductor compose phase --worktree <worktreePath> --phase <step>` as each DECIDE step starts | 8 | "`skills/composer/SKILL.md` §3 contains exactly one new sentence instructing the agent to run `ai-conductor compose phase --worktree <worktreePath> --phase <step>` as each DECIDE step starts." | diff-local |
| Story 3 negative: Given the instruction is skipped for a phase, when the next primitive or `compose phase` call runs, then the label is corrected by that call and the composer flow is otherwise unaffected | 5 | "After a `compose phase --phase stories` call followed by a skipped phase call, a `land` run relabels the pane to `demo-idea · land` and returns the same code and stdout as a `land` run with no `paneLabelRunner`, and a following `compose phase --phase plan` call relabels it to `demo-idea · plan` and returns 0." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-2: Collapse the pane-label skip reason to one line in src/conductor/src/engine/engineer/pane-label.ts, and add a multi-line execa-style rejection test to src/conductor/test/engine/engineer/pane-label.test.ts asserting exactly one newline-free warning
**Gate:** prd-audit
**Rationale:** Verified (95%): pane-label.ts:36-37 puts the raw `error.message` into the warning. execa 9 builds that message with '\n' and '\n\n' separators, so a real ENOENT or tmux failure prints several lines, not one. Plan Task 2 Step 3 already requires a 'single warning line' in `labelComposerPane`, so this is conforming implementation and test drift inside an approved task. No architecture or product decision is needed. Repair: collapse the reason to one line (join on whitespace, trim), and add a RED test whose rejecting runner throws a multi-line, execa-shaped message such as 'Command failed with ENOENT: herdr pane rename x\nspawn herdr ENOENT' or '...exit code 1...\n\ncan't find pane: %3'. The test asserts exactly one warn call, the warning starts with 'compose: pane label skipped (herdr)', and it contains no '\n'. The existing reject and 2000 ms timeout tests stay as they are.
**Criterion:** S1.9
**Parent task:** 2
**Done when:**
- [test] S1.9 is satisfied by this task.
- The repair for task rem-prd-audit-2 is committed and its targeted tests pass.
