# Implementation Plan: finish-record primitive — first-try finish-choice marker write (issue #281)

**Date:** 2026-07-07
**Design:** .docs/decisions/adr-2026-07-07-finish-record-primitive.md (APPROVED)
**Stories:** .docs/stories/finish-step-fails-try-1-on-every-daemon-ship-skill.md
**Conflict check:** Clean as of 2026-07-07 (.docs/conflicts/2026-07-07-finish-record-primitive.md)
**Complexity:** .docs/complexity/finish-step-fails-try-1-on-every-daemon-ship-skill.md (Tier M)

## Summary

Adds a deterministic `conduct-ts finish-record` subcommand that performs the finish
STOP-gate checks and atomically writes the completion markers, then rewrites the finish
skill's auto-mode exit contract (SKILL.md + engine prompt) to end with that one command.
14 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/finish-record-cli.ts`** modeled exactly on
  `shipped-record-cli.ts`: exported `detectFinishRecordCommand(argv)` returning
  `{kind:'record', choice, prUrl?, pipelineDir} | {kind:'guide'} | null`, and
  `dispatchFinishRecord(cmd, cwd, deps?)` returning an exit code. Deps
  `{ gh, runGit }` are injectable (production defaults inside the module), following
  the pr-labels/push-evidence runner pattern, so every refusal path is unit-testable
  without spawning.
- **Verification (choice=pr):** PR check = `gh pr view --json url -q .url` non-empty
  (run with cwd = the repo containing the pipeline dir, i.e. `dirname(pipelineDir)`);
  push check = `headPushedToUpstream(runGit, cwd)` imported from `./push-evidence.js` —
  `true` passes, `false`/`null` refuse. Fail-closed: any throw refuses with one stderr
  line, exit 1, zero writes. Guard order: absolute-pipeline-dir → dir exists → (pr only)
  gh check → push check → writes.
- **Writes:** read-modify-write `<pipelineDir>/conduct-state.json` (parse existing,
  preserve unknown fields, set `pr_url`; invalid JSON → refuse without clobbering),
  THEN write `<pipelineDir>/finish-choice` with the bare choice string. Marker last =
  commit point.
- **Wiring:** `src/index.ts` detection chain, immediately alongside the shipped-record
  block (line ~324 pattern: detect → if truthy dispatch → exit code).
- **Prompt rewrite:** `step-runners.ts` auto-mode finish block (lines ~777-809) keeps
  its decision guidance (pr vs keep, existing-PR reuse) but replaces the two manual
  file-write instructions with the exact `conduct-ts finish-record ...` command line
  built from `this.pipelineDir` (fallback `.pipeline` relative when unset, as today).
- **SKILL.md rewrite:** `skills/finish/SKILL.md` §4 "Unattended/auto mode" + §5
  recording bullets instruct ending with the command; explicit refusal contract (gates
  that block → do NOT invoke finish-record; absent marker = finish refused). Interactive
  instructions unchanged.
- **Sequencing:** module-first TDD (detection → guards → verification → writes), then
  wiring, then prompt/SKILL rewrites, then smoke + docs. Repo gates: full vitest suite
  via `rtk proxy npx vitest run`, `test/test_harness_integrity.sh`, CHANGELOG
  `[Unreleased]` entry (Added — MINOR; additive subcommand, NOT a bin/conduct breaking
  surface → no migration block).

## Prerequisites

None — no schema, no new dependencies (execa already present), no infra.

## Tasks

### Task 1: detection — happy shapes
**Story:** "finish-record subcommand detection" (happy paths)
**Type:** happy-path
**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-record-cli.test.ts`: argv for `--choice pr --pr-url <url> --pipeline-dir /abs` → `{kind:'record', choice:'pr', prUrl, pipelineDir}`; `--choice keep --pipeline-dir /abs` → keep record; unrelated subcommand argv → null.
2. RED. 3. Create `finish-record-cli.ts` with `detectFinishRecordCommand` (flag parser copied from shipped-record-cli). 4. GREEN. 5. Commit "feat(conduct-ts): finish-record argv detection — happy shapes".
**Files:** src/conductor/src/engine/finish-record-cli.ts; src/conductor/test/engine/finish-record-cli.test.ts
**Dependencies:** none

### Task 2: detection — malformed shapes → guide, never fallthrough
**Story:** detection (negative paths)
**Type:** negative-path
**Steps:**
1. Failing tests: no flags → guide; `--choice merge-local` and `--choice discard` → guide; `pr` without `--pr-url` → guide; flag value that is another flag (`--pr-url --pipeline-dir`) → guide; `--choice keep --pr-url <url>` (contradiction) → guide. Guide dispatch exits 1 and prints usage naming both accepted choices and all flags.
2. RED. 3. Implement guide branch + usage text. 4. GREEN. 5. Commit "feat(conduct-ts): finish-record malformed argv → usage guide (never pipeline fallthrough)".
**Files:** same as Task 1
**Dependencies:** Task 1

