# Implementation Plan: BUILD-origin plan-gap recovery

**Date:** 2026-10-09
**Design:** none (Tier S, technical track — `.docs/track/build-origin-plan-gap-recovery-refuses-rewind-to-b.md`)
**Stories:** .docs/stories/build-origin-plan-gap-recovery-refuses-rewind-to-b.md
**Conflict check:** Not required (Tier S)

## Summary

Makes `ai-conductor rewind`'s refusal at a halted feature's own unfinished step name the supported in-place recovery (`ai-conductor halt clear`), and corrects the shipped `daemon-triage` plan-gap routing so a plan gap raised inside BUILD is recovered with `halt clear` rather than the refused `rewind --to build`. Three tasks.

## Technical Approach

- **Why the refusal happens (unchanged).** `conduct task done <id> --plan-gap` writes the plan-gap HALT from inside BUILD; the conductor's step-refusal recording leaves `last_step: build` and `build: refused`. `rewindState` in `src/conductor/src/engine/rewind.ts` refuses any target whose registry index is not strictly earlier than `last_step`. That guard stays exactly as is (accepted Story 4 of `.docs/stories/needs-human-halt-auto-resumed-at-dispatch-rewind-c.md`).
- **The supported recovery already exists.** `ai-conductor halt clear --feature <slug> --rationale <text>` (`src/conductor/src/engine/halt-clear-cli.ts`) clears both markers with an audited event and leaves `conduct-state.json` untouched; resume then re-enters the `refused`/`failed` step because `findResumeIndex` starts after the last `done` step and a non-`done` step is not gate-satisfied. No change to `halt clear`, resume, or park.
- **New pure helper in `src/conductor/src/engine/rewind.ts`:** `export function inPlaceHaltRecoveryHint(state: ConductState, target: string, slug: string): string | undefined`. It returns a hint only when `state.last_step === target` and `state[target]` is `'refused'` or `'failed'`; otherwise `undefined`. The returned text is exactly: `rewind: "<target>" is the halted step itself (status <status>); after resolving the cause, resume it in place with: ai-conductor halt clear --feature <slug> --rationale "<what you fixed>"`.
- **Call site:** the whole-feature (no `--child`) path of `dispatchRewindCommand`. Record that the derived-record preflight (`preflightDerivedRecords`, which requires both `.pipeline/HALT` and `.pipeline/HALT.class`) completed; in the existing `catch`, after the existing `console.error(\`rewind: ${message}\`)`, and only when the preflight completed and `result` is still `undefined` (i.e. `rewindState` refused before any mutation), call the helper with `observed.value`, `command.target`, and `basename(cwd)` (`node:path`), and `console.error` the hint when it is defined. The existing refusal message is printed unchanged and first; the return code stays `1`; no state, marker, or verdict write is added. The `--child` path is not touched.
- **Agent-instruction routing:** the `HALT.class is plan-gap` row of the classification table in `skills/daemon-triage/SKILL.md` is split by origin, keyed on `.pipeline/conduct-state.json` `last_step`.
- Tests follow `.agents/skills/write-tests/SKILL.md`: extend `src/conductor/test/engine/rewind.test.ts`, reusing its existing pattern for command-boundary refusals (`refuses the current build step without changing halted state bytes`): a `mkdtemp` root, a real `.pipeline/` with `conduct-state.json`, `HALT`, and `HALT.class`, a `vi.spyOn(console, 'error')` spy, byte snapshots of the files before and after, and `rm` of the exact temp root in `finally`. Allowed variation: the worktree must be a child directory with a known name (for example `join(root, 'plan-gap-feature')`) so the slug in the hint is assertable. Add this plan's tasks to the file's `// Covers:` marker line.

## Prerequisites

- Stories carry `**Status:** Accepted`.

## Tasks

### Task 1: Refusal at the halted unfinished step names `halt clear`

