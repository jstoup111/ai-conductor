# Implementation Plan: Engine-Invoked Task Start/Done at Subagent Dispatch (#477)

**Date:** 2026-07-10
**Design:** .docs/decisions/adr-2026-07-10-session-hook-task-stamping.md (APPROVED)
**Stories:** .docs/stories/engine-must-invoke-task-start-done-at-subagent-dis.md (Accepted)
**Conflict check:** Clean as of 2026-07-10 (.docs/conflicts/engine-must-invoke-task-start-done-at-subagent-dis.md)

## Summary

Installs engine-owned Claude-session PreToolUse/PostToolUse hooks into every daemon build
worktree so task start/done stamping fires mechanically at subagent dispatch — 18 tasks.

## Technical Approach

- **New asset module** `src/conductor/src/engine/session-hook-assets.ts` mirrors
  `git-hook-assets.ts`: two bash scripts (`PRE_DISPATCH_HOOK`, `POST_DISPATCH_HOOK`) as string
  constants — bash + inline `node -e` only, zero dist/`conduct-ts` references (#403 class).
- **Hook behavior** replicates `runTaskStart`/`runTaskDone` (task-cli.ts) semantics in-script:
  read the PreToolUse payload JSON from stdin (bounded read), parse **line 1 only** of
  `tool_input.prompt` against the exact grammar `Task: <id>` | `Task: none`; validate id
  against `task-status.json` rows; flip to `in_progress` via temp-file+rename; write/clear
  `.pipeline/current-task`. Exit 2 (block) on parsed violations; exit 0 pass-through on
  unparseable payloads (fail-open to #452's abstain path). Overlap (existing stamp ≠ id):
  flip new row, REMOVE stamp. PostToolUse: remove stamp iff content matches; never write
  `completed`.
- **Provisioning** extends `prepareWorktree` (worktree-prepare.ts, beside
  `writeGitHooksAndWire`): write scripts 0755 into `<worktree>/.pipeline/session-hooks/`
  (overwrite always), then write/merge `<worktree>/.claude/settings.local.json` wiring
  `PreToolUse`/`PostToolUse` with matcher `Task|Agent` to the scripts by absolute path.
  Merge preserves unrelated keys; corrupt JSON is renamed aside (`.bak-<ts>`) and rebuilt;
  the consumer's committed `.claude/settings.json` is never touched.
- **Tests** follow the existing split: unit in `src/conductor/test/engine/`, chained
  integration in `src/conductor/test/integration/` (pattern:
  `git-hooks-attribution.test.ts`). Hook scripts are exercised by invoking the emitted bash
  with fixture payloads on stdin. Fixtures are the REAL captured headless payloads from the
  2026-07-10 spike (Task 3 embeds them verbatim).
- **Skill/doc layer:** `skills/pipeline/SKILL.md` steps 0/6 become documentation of the
  machinery + the line-1 dispatch-marker contract across ALL dispatch templates
  (implementation `Task: <id>`; evaluator, `/simplify`, micro-retro, memory-checkpoint
  `Task: none`). CHANGELOG gains the entry + `## Migration` block (hook wiring = canonical
  breaking surface). READMEs document the behavior.
- **Sequencing:** asset module → fixtures → PRE-hook behaviors (happy → negatives) →
  POST hook → provisioning install + wiring → integrations → skill/docs/changelog.

## Prerequisites

- `npm install` inside `src/conductor` of the build worktree; run vitest from
  `src/conductor` (never the worktree root).
- No migrations, no new dependencies.

## Tasks

### Task 1: Session-hook asset module skeleton
**Story:** Story 1 (embedded assets)
**Type:** infrastructure

**Steps:**
1. Write failing test: `session-hook-assets.test.ts` asserts the module exports non-empty
   string constants `PRE_DISPATCH_HOOK` and `POST_DISPATCH_HOOK`, each starting `#!/bin/bash`,
   and each passing `bash -n` when written to a temp file.
2. Verify test fails (RED)
3. Implement: create `session-hook-assets.ts` with both scripts as minimal valid bash
   (read stdin bounded via `head -c 1048576`, exit 0) plus header comments mirroring
   git-hook-assets.ts.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): session-hook asset module skeleton"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — new module
- src/conductor/test/engine/session-hook-assets.test.ts — new test

**Dependencies:** none

### Task 2: Static no-stale-engine guard on hook scripts
**Story:** Story 1 (negative: zero dist/conduct-ts references)
**Type:** negative-path

**Steps:**
1. Write failing test: asserts neither script contains `dist/`, `conduct-ts`, nor
   `require('./` (regex over the exported constants). Make it fail first by asserting
   against a deliberately-wrong fixture expectation, then point at the real constants.
2. Verify test fails (RED)
3. Implement: none expected beyond keeping scripts clean; fix any violation the test finds.
4. Verify test passes (GREEN)
5. Commit: "test(engine): session-hook scripts carry no dist/conduct-ts references"

**Files likely touched:**
- src/conductor/test/engine/session-hook-assets.test.ts — add static guard

**Dependencies:** 1

### Task 3: Real spike payload fixtures
**Story:** Story 3 (Done When: tests run against real captured payloads)
**Type:** infrastructure

**Steps:**
1. Create `src/conductor/test/fixtures/session-hook-payloads/pre-dispatch-task-id.json` with
   the verbatim 2026-07-10 spike capture (session 95588bbd), and
   `pre-dispatch-settings-local.json` (session 9dce55c0). Payload shape (fields verbatim;
   long paths may be shortened):
   `{"session_id":"95588bbd-cdcc-4170-9a27-cd15a3a008f3","transcript_path":"...","cwd":"...","prompt_id":"...","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Launch general-purpose subagent","prompt":"Task: 7 — reply with the single word done"},"tool_use_id":"toolu_01TwCfzueVmjBibMnYBA6tQm"}`
   (second fixture identical shape, prompt `Task: 9 — ...`).
2. Write a loader helper in the test file that reads a fixture and lets a test override
   `tool_input.prompt` (so every scenario stays anchored to the real shape).
3. Commit: "test(engine): real headless PreToolUse payload fixtures from #477 spike"

**Files likely touched:**
- src/conductor/test/fixtures/session-hook-payloads/pre-dispatch-task-id.json — new fixture
- src/conductor/test/fixtures/session-hook-payloads/pre-dispatch-settings-local.json — new fixture
- src/conductor/test/engine/session-hook-behavior.test.ts — new test file with loader

**Dependencies:** 1

### Task 4: PRE hook passes through on `Task: none`
**Story:** Story 3 (negative: Task: none untouched state)
**Type:** happy-path

**Steps:**
1. Write failing test: fixture payload with line-1 prompt `Task: none`; run emitted
   `PRE_DISPATCH_HOOK` via bash with payload on stdin in a temp worktree dir containing a
   seeded `.pipeline/task-status.json`; assert exit 0, task-status.json byte-unchanged, no
   `.pipeline/current-task`.
2. Verify test fails (RED)
3. Implement: line-1 extraction in the script (`head -n1` of `tool_input.prompt` via
   `node -e` JSON parse), `Task: none` → exit 0.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): PRE dispatch hook honors Task: none pass-through"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — line-1 parse + none branch
