# Implementation Plan: The SHIP tail authors the release waiver the release gate validates (#2230)

**Date:** 2026-09-22
**Design:** .docs/architecture/release-gate-halts-a-finished-build-for-a-waiver-m.md
**Architecture review:** .docs/decisions/architecture-review-2026-09-22-release-gate-halts-a-finished-build-for-a-waiver-m.md
**Stories:** .docs/stories/release-gate-halts-a-finished-build-for-a-waiver-m.md
**Conflict check:** Clean as of 2026-09-22 (two degrading conflicts resolved in the stories)

## Summary

Teach the repository-local `release-disposition` SHIP step to record one closed surface verdict for the real feature diff and, for an internal-only breaking surface, commit the release waiver the unchanged TR-10 gate validates, so an internal-only hooks/ touch reaches finish without an operator halt. Seven tasks: four red-first contract edits to the skill and its contract test, and three verify-only pins of the unchanged gate and finish wiring.

## Technical Approach

- **Only the skill contract changes (Tasks 1-4).** `.agents/skills/release-disposition/SKILL.md` is the canonical file; `.claude/skills/release-disposition` is a symlink to it, so the existing byte-identical assertion stays green. Each rule lands with a regex assertion in `src/conductor/test/engine/release-disposition-contract.test.ts` that fails against today's text first, following that file's existing `expect({...}).toEqual({...})` shape over `readFile(join(canonicalDir, 'SKILL.md'))`. No engine file changes: the verdict is judgement recorded in the step's review evidence (adr-2026-07-06 D4), and the pass marker keeps its presence-and-freshness contract (adr-2026-07-25-custom-step-completion-artifacts).
- **Commit ordering precedent.** `.agents/skills/maintain-documentation/SKILL.md`, one step earlier in the same tail and also codex-routed, already commits before PASS and makes no commit for a no-op. Task 2 mirrors that ordering. `.docs/release-waivers/` is on `DOCS_WRITE_ALWAYS_ALLOWED` in `phase-marker.ts`, and a docs-only delta after rebase preserves prior gate verdicts, so the commit needs no new permission.
- **Gate unchanged, pinned (Tasks 5-7).** `runReleaseArtifactGate` in `release-gate.ts` and `runSelfHostFinishGates` in `conductor.ts` are not edited. The verify-only tasks add pins for the #2230 shapes (hooks/ edit + waiver; two surfaces; partial coverage; stale base waiver; non-runnable fence; unclassifiable halt text) next to the existing waiver and structured-metadata cases, and wiring pins through the real gate for finish dispatch and non-dispatch. Search hints: `accepts a fresh waiver that covers the classified breaking surface`, `empty [Unreleased] passes through the real release gate and dispatches finish`, `HALTs before finish when release metadata has %s`.
- **Scope boundary.** No change to `classifyBreakingSurfaces`, `version-signal.ts`, consumer pipelines, or plan-time waiver authoring (track marker).

## Prerequisites

- The amendment D4-D6 to `adr-2026-07-06-migration-gate-waiver` is on the spec branch (landed with this plan).

## Tasks

### Task 1: The release-disposition contract records one closed surface verdict
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: extend `src/conductor/test/engine/release-disposition-contract.test.ts` with an assertion that the skill requires exactly one `Surface-Verdict:` line in `.pipeline/release-disposition-review.md` whose value is one of `none`, `migration`, `waiver`, `unclassifiable`, and that a `none` verdict commits no waiver. Keep the existing byte-identical Claude-link assertion green (the `.claude/skills/release-disposition` link resolves to the canonical file, so only the canonical file is edited).
2. Verify the new assertion fails against the current skill text (RED).
3. Implement: add a surface-verdict step to `.agents/skills/release-disposition/SKILL.md` after the diff is read (step 2): classify the diff's breaking surfaces with the same canonical names the release gate uses (`bin/conduct CLI`, `skill symlink targets`, `hook wiring`, `settings.json schema`), record exactly one `Surface-Verdict:` line with a value from the closed set, and state that `none` (no classified breaking surface) authors no waiver and no migration block.
4. Verify the contract test passes (GREEN).
5. Commit with message: "feat(release-disposition): record one closed surface verdict"