**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rewind.test.ts` (pattern: the existing `refuses the current build step without changing halted state bytes` test — temp root, real `.pipeline/` files, `console.error` spy, byte snapshots, cleanup in `finally`; variation: worktree directory `plan-gap-feature` under the temp root). Fixture: `conduct-state.json` = `{ ...completeState, last_step: 'build', build: 'refused' }`, `HALT` = `Plan gap: task 11, Done when check 2 cannot be satisfied under the approved plan.\n`, `HALT.class` = `plan-gap\n`. Call `dispatchRewindCommand({ kind: 'rewind', target: 'build' }, worktree)`. Assert it resolves `1`; `console.error` was called with `rewind: Rewind target "build" must be earlier than current step "build"`; `console.error` was also called with a string containing `ai-conductor halt clear --feature plan-gap-feature --rationale`; the refusal message call precedes the hint call; the three files are byte-identical to their snapshots. Repeat the fixture with `build: 'failed'` and assert the same outcomes. Add a direct unit test that `inPlaceHaltRecoveryHint({ last_step: 'build', build: 'refused' }, 'build', 'plan-gap-feature')` returns the exact text from Technical Approach.
2. Verify the tests fail (RED).
3. Implement `inPlaceHaltRecoveryHint` and the call site in `dispatchRewindCommand` exactly as described in Technical Approach.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(rewind): name halt clear when refusing the halted step itself"

**Done when:**
- [test] A `dispatchRewindCommand` test on a worktree named `plan-gap-feature` with `last_step` `build` and `build` `refused` asserts exit `1`, the unchanged `rewind: Rewind target "build" must be earlier than current step "build"` message, and a following `console.error` line containing `ai-conductor halt clear --feature plan-gap-feature --rationale`.
- [test] The same test asserts `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class` are byte-for-byte unchanged after the refusal.
- [test] A second `dispatchRewindCommand` test with `build` `failed` asserts exit `1`, the same refusal message, the same `ai-conductor halt clear --feature plan-gap-feature --rationale` line, and byte-for-byte unchanged `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class`.
- [test] A unit test asserts `inPlaceHaltRecoveryHint` returns the exact hint text for `last_step` `build`, status `refused`, slug `plan-gap-feature`.

**Files:** `src/conductor/src/engine/rewind.ts`, `src/conductor/test/engine/rewind.test.ts`

**Dependencies:** none

### Task 2: No `halt clear` hint for any other refusal

**Story:** 1
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/rewind.test.ts` with the same fixture pattern as Task 1, each asserting exit `1`, byte-identical `conduct-state.json` (and `HALT`/`HALT.class` where present), and that no `console.error` call contains `halt clear`: (a) `last_step` `build`, `build` `done`, HALT + HALT.class present, target `build` — also assert the existing `must be earlier than current step "build"` message; (b) `last_step` `build`, `build` `refused`, HALT + HALT.class present, target `test_suite` — also assert `rewind: Rewind target "test_suite" must be earlier than current step "build"`; (c) `last_step` `build`, `build` `refused`, no `.pipeline/HALT` and no `.pipeline/HALT.class`, target `build`. Add direct unit assertions that `inPlaceHaltRecoveryHint` returns `undefined` for case (a)'s and case (b)'s state/target pairs.
2. Verify the tests fail against any over-broad hint condition (RED); if Task 1's implementation already satisfies them, record that and keep them as the guard.
3. Implement: tighten the helper condition or the call-site preflight-completed guard if any case prints the hint.
4. Verify the tests pass (GREEN).
5. Commit with message: "test(rewind): keep the halt clear hint to in-place halted refusals"

**Done when:**
- [test] A `dispatchRewindCommand` test with `last_step` `build` and `build` `done` asserts exit `1`, the existing refusal message, no `console.error` line containing `halt clear`, and byte-for-byte unchanged `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class`.
- [test] A `dispatchRewindCommand` test targeting `test_suite` with `last_step` `build` and `build` `refused` asserts exit `1`, the message `rewind: Rewind target "test_suite" must be earlier than current step "build"`, no `console.error` line containing `halt clear`, and byte-for-byte unchanged `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class`.
- [test] A `dispatchRewindCommand` test with no `.pipeline/HALT` and `build` `refused` targeting `build` asserts exit `1`, no `console.error` line containing `halt clear`, and byte-for-byte unchanged `conduct-state.json`.
- [test] Unit assertions show `inPlaceHaltRecoveryHint` returns `undefined` when the target step's status is `done` and when the target is not the recorded `last_step`.

**Files:** `src/conductor/src/engine/rewind.ts`, `src/conductor/test/engine/rewind.test.ts`

**Dependencies:** Task 1

### Task 3: Route plan-gap triage by origin

**Story:** 2
**Type:** infrastructure