- src/conductor/test/engine/session-hook-behavior.test.ts — scenario

**Dependencies:** 3

### Task 5: PRE hook stamps `in_progress` + current-task on `Task: <id>`
**Story:** Story 3 (happy: flip + stamp, atomic)
**Type:** happy-path

**Steps:**
1. Write failing test: seeded rows incl. id `7` pending; payload line-1 `Task: 7`; assert
   exit 0, row 7 `in_progress`, `.pipeline/current-task` == `7`, JSON still valid; assert a
   `.tmp` intermediate never persists.
2. Verify test fails (RED)
3. Implement: id branch — `node -e` reads/updates task-status.json, writes temp file +
   `rename`, then writes the stamp (replicating runTaskStart, task-cli.ts:84).
4. Verify test passes (GREEN)
5. Commit: "feat(engine): PRE dispatch hook flips in_progress and writes current-task"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — stamp branch
- src/conductor/test/engine/session-hook-behavior.test.ts — scenario

**Dependencies:** 4

### Task 6: Line-1-only parsing ignores body `Task:` tokens
**Story:** Story 3 (happy: trailer-instruction text has no effect)
**Type:** happy-path

**Steps:**
1. Write failing test: payload prompt line 1 `Task: 7`, body containing
   `include trailer \`Task: 42\`` and `Task: 8` on later lines; assert row 7 stamped, rows
   8/42 untouched, exit 0.