**Done when:**
- `release-disposition-contract.test.ts` asserts the skill requires exactly one `Surface-Verdict:` line in `.pipeline/release-disposition-review.md` whose value is one of `none`, `migration`, `waiver`, `unclassifiable`, and that assertion fails against the pre-change skill text
- `release-disposition-contract.test.ts` asserts the skill directs a `none` verdict, recorded when the diff has no classified breaking surface, to commit no waiver and author no migration block
- the existing `release-disposition-contract.test.ts` assertions (byte-identical Claude link, gating config before finish, PR body authority, PASS-only marker) still pass unchanged

**Files likely touched:**
- .agents/skills/release-disposition/SKILL.md
- src/conductor/test/engine/release-disposition-contract.test.ts

**Dependencies:** none

### Task 2: A waiver verdict leaves exactly one committed waiver before PASS
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: extend `src/conductor/test/engine/release-disposition-contract.test.ts` with assertions that a `waiver` verdict writes the waiver for the plan stem under `.docs/release-waivers/` with a `Waives:` line listing every classified canonical surface and a non-empty `Rationale:`, commits it before `.pipeline/release-disposition-pass`, reports BLOCKED with the pass marker absent when the commit fails, reuses an in-diff waiver that already covers every surface (nothing to commit is success, no second file), amends and commits that same in-diff file when it misses a surface, and commits a fresh waiver in this diff when one exists only on the base branch.
2. Verify the new assertions fail against the current skill text (RED).
3. Implement: in `.agents/skills/release-disposition/SKILL.md`, replace the single sentence "An internal-only breaking-surface classifier result requires the repository's fresh release waiver instead of an invented migration." with a `waiver` procedure carrying each rule above, ordered so the commit (or the reuse check) precedes writing the pass marker. Precedent: `.agents/skills/maintain-documentation/SKILL.md` already commits in this SHIP tail before PASS and creates no commit for a no-op; mirror its "complete every required commit before writing the pass marker" ordering.
4. Verify the contract test passes (GREEN).
5. Commit with message: "feat(release-disposition): commit the release waiver before PASS"

**Done when:**
- `release-disposition-contract.test.ts` asserts the skill directs a `waiver` verdict to write the waiver for the feature plan stem under `.docs/release-waivers/` with a `Waives:` line listing every classified canonical surface name and a non-empty `Rationale:`, and to commit it to the feature branch before writing `.pipeline/release-disposition-pass`
- `release-disposition-contract.test.ts` asserts the skill directs a failed waiver commit to report BLOCKED with `.pipeline/release-disposition-pass` absent
- `release-disposition-contract.test.ts` asserts the skill directs reuse of a waiver already committed in the feature diff that lists every classified surface, adding no second waiver file and treating nothing-to-commit as success before writing the pass marker
- `release-disposition-contract.test.ts` asserts the skill directs amending and committing the same in-diff waiver file when it omits a classified surface so the feature diff contains exactly one waiver, and directs committing the waiver in this feature diff when a waiver for the plan stem exists only on the base branch

**Files likely touched:**
- .agents/skills/release-disposition/SKILL.md
- src/conductor/test/engine/release-disposition-contract.test.ts

**Dependencies:** 1

### Task 3: A migration verdict writes a runnable block and never a waiver
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: extend `src/conductor/test/engine/release-disposition-contract.test.ts` with assertions that a `migration` verdict writes a `note` disposition with a runnable `bash migration` block under `## Migration` in the retained draft PR body and adds or modifies no waiver file, and that a `bin/conduct` subcommand, flag, or behavior change, a hook contract change, or a `settings.json` schema change is never judged `waiver` (it is `migration`, or `unclassifiable` when the consumer action cannot be determined).
2. Verify the new assertions fail against the current skill text (RED).
3. Implement: in `.agents/skills/release-disposition/SKILL.md` step 5, bind the existing runnable-migration instruction to the `migration` verdict, add the no-waiver rule for that verdict, and add the never-waiver list (which restates the waiver ADR amendment and the existing authoring guidance rather than inventing a new rule).
4. Verify the contract test passes (GREEN).
5. Commit with message: "feat(release-disposition): keep consumer migrations off the waiver path"