**Steps:**
1. In `skills/daemon-triage/SKILL.md`, replace the single `HALT.class` is `plan-gap` row of the classification table with guidance keyed on `.pipeline/conduct-state.json` `last_step`: when `last_step` is `build` (BUILD's plan-gap report), amend the indicted artifact, reseal, then clear in place with `ai-conductor halt clear --feature <slug> --rationale "<what you amended>"`, and unpark only afterwards as its own explicit step; when `last_step` is a later step (`prd_audit` or the as-built architecture review), amend, reseal, and `ai-conductor rewind --to build`. Keep the existing warning that clearing the marker without amending an artifact just re-halts, and keep the runbook column pointing at `runbooks/stalled-or-stuck-feature.md`. Keep the table well-formed (one or two rows; first-match ordering unchanged for other rows).
2. Run `git diff --check -- skills/daemon-triage/SKILL.md` and confirm the table still renders as one Markdown table.
3. Commit with message: "fix(daemon-triage): route BUILD-origin plan gaps to halt clear"

**Done when:**
- The `skills/daemon-triage/SKILL.md` classification table's plan-gap guidance names `last_step` `build` as the BUILD-origin case and directs, in order, amending the indicted artifact, resealing it, then clearing the halt in place with `ai-conductor halt clear --feature <slug> --rationale`, with unpark as a separate later explicit step.
- The same guidance names the later-step origin (`prd_audit` or as-built review) and directs, in order, amending the indicted artifact, resealing it, then `ai-conductor rewind --to build` for it, and does not direct `halt clear` for that origin.
- The plan-gap guidance still states that clearing the marker without amending an artifact re-halts, and the table's other rows are unchanged.

**Files:** `skills/daemon-triage/SKILL.md`

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──► Task 2
Task 3 (independent)
```

## Integration Points

- After Task 1: `ai-conductor rewind --to build` from a BUILD-origin plan-gap worktree prints the `halt clear` recovery through the real command boundary (`dispatchRewindCommand`, reached from the CLI entry module).

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature worktree directory named `<slug>` with `.pipeline/HALT`, `.pipeline/HALT.class` reading `plan-gap`, and `.pipeline/conduct-state.json` recording `last_step` `build` with `build` status `refused`, when the operator runs `ai-conductor rewind --to build` from that worktree, then the command exits 1, still prints `rewind: Rewind target "build" must be earlier than current step "build"`, also prints a line naming `ai-conductor halt clear --feature <slug> --rationale`, and `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class` are byte-for-byte unchanged. | 1 | "A `dispatchRewindCommand` test on a worktree named `plan-gap-feature` with `last_step` `build` and `build` `refused` asserts exit `1`, the unchanged `rewind: Rewind target "build" must be earlier than current step "build"` message, and a following `console.error` line containing `ai-conductor halt clear --feature plan-gap-feature --rationale`." | diff-local |
| Story 1 happy: Given the same halted worktree except that the `build` status is `failed`, when the operator runs `ai-conductor rewind --to build`, then the command exits 1, prints the same refusal message and the same `ai-conductor halt clear --feature <slug> --rationale` line, and all three files are byte-for-byte unchanged. | 1 | "A second `dispatchRewindCommand` test with `build` `failed` asserts exit `1`, the same refusal message, the same `ai-conductor halt clear --feature plan-gap-feature --rationale` line, and byte-for-byte unchanged `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class`." | diff-local |
| Story 1 negative: Given a halted feature whose `last_step` is `build` and whose `build` status is `done`, when the operator runs `ai-conductor rewind --to build`, then the command exits 1 with the existing refusal message, prints no line mentioning `halt clear`, and `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class` are byte-for-byte unchanged. | 2 | "A `dispatchRewindCommand` test with `last_step` `build` and `build` `done` asserts exit `1`, the existing refusal message, no `console.error` line containing `halt clear`, and byte-for-byte unchanged `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class`." | diff-local |
| Story 1 negative: Given a halted feature whose `last_step` is `build` and whose `build` status is `refused`, when the operator runs `ai-conductor rewind --to test_suite`, then the command exits 1 with `rewind: Rewind target "test_suite" must be earlier than current step "build"`, prints no line mentioning `halt clear`, and the three files are byte-for-byte unchanged. | 2 | "A `dispatchRewindCommand` test targeting `test_suite` with `last_step` `build` and `build` `refused` asserts exit `1`, the message `rewind: Rewind target "test_suite" must be earlier than current step "build"`, no `console.error` line containing `halt clear`, and byte-for-byte unchanged `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class`." | diff-local |
| Story 1 negative: Given a feature worktree with no `.pipeline/HALT` whose `last_step` is `build` and whose `build` status is `refused`, when the operator runs `ai-conductor rewind --to build`, then the command exits 1, prints no line mentioning `halt clear`, and `conduct-state.json` is byte-for-byte unchanged. | 2 | "A `dispatchRewindCommand` test with no `.pipeline/HALT` and `build` `refused` targeting `build` asserts exit `1`, no `console.error` line containing `halt clear`, and byte-for-byte unchanged `conduct-state.json`." | diff-local |
| Story 2 happy: Given a plan-gap halt whose `conduct-state.json` records `last_step` `build` (raised by BUILD's plan-gap report), when the `daemon-triage` skill's classification table is applied, then its plan-gap guidance directs: amend the indicted artifact, reseal, then clear the halt in place with `ai-conductor halt clear --feature <slug> --rationale "<...>"`, and unpark only afterwards, explicitly. | 3 | "The `skills/daemon-triage/SKILL.md` classification table's plan-gap guidance names `last_step` `build` as the BUILD-origin case and directs, in order, amending the indicted artifact, resealing it, then clearing the halt in place with `ai-conductor halt clear --feature <slug> --rationale`, with unpark as a separate later explicit step." | diff-local |
| Story 2 negative: Given a plan-gap halt whose `last_step` is a step after `build` (raised by `prd_audit` or the as-built architecture review), when the `daemon-triage` skill's classification table is applied, then its plan-gap guidance still directs amend, reseal, and `ai-conductor rewind --to build`, and does not direct `halt clear` for that origin. | 3 | "The same guidance names the later-step origin (`prd_audit` or as-built review) and directs, in order, amending the indicted artifact, resealing it, then `ai-conductor rewind --to build` for it, and does not direct `halt clear` for that origin." | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