2. Verify test fails (RED) — only if implementation scans beyond line 1; if GREEN
   immediately, keep as regression lock and note it in the commit.
3. Implement: none expected (line-1 discipline from Task 4).
4. Verify test passes (GREEN)
5. Commit: "test(engine): body Task: tokens are invisible to the dispatch hook"

**Files likely touched:**
- src/conductor/test/engine/session-hook-behavior.test.ts — scenario

**Dependencies:** 5

### Task 7: PRE hook blocks unknown id (exit 2, no state change)
**Story:** Story 3 (negative: unknown id)
**Type:** negative-path

**Steps:**
1. Write failing test: line-1 `Task: 99`, seeded ids `1,2,7`; assert exit 2, stderr contains
   `99` and the valid id list, task-status.json + absent stamp unchanged.
2. Verify test fails (RED)
3. Implement: id-membership check before any write; exit 2 with instructive stderr.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): PRE dispatch hook fail-closed on unknown task id"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — validation branch
- src/conductor/test/engine/session-hook-behavior.test.ts — scenario

**Dependencies:** 5

### Task 8: PRE hook blocks missing/malformed line-1 marker
**Story:** Story 3 + Story 4 (negatives: no marker; `Task:7`; `task: 7`; `Task: 7 and Task: 8`)
**Type:** negative-path

**Steps:**
1. Write failing test: four payload variants — line 1 lacking any marker (body may contain
   `Task:` tokens), `Task:7`, `task: 7`, `Task: 7 and Task: 8` — each asserts exit 2, stderr
   instructs a line-1 `Task: <id>` / `Task: none`, zero state change.
2. Verify test fails (RED)
3. Implement: exact-match grammar `^Task: ([A-Za-z0-9._-]+|none)$` on line 1 only; violation
   → exit 2.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): PRE dispatch hook blocks malformed line-1 markers"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — grammar enforcement
- src/conductor/test/engine/session-hook-behavior.test.ts — scenarios

**Dependencies:** 5

### Task 9: PRE hook fails open on unparseable payloads
**Story:** Story 4 (happy: invalid JSON → exit 0; empty stdin bounded)
**Type:** negative-path

**Steps:**
1. Write failing test: (a) stdin `not json{` → exit 0, stderr diagnostic, no state change;
   (b) empty stdin → exit 0 promptly (test timeout 5s guards the bounded read); (c) valid
   JSON missing `tool_input.prompt` → exit 0 pass-through.
2. Verify test fails (RED)
3. Implement: guard the `node -e` parse; any parse failure → diagnostic + exit 0.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): PRE dispatch hook fails open on unparseable payloads"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — fail-open guard
- src/conductor/test/engine/session-hook-behavior.test.ts — scenarios

**Dependencies:** 5

### Task 10: Idempotent re-stamp and overlap guard
**Story:** Story 5 (happy: overlap clears stamp; Story 3 happy: same-id re-dispatch)
**Type:** happy-path

**Steps:**
1. Write failing test: (a) stamp `7` + row 7 in_progress, payload `Task: 7` → exit 0,
   state unchanged; (b) stamp `7`, payload `Task: 9` → row 9 in_progress, row 7 still
   in_progress, stamp file REMOVED, exit 0.
2. Verify test fails (RED)
3. Implement: compare existing stamp content; same → no-op; different → flip new row then
   `rm` stamp.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): overlap guard clears current-task so commit hooks abstain"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — overlap branch
- src/conductor/test/engine/session-hook-behavior.test.ts — scenarios

**Dependencies:** 5

### Task 11: POST hook validated stamp removal
**Story:** Story 6 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing test: (a) stamp `7`, POST payload for `7` → stamp removed, row 7 stays
   in_progress, exit 0; (b) stamp `9`, POST for `7` → stamp untouched, exit 0 + stderr
   diagnostic; (c) absent stamp → exit 0; (d) across all: task-status.json before/after
   deep-equal — zero `completed` writes. POST payload = fixture with
   `hook_event_name` overridden to `PostToolUse` (same tool_input).
2. Verify test fails (RED)
3. Implement: `POST_DISPATCH_HOOK` — parse line-1 id (same grammar; `none`/unparseable →
   exit 0), remove stamp iff exact content match (mirrors runTaskDone, task-cli.ts:175).
4. Verify test passes (GREEN)
5. Commit: "feat(engine): POST dispatch hook removes current-task iff matching"

