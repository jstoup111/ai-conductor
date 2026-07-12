# Implementation Plan: auto-park empty/missing-plan check false-positives on a completed build with a present plan

Stem: auto-park-empty-missing-plan-check-false-positives
Track: technical
Tier: S
Source: jstoup111/ai-conductor#578

## Goal

Stop the daemon from auto-parking a fully-completed build as `empty/missing plan` when the plan is
present and well-formed but its task headings use the `### Task N — Title` em-dash form. Fix the one
parser responsible — `parsePlanTaskPaths` (`src/conductor/src/engine/autoheal.ts:1077`) — so its
task-header regex accepts a whitespace-preceded em-dash/en-dash title separator as an id-list
terminator, matching the `### Task N — Title` authoring convention already accepted by
`parsePlanTasks`, `evidence-cli`, and the gate's own line-676 presence check. Preserve the
`empty/missing plan` path for its real trigger (a plan with genuinely no task headings, or a missing
plan file).

## Files

- `src/conductor/src/engine/autoheal.ts` — Task 1. Widen the `taskHeader` regex terminator in
  `parsePlanTaskPaths` (line ~1077) from `(?::|$)` to `(?::|\s[—–]|$)` (em-dash U+2014, en-dash
  U+2013). One line; a short clarifying comment noting the em-dash convention and the #578 incident.
- `src/conductor/test/engine/autoheal.test.ts` — Task 2. Unit cases: em-dash and en-dash headings
  (incl. range/comma-list/alphanumeric ids, and an em-dash heading whose title later contains a
  colon) parse to the correct ids; a plan with no `### Task …` headings still yields an empty map.
- `src/conductor/test/engine/artifacts.test.ts` — Task 3. Build-predicate regression in the
  existing `build predicate` describe block: `checkStepCompletion('build', …)` on an em-dash plan
  whose tasks are all evidenced returns `done:true` (no `no tasks in plan`); a task-less plan still
  returns an empty-plan reason.
- `CHANGELOG.md` — Task 4. Required `## [Unreleased]` → `### Fixed` entry (harness repo gate).

## Non-goals

- No change to `parsePlanTasks` (`autoheal.ts:1000`, colon-required) — it is used only for task
  *titles* by `seedTaskStatus`, and `deriveCompletion`/`parsePlanTaskPaths` is the authoritative id
  source per the existing comment at `autoheal.ts:590-595`. Aligning both grammars is a broader
  cleanup, not this fix.
- No change to `remediation-append.ts:55` (also colon-required) — it runs only on the remediation
  path, is not implicated in the #578 auto-park chain, and is out of scope for this S-tier fix.
  (Flagged as a latent sibling for a separate issue.)
- No change to the `emptyPlan` derivation, the auto-park primitives (`daemon-auto-park.ts`), or the
  `conductor.ts` park dispatch — those are correct given a correctly-parsed plan; the defect is
  strictly upstream in the parser.
- No architecture, no ADR, no new decision — the fix aligns one regex with an existing convention.
- **No CHANGELOG Migration block.** No `bin/conduct CLI`, `settings.json` schema, hook wiring, or
  skill symlink surface changes — a non-breaking **PATCH** bugfix. A plain `### Fixed` entry is
  correct; a Migration block is not, and no self-host release waiver is warranted (no touched
  breaking surface).
- No VERSION bump beyond the frozen operator policy.

## Task Dependency Graph

```
Task 1 (widen parsePlanTaskPaths terminator)
   ├─> Task 2 (unit tests: em-dash/en-dash parse; task-less still empty)   [depends on Task 1]
   └─> Task 3 (build-predicate regression: no false empty-plan)            [depends on Task 1]
Task 4 (CHANGELOG + validate)                                              [depends on Tasks 1-3]
```

## Tasks

### Task 1: Widen parsePlanTaskPaths task-header terminator to accept em-dash/en-dash separators

In `src/conductor/src/engine/autoheal.ts`, in `parsePlanTaskPaths` (~line 1077), change:

```ts
const taskHeader = /^#{1,6}\s+Task\s+([A-Za-z0-9._,\s-]+?)(?::|$)/;
```

to:

```ts
// Terminator accepts a colon, a whitespace-preceded em-dash/en-dash title
// separator (`### Task N — Title`, the authoring convention), or end-of-line.
// Without the dash alternative, em-dash headings parse to zero ids → the build
// gate reports "no tasks in plan" → false `empty/missing plan` auto-park of a
// completed build (#578).
const taskHeader = /^#{1,6}\s+Task\s+([A-Za-z0-9._,\s-]+?)(?::|\s[—–]|$)/;
```

The non-greedy capture terminates at the first `:`, whitespace-preceded em-dash (U+2014) / en-dash
(U+2013), or end-of-line — so `### Task 1 — Title` captures `1`, `### Task 1-3 — Title` captures
`1-3`, `### Task 1, 2 — Title` captures `1, 2`, and the colon/bare/range/alphanumeric forms are
unchanged. Verified in isolation: the em-dash forms that returned `NULL` under the old regex now
capture the correct id, with no regression on the previously-matching forms.

Dependencies: none. Files: `autoheal.ts`.
Estimated: 4 min.