**Done when:**
- `release-disposition-contract.test.ts` asserts the skill directs a `migration` verdict to write a `note` disposition with a runnable `bash migration` block under `## Migration` in the retained draft PR body and to add or modify no file under `.docs/release-waivers/`
- `release-disposition-contract.test.ts` asserts the skill forbids a `waiver` verdict for a `bin/conduct` subcommand, flag, or behavior change, a hook contract change, or a `settings.json` schema change, directing `migration` or, when the consumer action cannot be determined, `unclassifiable`

**Files likely touched:**
- .agents/skills/release-disposition/SKILL.md
- src/conductor/test/engine/release-disposition-contract.test.ts

**Dependencies:** 2

### Task 4: An unclassifiable or out-of-set verdict authors nothing
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: extend `src/conductor/test/engine/release-disposition-contract.test.ts` with assertions that an `unclassifiable` verdict authors neither a waiver nor a migration block, and that a recorded surface verdict outside the closed set reports BLOCKED with the pass marker absent.
2. Verify the new assertions fail against the current skill text (RED).
3. Implement: in `.agents/skills/release-disposition/SKILL.md`, add the `unclassifiable` rule (author nothing; the release gate then halts exactly as today) and the out-of-set rule to the BLOCKED conditions of steps 6-7.
4. Verify the contract test passes (GREEN).
5. Commit with message: "feat(release-disposition): leave unclassifiable surfaces to the release gate halt"

**Done when:**
- `release-disposition-contract.test.ts` asserts the skill directs an `unclassifiable` verdict to author neither a waiver nor a migration block
- `release-disposition-contract.test.ts` asserts the skill directs a recorded surface verdict outside `none`, `migration`, `waiver`, `unclassifiable` to report BLOCKED with `.pipeline/release-disposition-pass` absent

**Files likely touched:**
- .agents/skills/release-disposition/SKILL.md
- src/conductor/test/engine/release-disposition-contract.test.ts

**Dependencies:** 3

### Task 5: The release gate and finish accept a step-committed waiver
**Story:** 1
**Type:** verification

**Steps:**
1. Pin existing behavior (the gate is unchanged by this feature, so these pins pass on first run; that is the point of a verify-only task): in `src/conductor/test/engine/self-host/release-gate.test.ts` add cases for a modified `hooks/` script plus an added waiver listing `hook wiring`; a `hooks/` plus `bin/conduct` change set with an added waiver listing both surfaces; a waiver listing only `hook wiring` against a change set that also touches a `settings.json` file; and a `hooks/` change whose waiver exists on disk but is absent from the change set. Follow the neighbouring `accepts a fresh waiver that covers the classified breaking surface` case: inject `readText` and `changedFiles`, assert on the returned verdict and the `.pipeline/HALT` file.
2. In `src/conductor/test/engine/self-host/wiring.test.ts`, add a sibling of `empty [Unreleased] passes through the real release gate and dispatches finish` whose real release gate sees a modified `hooks/` script and an added waiver, and assert `finish` is dispatched and no `.pipeline/HALT` exists.
3. Run the two files and confirm every pin passes against unchanged production code.
4. Commit with message: "test(release-gate): pin step-committed waiver acceptance"