**Files likely touched:**
- src/conductor/src/engine/session-hook-assets.ts — POST hook body
- src/conductor/test/engine/session-hook-behavior.test.ts — scenarios

**Dependencies:** 8

### Task 12: Provisioning writes session-hook scripts
**Story:** Story 1 (happy: installed 0755; overwrite stale) + Story 2 (install path)
**Type:** infrastructure

**Steps:**
1. Write failing test (worktree-prepare.test.ts pattern): after `prepareWorktree` on a tmp
   repo worktree, `.pipeline/session-hooks/pre-dispatch.sh` + `post-dispatch.sh` exist, mode
   0755, content equals the exported constants; pre-seed a stale file and assert overwrite.
2. Verify test fails (RED)
3. Implement: `writeSessionHooks(worktreePath, log)` called from `prepareWorktree` beside
   `writeGitHooksAndWire` (worktree-prepare.ts:68), same fail-open logging discipline.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): prepareWorktree installs session-hook scripts"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — install call
- src/conductor/test/engine/worktree-prepare.test.ts — scenarios

**Dependencies:** 11

### Task 13: settings.local.json wiring — fresh write + merge-preserve
**Story:** Story 2 (happy: wiring present; negative: unrelated keys preserved)
**Type:** infrastructure

**Steps:**
1. Write failing test: (a) fresh worktree → `.claude/settings.local.json` contains
   PreToolUse + PostToolUse entries, matcher `Task|Agent`, commands = absolute script paths;
   (b) pre-existing file `{"permissions":{"allow":["Bash(ls:*)"]}}` → after provisioning
   those keys survive byte-for-byte and hook entries are added; re-run is idempotent.
2. Verify test fails (RED)
3. Implement: `wireSessionHookSettings(worktreePath)` — read-if-exists, deep-set hook
   entries (replace only entries whose command points into `.pipeline/session-hooks/`),
   write atomically.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): merge-preserving settings.local.json hook wiring"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — wiring helper
- src/conductor/test/engine/worktree-prepare.test.ts — scenarios

**Dependencies:** 12

### Task 14: Wiring negatives — corrupt local settings + committed-settings invariance
**Story:** Story 2 (negatives: corrupt JSON rename-aside; settings.json untouched; local file
not tracked)
**Type:** negative-path

**Steps:**
1. Write failing test: (a) `.claude/settings.local.json` containing `{invalid` → provisioning
   succeeds, original renamed to `settings.local.json.bak-<ts>`, fresh valid file written,
   warning logged; (b) committed `.claude/settings.json` bytes unchanged across provisioning;
   (c) `git status --porcelain` in the worktree does not list `.claude/settings.local.json`
   as tracked-modified (untracked or ignored is acceptable).
2. Verify test fails (RED)
3. Implement: corrupt-branch rename-aside + warn; never open settings.json for write.
4. Verify test passes (GREEN)
5. Commit: "fix(engine): settings wiring survives corrupt local settings, never touches committed settings"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — corrupt branch
- src/conductor/test/engine/worktree-prepare.test.ts — scenarios

**Dependencies:** 13