### Task 2: Unit tests — em-dash/en-dash headings parse; a task-less plan still yields empty

In `src/conductor/test/engine/autoheal.test.ts`, add cases alongside the existing
`parsePlanTaskPaths works with extended id grammar` test:

- **Happy (Story 1):** a plan with `### Task 1 — Add foo` and `### Task 2 — Wire bar (Story 4)`
  headings → `result.has('1')` and `result.has('2')` are true. Include an en-dash heading
  (`### Task 3 – Something`) → `result.has('3')`. Include a range (`### Task 4-5 — …`) → both `4`
  and `5` present, and a comma-list (`### Task 6, 7 — …`) → `6` and `7` present.
- **Negative (Story 2, over-capture guard):** `### Task 1 — A-3: remove the assertion` →
  `result.has('1')` true and `result.has('1 — A-3')`/any crossing-id false (id terminates at the
  em-dash, not the later colon).
- **Negative (Story 2, task-less):** a plan body with prose but no `### Task …` heading →
  `result.size === 0`.

Dependencies: Task 1. Files: `autoheal.test.ts`.
Estimated: 7 min.

### Task 3: Build-predicate regression — em-dash plan is not "no tasks in plan"; task-less still is

In `src/conductor/test/engine/artifacts.test.ts`, inside the existing `build predicate` describe
block (which already seeds task-status + evidence), add:

- **Happy (Story 1):** seed a temp project whose plan uses `### Task N — Title` em-dash headings and
  whose tasks are all evidence-stamped (mirror the block's existing "recomputes from seeded state +
  evidence" setup); assert `checkStepCompletion(dir, 'build', ctx)` returns `done:true` and its
  reason does **not** include `no tasks in plan` or `plan is empty`.
- **Negative (Story 2):** with a plan file present that contains **no** `### Task …` heading, assert
  `checkStepCompletion(dir, 'build', ctx)` returns `done:false` with an empty-plan reason
  (`plan is empty …` or `no tasks in plan`) — the `empty/missing plan` trigger is preserved.

Dependencies: Task 1. Files: `artifacts.test.ts`.
Estimated: 9 min.

### Task 4: CHANGELOG entry and validate

Add under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`:
"Daemon build-completion gate no longer false-parks a fully-completed build as 'empty/missing plan'
when the plan's task headings use the `### Task N — Title` em-dash form: `parsePlanTaskPaths` now
accepts an em-dash/en-dash title separator as a task-id terminator (previously only a colon or
end-of-line), so em-dash plans parse their task ids, evidence is stamped, and the build passes the
gate (ai-conductor#578)."

Then run the conductor test suite for the touched files and the harness integrity suite, fixing any
failure before completing:
- from `src/conductor`: `npx vitest run test/engine/autoheal.test.ts test/engine/artifacts.test.ts`
  (correct cwd per the vitest-cwd trap);
- `test/test_harness_integrity.sh` from the repo root.

Dependencies: Tasks 1-3. Files: `CHANGELOG.md`.
Estimated: 5 min.

## Verification

- New unit tests in `autoheal.test.ts` pass: em-dash and en-dash `### Task N — Title` headings
  (incl. ranges, comma-lists, alphanumeric ids) parse to the correct ids; an em-dash heading with a
  later colon captures only the leading id; a task-less plan yields an empty map.
- New regression in `artifacts.test.ts` passes: the build predicate returns `done:true` (no
  `no tasks in plan`) for an evidenced em-dash plan, and still returns an empty-plan reason for a
  task-less plan.
- Reproduction check (already confirmed in isolation, restate as the acceptance signal): before the
  fix `parsePlanTaskPaths` returns `[]` for a `### Task N — …` plan and `checkStepCompletion('build')`
  returns `{done:false, reason:'no tasks in plan'}`; after the fix it returns the N ids and the gate
  no longer reports an empty plan.
- `cd src/conductor && npx vitest run test/engine/autoheal.test.ts test/engine/artifacts.test.ts`
  green; `test/test_harness_integrity.sh` passes; `CHANGELOG.md` has the `## [Unreleased]` Fixed
  entry.

## Coverage Mapping

| Story / Scenario | Task(s) | Test / Evidence |
|---|---|---|
| Story 1 — completed build with em-dash plan is not auto-parked as empty-plan | 1, 2, 3 | `autoheal.test.ts` em-dash/en-dash ids parse; `artifacts.test.ts` build predicate `done:true`, reason excludes `no tasks in plan` |
| Story 1 — colon/bare/range/comma/alphanumeric forms unchanged (no regression) | 1, 2 | `autoheal.test.ts` range + comma-list + existing extended-id-grammar cases still pass |
| Story 2 — genuinely empty/missing plan still auto-parks | 1, 2, 3 | `autoheal.test.ts` task-less plan → empty map; `artifacts.test.ts` task-less plan → empty-plan reason |
| Story 2 — em-dash separator does not over-capture the id | 1, 2 | `autoheal.test.ts` `### Task 1 — A-3: …` captures exactly `1` |
| Release gate | 4 | `CHANGELOG.md` `## [Unreleased]` Fixed entry; integrity suite green |