**Done when:**
- `release-gate.test.ts` pins that `runReleaseArtifactGate` returns `ok: true` and writes no `.pipeline/HALT` for a change set with a modified `hooks/` script plus an added waiver listing `hook wiring`, and returns `ok: true` for a `hooks/` plus `bin/conduct` change set with an added waiver listing both `hook wiring` and `bin/conduct CLI`
- `wiring.test.ts` pins that a self-build whose real release gate sees a modified `hooks/` script and an added waiver in its `base...HEAD` change set dispatches `finish` and leaves no `.pipeline/HALT`
- `release-gate.test.ts` pins that a waiver listing only `hook wiring` for a change set that also touches a `settings.json` file returns `ok: false` with a reason naming `settings.json schema` as uncovered
- `release-gate.test.ts` pins that a `hooks/` change whose waiver exists on disk but is absent from the change set returns `ok: false` with a reason stating the waiver is not committed with this change set
- the existing `release-gate.test.ts` case `a non-breaking change passes without an integrity script or HALT` still returns `ok: true` with no `.pipeline/HALT`

**Files likely touched:**
- src/conductor/test/engine/self-host/release-gate.test.ts
- src/conductor/test/engine/self-host/wiring.test.ts

**Verify-only:** yes

**Dependencies:** none

### Task 6: A runnable migration block passes and a non-runnable one halts before the gate
**Story:** 2
**Type:** verification

**Steps:**
1. Pin existing behavior: the existing `src/conductor/test/engine/self-host/release-gate.test.ts` case `accepts a parsed runnable migration from structured PR metadata without reading CHANGELOG` already proves a breaking change set with a runnable block and no waiver passes; cite it rather than duplicating it.
2. In `src/conductor/test/engine/self-host/wiring.test.ts`, add a `non-runnable migration fence` row to the `HALTs before finish when release metadata has %s` table whose draft body is a `note` disposition with a plain `bash` fence under `## Migration`, and assert the release gate is not called, `finish` is not dispatched, and `.pipeline/HALT` matches the malformed-disposition reason.
3. Run the file and confirm the new row passes against unchanged production code.
4. Commit with message: "test(release-gate): pin non-runnable migration fence halt"

**Done when:**
- the existing `release-gate.test.ts` case `accepts a parsed runnable migration from structured PR metadata without reading CHANGELOG` returns `ok: true` for a breaking `bin/conduct` change set with a runnable migration block and no waiver, writing no HALT
- `wiring.test.ts` pins that a retained draft PR body with a `note` disposition whose `## Migration` section has only a non-runnable fence HALTs before finish with the malformed-release-disposition reason, `releaseGate` is not called, and `finish` is not dispatched

**Files likely touched:**
- src/conductor/test/engine/self-host/wiring.test.ts

**Verify-only:** yes

**Dependencies:** 5

### Task 7: An unclassifiable outcome halts exactly as today
**Story:** 3
**Type:** verification

**Steps:**
1. Pin existing behavior: in `src/conductor/test/engine/self-host/release-gate.test.ts` add a case for a modified `hooks/` script with no migration block and no waiver whose returned reason equals the migration-block-required text for `hook wiring` followed by the missing-waiver text, and assert `.pipeline/HALT` carries it.
2. In `src/conductor/test/engine/self-host/wiring.test.ts`, add a sibling of the real-release-gate finish case whose gate sees a modified `hooks/` script with no migration block and no waiver, and assert `finish` is not dispatched, `.pipeline/HALT` carries the migration-block-required reason, and `.pipeline/HALT.class` reads `needs-human`.
3. Cite the existing `src/conductor/test/engine/self-host/release-gate.test.ts` cases `rejects an uncertain change set without reading a waiver` and `empty [Unreleased] does not bypass fail-closed migration when changes are uncertain` for the null change set.
4. Run the two files and confirm every pin passes against unchanged production code.
5. Commit with message: "test(release-gate): pin the unchanged unclassifiable halt"