### Task 15: Integration — provisioning end-to-end + config-dir independence
**Story:** Story 2 (Done When: integration test; self-host CLAUDE_CONFIG_DIR note)
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/integration/session-hooks-provisioning.test.ts`:
   full `prepareWorktree` on a tmp git repo → scripts executable, wiring resolves (parse the
   written settings, stat each command path, assert executable); assert the wiring lives at
   the PROJECT level (worktree `.claude/settings.local.json`), i.e. contains no reference to
   `CLAUDE_CONFIG_DIR`/home-dir paths — the config-dir-independence contract.
2. Verify test fails (RED)
3. Implement: none expected; fix any gap surfaced.
4. Verify test passes (GREEN)
5. Commit: "test(integration): session-hook provisioning end-to-end"

**Files likely touched:**
- src/conductor/test/integration/session-hooks-provisioning.test.ts — new integration test

**Dependencies:** 14

### Task 16: Integration — chained #452 abstention and stamping
**Story:** Story 5 (happy: ≥2 in_progress + no stamp → prepare-commit-msg abstains; and
stamped path yields trailer)
**Type:** happy-path

**Steps:**
1. Write failing test extending the `git-hooks-attribution.test.ts` pattern: in a tmp repo
   with #452 git hooks installed, (a) drive PRE hook for `Task: 7` then commit → trailer
   `Task: 7` present; (b) drive PRE for `Task: 7` then `Task: 9` (overlap → stamp cleared,
   two in_progress rows) then commit → NO Task trailer (abstained); (c) POST for `7` after
   overlap → exit 0, no error.
2. Verify test fails (RED)
3. Implement: none expected; fix any interaction gap surfaced.
4. Verify test passes (GREEN)
5. Commit: "test(integration): session hooks chain onto #452 abstain-on-ambiguity"

**Files likely touched:**
- src/conductor/test/integration/session-hooks-attribution.test.ts — new integration test

**Dependencies:** 15

### Task 17: Pipeline SKILL.md rewrite — machinery documentation + marker contract
**Story:** Story 7 (all criteria)
**Type:** infrastructure

**Steps:**
1. Rewrite `skills/pipeline/SKILL.md` Per-Task Execution: step 0 and step 6 now DESCRIBE the
   session hooks (stamp at dispatch, validated removal at return, overlap → abstain,
   fail-closed blocks + how to fix); remove the imperative "Run `conduct-ts task start/done`"
   step text (CLI mentioned only as operator/recovery machinery).
2. Add the line-1 marker contract to EVERY dispatch template: implementation dispatch
   (`Task: <id>`, id = bare plan header id) and evaluator, `/simplify`, micro-retro,
   memory-checkpoint dispatches (`Task: none`).
3. Add a repo test (test/test_skill_pipeline_contract.sh or extend the integrity suite) that
   greps SKILL.md and fails on imperative `Run \`conduct-ts task (start|done)` step text.
4. Run `test/test_harness_integrity.sh` — must pass.
5. Commit: "docs(pipeline): step 0/6 document session-hook machinery; dispatch templates carry line-1 markers"

**Files likely touched:**
- skills/pipeline/SKILL.md — rewrite
- test/test_harness_integrity.sh — grep gate (or new test script alongside)

**Dependencies:** 11

### Task 18: CHANGELOG Migration block + README docs
**Story:** Story 8 (all criteria)
**Type:** infrastructure

**Steps:**
1. Add CHANGELOG `## [Unreleased]` → Added entry for #477; add `## Migration` section with a
   runnable ```bash migration``` block for the `hook wiring` surface (verify no stale
   worktrees carry old wiring: prune `.worktrees/`, note next provisioning auto-installs;
   no manual consumer action beyond `bin/install` re-run guidance).
2. Document in `README.md` + `src/conductor/README.md`: session-hook stamping behavior, the
   line-1 `Task: <id>` / `Task: none` contract, fail-open/fail-closed regimes, and
   settings.local.json ownership.
3. Run `test/test_harness_integrity.sh` — must pass (CHANGELOG section checks).
4. Commit: "docs: #477 changelog migration block + README session-hook docs"

**Files likely touched:**
- CHANGELOG.md — entry + migration block
- README.md — behavior docs
- src/conductor/README.md — engine docs

**Dependencies:** 17

## Task Dependency Graph

```
1 ─▶ 2
1 ─▶ 3 ─▶ 4 ─▶ 5 ─▶ 6
               5 ─▶ 7
               5 ─▶ 8 ─▶ 11 ─▶ 12 ─▶ 13 ─▶ 14 ─▶ 15 ─▶ 16
               5 ─▶ 9
               5 ─▶ 10
              11 ─▶ 17 ─▶ 18
```
(6, 7, 9, 10 are independent leaves after 5; 16 needs 10's overlap behavior via 15's chain —
treat 10 as required before 16.)

## Integration Points

- After Task 11: both hook scripts fully behave against fixture payloads (unit-complete).
- After Task 14: a provisioned worktree is end-to-end wired (hooks + settings).
- After Task 16: the full #477+#452 attribution chain is proven in one integration test.
- After Task 18: release gates (CHANGELOG/Migration/docs) satisfied.

## Verification

- [ ] All happy path criteria covered: S1→T1/T12, S2→T13/T14/T15, S3→T4/T5/T6, S4→T9,
      S5→T10/T16, S6→T11, S7→T17, S8→T18
- [ ] All negative path criteria covered: S1→T2/T12, S2→T13/T14, S3→T7/T8, S4→T8/T9,
      S5→T11(c via T16), S6→T11, S7→T17(step 3), S8→T18(step 3)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