### Task 3: absolute pipeline-dir guard
**Story:** "absolute pipeline-dir guard" (both paths)
**Type:** negative-path
**Steps:**
1. Failing tests: `--pipeline-dir .pipeline` and `--pipeline-dir ../other/.pipeline` → exit ≠0, zero writes, stderr says absolute required; injected runner spies assert NO gh/git spawn on refusal; non-existent absolute dir → exit ≠0, no mkdir.
2. RED. 3. Implement guard first in `dispatchFinishRecord` (isAbsolute + stat isDirectory). 4. GREEN. 5. Commit "feat(conduct-ts): finish-record refuses relative/missing pipeline dir before any spawn".
**Files:** same
**Dependencies:** Task 1

### Task 4: choice=pr verification — PR URL check
**Story:** "choice=pr verification refuses fail-closed" (gh rows)
**Type:** negative-path
**Steps:**
1. Failing tests with injected gh runner: empty stdout → exit ≠0, zero writes (snapshot pipeline dir before/after), one stderr reason; gh throws ENOENT → same refusal naming the spawn failure (no keep fallback).
2. RED. 3. Implement gh check via injectable `deps.gh` (production default mirrors the artifacts.ts gh runner), cwd = dirname(pipelineDir). 4. GREEN. 5. Commit "feat(conduct-ts): finish-record PR-existence check, fail-closed on gh error".
**Files:** same
**Dependencies:** Task 3

### Task 5: choice=pr verification — push evidence reuse
**Story:** choice=pr verification (push rows)
**Type:** negative-path
**Steps:**
1. Failing tests: `headPushedToUpstream` → false ⇒ refuse; → null ⇒ refuse; both zero-write asserted; test also greps the module imports `./push-evidence.js` (no local merge-base reimplementation).
2. RED. 3. Import and call `headPushedToUpstream(deps.runGit, cwd)`. 4. GREEN. 5. Commit "feat(conduct-ts): finish-record reuses push-evidence; false AND null refuse".
**Files:** same
**Dependencies:** Task 4

### Task 6: writes — order and preservation
**Story:** "marker writes are ordered and preserve state" (happy paths)
**Type:** happy-path
**Steps:**
1. Failing tests: with passing checks, pre-existing `conduct-state.json` `{feature:'x', session_id:'y'}` → after run has both fields + `pr_url`; `finish-choice` contains exactly `pr`; missing state file → created; keep choice writes marker only.
2. RED. 3. Implement read-modify-write then marker write. 4. GREEN. 5. Commit "feat(conduct-ts): finish-record ordered marker writes preserve state fields".
**Files:** same
**Dependencies:** Task 5

### Task 7: writes — commit-point and corrupt-state refusals
**Story:** ordered writes (negative paths)
**Type:** negative-path
**Steps:**
1. Failing tests: fs-injected state-write failure ⇒ exit ≠0 AND `finish-choice` absent; corrupt JSON in existing state ⇒ refuse, file left byte-identical (no clobber); prior valid `finish-choice` from an earlier attempt left untouched by a later refusal.
2. RED. 3. Implement (writeFile seam injectable or temp-dir permission trick; corrupt-JSON parse guard before any write). 4. GREEN. 5. Commit "feat(conduct-ts): finish-choice is the commit point — no marker without pr_url, no clobber of corrupt state".
**Files:** same
**Dependencies:** Task 6

### Task 8: choice=keep spawns nothing
**Story:** "choice=keep writes only the marker"
**Type:** happy-path
**Steps:**
1. Failing test: keep run with spy gh/git runners → exit 0, marker `keep`, both spies uncalled.
2. RED. 3. Route keep past verification entirely. 4. GREEN. 5. Commit "feat(conduct-ts): finish-record keep path — marker only, zero spawns".
**Files:** same
**Dependencies:** Task 6

### Task 9: index.ts wiring
**Story:** detection Done-When (dispatch chain)
**Type:** infrastructure
**Steps:**
1. Failing test (pattern of existing cli dispatch tests, or extend finish-record-cli.test.ts to cover the exported pair used by index): detect placed before pipeline fallthrough — mirror how shipped-record is asserted; minimally, a test that `detectFinishRecordCommand(['node','conduct-ts','finish-record'])` shape used by index returns guide (already covered) plus a source assertion that index.ts imports and dispatches it (grep-style test acceptable, matching repo conventions if present).
2. RED where applicable. 3. Add import + detect/dispatch block in `src/index.ts` adjacent to shipped-record (line ~324 pattern). 4. GREEN + `rtk proxy npx vitest run` for the cli tests. 5. Commit "feat(conduct-ts): wire finish-record into the CLI dispatch chain".
**Files:** src/conductor/src/index.ts
**Dependencies:** Task 2