**Done when:**
- `release-gate.test.ts` pins that a change set with a modified `hooks/` script, no migration block, and no waiver returns `ok: false` with a reason equal to the migration-block-required text naming `hook wiring` followed by the missing-waiver text, and writes that reason to `.pipeline/HALT`
- `wiring.test.ts` pins that a self-build whose real release gate sees a modified `hooks/` script with no migration block and no waiver does not dispatch `finish` and leaves `.pipeline/HALT` carrying the migration-block-required reason with `.pipeline/HALT.class` reading `needs-human`
- the existing `release-gate.test.ts` cases pin that a null change set returns `ok: false` with a fail-closed reason that does not mention waivers, without reading any waiver file, and writes a `.pipeline/HALT` naming the fail-closed cause

**Files likely touched:**
- src/conductor/test/engine/self-host/release-gate.test.ts
- src/conductor/test/engine/self-host/wiring.test.ts

**Verify-only:** yes

**Dependencies:** 6

## Task Dependency Graph

```text
Task 1 ──► Task 2 ──► Task 3 ──► Task 4   (serial: all four edit the same skill and contract test)
Task 5 ──► Task 6 ──► Task 7   (serial: verify-only pins sharing the gate and wiring test files; independent of Tasks 1-4)
```

## Integration Points

- After Task 2: a self-host SHIP tail dispatching `release-disposition` has a complete waiver-authoring contract; Task 5's wiring pin proves the real gate admits the waiver it produces and dispatches finish.
- Task 5 owns the cross-boundary proof (conductor finish gates → real `runReleaseArtifactGate` → finish dispatch); Task 7 owns the non-dispatch proof.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a self-host feature diff whose only classified breaking surface is an edit to an already-wired hook script that changes no hook contract or wiring, when `release-disposition` runs, then it records the surface verdict `waiver`, commits a waiver for the feature's plan stem that lists `hook wiring` with a non-empty rationale, and writes its pass marker only after that commit exists on the feature branch. | 1, 2 | "`release-disposition-contract.test.ts` asserts the skill directs a `waiver` verdict to write the waiver for the feature plan stem under `.docs/release-waivers/` with a `Waives:` line listing every classified canonical surface name and a non-empty `Rationale:`, and to commit it to the feature branch before writing `.pipeline/release-disposition-pass`" | diff-local |
| Story 1 happy: Given the waiver was committed by `release-disposition`, when the release gate runs before finish, then the gate passes on the waiver without writing a HALT and finish is dispatched, with the waiver file present in the feature's `base...HEAD` diff for operator review before merge. | 5 | "`wiring.test.ts` pins that a self-build whose real release gate sees a modified `hooks/` script and an added waiver in its `base...HEAD` change set dispatches `finish` and leaves no `.pipeline/HALT`" | diff-local |
| Story 1 happy: Given a diff whose classified breaking surfaces are `hook wiring` and `bin/conduct CLI`, where the hook edit changes no contract or wiring and the `bin/conduct` edit deletes only a private helper with no subcommand, flag, or behavior change, when `release-disposition` records `waiver`, then the committed waiver lists both canonical surface names and the release gate passes. | 2, 5 | "`release-gate.test.ts` pins that `runReleaseArtifactGate` returns `ok: true` and writes no `.pipeline/HALT` for a change set with a modified `hooks/` script plus an added waiver listing `hook wiring`, and returns `ok: true` for a `hooks/` plus `bin/conduct` change set with an added waiver listing both `hook wiring` and `bin/conduct CLI`" | diff-local |
| Story 1 happy: Given the feature diff already contains a committed waiver that lists every classified surface with a non-empty rationale, when `release-disposition` records `waiver`, then it adds no second waiver, treats nothing-to-commit as success, writes its pass marker, and the release gate passes on that waiver. | 2, 5 | "`release-disposition-contract.test.ts` asserts the skill directs reuse of a waiver already committed in the feature diff that lists every classified surface, adding no second waiver file and treating nothing-to-commit as success before writing the pass marker" | diff-local |
| Story 1 negative: Given `release-disposition` wrote the waiver file but its commit failed, when the step finishes, then it reports BLOCKED, leaves the pass marker absent, and the feature does not reach finish. | 2 | "`release-disposition-contract.test.ts` asserts the skill directs a failed waiver commit to report BLOCKED with `.pipeline/release-disposition-pass` absent" | diff-local |
| Story 1 negative: Given a committed waiver that lists only `hook wiring` while the diff also touches `settings.json schema`, when the release gate runs, then it halts naming `settings.json schema` as uncovered and finish is not dispatched. | 5, 7 | "`release-gate.test.ts` pins that a waiver listing only `hook wiring` for a change set that also touches a `settings.json` file returns `ok: false` with a reason naming `settings.json schema` as uncovered" | diff-local |
| Story 1 negative: Given the feature diff already contains a committed waiver that omits a classified surface, when `release-disposition` records `waiver`, then it amends and commits that same waiver file to list every classified surface instead of adding a second waiver file, and the feature diff contains exactly one waiver. | 2 | "`release-disposition-contract.test.ts` asserts the skill directs amending and committing the same in-diff waiver file when it omits a classified surface so the feature diff contains exactly one waiver, and directs committing the waiver in this feature diff when a waiver for the plan stem exists only on the base branch" | diff-local |
| Story 1 negative: Given a waiver for the same plan stem already exists on the base branch from an earlier merge, when this feature's `release-disposition` records `waiver`, then it commits the waiver in this feature's diff, and without that commit the release gate halts as not committed with this change set. | 2, 5 | "`release-gate.test.ts` pins that a `hooks/` change whose waiver exists on disk but is absent from the change set returns `ok: false` with a reason stating the waiver is not committed with this change set" | diff-local |
| Story 1 negative: Given a feature diff with no classified breaking surface, when `release-disposition` runs, then it records `none`, commits no waiver, and the release gate passes. | 1, 5 | "`release-disposition-contract.test.ts` asserts the skill directs a `none` verdict, recorded when the diff has no classified breaking surface, to commit no waiver and author no migration block" | diff-local |
| Story 2 happy: Given a self-host feature diff that changes a breaking surface consumers must act on, when `release-disposition` runs, then it records `migration`, writes a `note` disposition with a runnable `bash migration` block under `## Migration` in the retained draft PR body, and commits no waiver. | 1, 3 | "`release-disposition-contract.test.ts` asserts the skill directs a `migration` verdict to write a `note` disposition with a runnable `bash migration` block under `## Migration` in the retained draft PR body and to add or modify no file under `.docs/release-waivers/`" | diff-local |
| Story 2 happy: Given that migration block is in the retained draft PR body, when the release gate runs before finish, then it passes without a HALT. | 6 | "the existing `release-gate.test.ts` case `accepts a parsed runnable migration from structured PR metadata without reading CHANGELOG` returns `ok: true` for a breaking `bin/conduct` change set with a runnable migration block and no waiver, writing no HALT" | diff-local |
| Story 2 negative: Given `release-disposition` records `migration`, when the step finishes, then no file under `.docs/release-waivers/` is added or modified in the feature diff by that step. | 3 | "`release-disposition-contract.test.ts` asserts the skill directs a `migration` verdict to write a `note` disposition with a runnable `bash migration` block under `## Migration` in the retained draft PR body and to add or modify no file under `.docs/release-waivers/`" | diff-local |
| Story 2 negative: Given a feature diff that changes a `bin/conduct` subcommand, flag, or behavior, a hook contract, or a `settings.json` schema, when `release-disposition` runs, then it records `migration`, or `unclassifiable` when it cannot determine the consumer action, and never records `waiver`. | 3 | "`release-disposition-contract.test.ts` asserts the skill forbids a `waiver` verdict for a `bin/conduct` subcommand, flag, or behavior change, a hook contract change, or a `settings.json` schema change, directing `migration` or, when the consumer action cannot be determined, `unclassifiable`" | diff-local |
| Story 2 negative: Given the retained draft PR body carries a `note` disposition whose `## Migration` section has no runnable `bash migration` fence and no waiver is committed, when the SHIP tail reaches the release gate before finish, then it halts with the malformed-release-disposition reason, the release gate is not evaluated, and finish is not dispatched. | 6 | "`wiring.test.ts` pins that a retained draft PR body with a `note` disposition whose `## Migration` section has only a non-runnable fence HALTs before finish with the malformed-release-disposition reason, `releaseGate` is not called, and `finish` is not dispatched" | diff-local |
| Story 3 happy: Given a self-host feature diff with a classified breaking surface and no waiver committed in the feature diff, that `release-disposition` cannot confidently judge internal-only or consumer-facing, when the step runs, then it records `unclassifiable` and authors neither a waiver nor a migration block. | 1, 4 | "`release-disposition-contract.test.ts` asserts the skill directs an `unclassifiable` verdict to author neither a waiver nor a migration block" | diff-local |
| Story 3 happy: Given that `unclassifiable` outcome, when the release gate runs before finish, then it writes the same needs-human HALT with the same migration-block-required and missing-waiver reason it writes today, and finish is not dispatched. | 7 | "`release-gate.test.ts` pins that a change set with a modified `hooks/` script, no migration block, and no waiver returns `ok: false` with a reason equal to the migration-block-required text naming `hook wiring` followed by the missing-waiver text, and writes that reason to `.pipeline/HALT`" | diff-local |
| Story 3 negative: Given the feature's change set cannot be determined, when the release gate runs, then it halts fail-closed even if a waiver file is present, and the reason does not offer the waiver path. | 7 | "the existing `release-gate.test.ts` cases pin that a null change set returns `ok: false` with a fail-closed reason that does not mention waivers, without reading any waiver file, and writes a `.pipeline/HALT` naming the fail-closed cause" | diff-local |
| Story 3 negative: Given the step's review evidence records a surface verdict outside `none`, `migration`, `waiver`, `unclassifiable`, when the step finishes, then it reports BLOCKED and leaves the pass marker absent. | 4 | "`release-disposition-contract.test.ts` asserts the skill directs a recorded surface verdict outside `none`, `migration`, `waiver`, `unclassifiable` to report BLOCKED with `.pipeline/release-disposition-pass` absent" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-06-migration-gate-waiver#D1 | existing | none | `evaluateMigration` in `src/conductor/src/engine/self-host/release-gate.ts` returns `{ ok: true }` when no breaking surface is classified and the change set is not uncertain; this feature leaves it unchanged |
| adr-2026-07-06-migration-gate-waiver#D2 | existing | none | `runReleaseArtifactGate` passes on a runnable `bash migration` block from structured release metadata via `hasRunnableMigrationBlock`, covered by the existing release-gate test for structured PR metadata; unchanged here |
| adr-2026-07-06-migration-gate-waiver#D3 | existing | none | `evaluateWaiver` with `findWaiverInDiff` and `parseWaiver` in `release-gate.ts` enforce W1-W4 for a committed waiver; this feature authors waivers for that unchanged validator |
| adr-2026-07-06-migration-gate-waiver#D4 | task | task-1, task-4 | `release-disposition-contract.test.ts` asserts the skill requires exactly one `Surface-Verdict:` line in `.pipeline/release-disposition-review.md` whose value is one of `none`, `migration`, `waiver`, `unclassifiable`, and that assertion fails against the pre-change skill text |
| adr-2026-07-06-migration-gate-waiver#D5 | task | task-2, task-3 | `release-disposition-contract.test.ts` asserts the skill directs a `waiver` verdict to write the waiver for the feature plan stem under `.docs/release-waivers/` with a `Waives:` line listing every classified canonical surface name and a non-empty `Rationale:`, and to commit it to the feature branch before writing `.pipeline/release-disposition-pass` |
| adr-2026-07-06-migration-gate-waiver#D6 | task | task-4, task-7 | `release-disposition-contract.test.ts` asserts the skill directs an `unclassifiable` verdict to author neither a waiver nor a migration block |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