### Task 10: step-runners auto-mode prompt rewrite
**Story:** "finish skill and engine prompt end with the one command"
**Type:** happy-path
**Steps:**
1. Failing tests in `test/engine/step-runners.test.ts`: auto-mode finish prompt with `pipelineDir` set contains `conduct-ts finish-record --choice pr --pr-url` and the absolute `--pipeline-dir <dir>`, and no longer contains the manual "write the single word" instructions; without `pipelineDir`, contains the `.pipeline` relative fallback rendering; non-auto or non-finish prompts unchanged.
2. RED. 3. Rewrite the block at step-runners.ts:777-809 (keep decision guidance + STOP-gate framing; replace write instructions with the command for pr and keep variants). 4. GREEN. 5. Commit "feat(conductor): auto-mode finish prompt ends with finish-record command".
**Files:** src/conductor/src/engine/step-runners.ts; src/conductor/test/engine/step-runners.test.ts
**Dependencies:** Task 9

### Task 11: SKILL.md auto-mode exit contract
**Story:** same story (SKILL.md criteria + refusal contract)
**Type:** happy-path
**Steps:**
1. Rewrite `skills/finish/SKILL.md`: §4 unattended block + §5 "record the outcome" bullets instruct `conduct-ts finish-record ...` as the final act (pr and keep variants, absolute pipeline dir from the step prompt); add the explicit refusal contract line (blocked gates → do NOT run finish-record; absent marker = refusal signal); leave interactive Options 1–4 manual-write instructions for non-auto flows intact where they still apply (marker semantics unchanged).
2. Run `test/test_harness_integrity.sh` (frontmatter, cross-refs, section numbering) — must pass.
3. Commit "feat(finish): auto-mode exit contract — end with conduct-ts finish-record".
**Files:** skills/finish/SKILL.md
**Dependencies:** Task 10 (command shape final)

### Task 12: real-binary smoke
**Story:** "real-binary smoke test"
**Type:** negative-path
**Steps:**
1. Add `src/conductor/test/smoke/finish-record.smoke.test.ts` (pattern: test/smoke/autoresolve-smoke.test.ts): build/point at the real CLI entry, nested-mkdtemp temp parent, temp absolute pipeline dir; case 1 `--choice keep` → exit 0 + marker `keep`; case 2 `--choice pr` without `--pr-url` → exit ≠0 + usage + nothing written. Respect the production-spawn env kill-switch conventions from global vitest setup.
2. RED (before wiring exists it fails; ordered after Task 9 it should pass immediately — assert it does). 3. Fix any argv drift found. 4. GREEN. 5. Commit "test(conduct-ts): finish-record real-binary smoke".
**Files:** src/conductor/test/smoke/finish-record.smoke.test.ts
**Dependencies:** Task 9

### Task 13: docs
**Story:** exit-contract story Done-When (docs)
**Type:** infrastructure
**Steps:**
1. Document the subcommand in `README.md` and `src/conductor/README.md` (flags, choices, fail-closed refusal semantics, who invokes it).
2. Add CHANGELOG `## [Unreleased]` → Added entry (additive conduct-ts subcommand; MINOR; no migration block — not a breaking surface).
3. Commit "docs: finish-record subcommand + changelog".
**Files:** README.md; src/conductor/README.md; CHANGELOG.md
**Dependencies:** Task 11

### Task 14: full-suite verification
**Story:** all Done-When gates
**Type:** infrastructure
**Steps:**
1. `rtk proxy npx vitest run` in src/conductor — full suite green.
2. `test/test_harness_integrity.sh` — pass.
3. Grep zero remaining instructions telling auto-mode finish to hand-write `.pipeline/finish-choice` (orphaned-primitive check in reverse: no superseded manual path left in auto-mode prompt or SKILL auto section).
4. Commit any stragglers; no code change expected.
**Files:** none (verification)
**Dependencies:** Tasks 12, 13

## Task Dependency Graph

```
1 → 2 → 9 → 10 → 11 → 13 ─┐
1 → 3 → 4 → 5 → 6 → 7      ├→ 14
            6 → 8          │
        9 → 12 ────────────┘
```

## Integration Points

- After Task 9: `conduct-ts finish-record` runnable end-to-end from a shell (keep path).
- After Task 10: daemon dispatches would emit the new prompt (engine rebuild picks it up).
- After Task 12: real-binary argv contract proven.

## Verification

- [ ] All happy path criteria covered: detection (T1), pr verification pass (T6), keep (T8), prompt (T10), SKILL (T11), smoke (T12)
- [ ] All negative path criteria covered: malformed argv (T2), relative/missing dir (T3), gh empty/ENOENT (T4), push false/null (T5), write-failure commit point + corrupt state + prior-state untouched (T7), keep contradictions (T2/T8), smoke refusal (T12)
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
