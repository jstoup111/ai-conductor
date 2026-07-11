# Implementation Plan: TR-10 migration-gate waiver for non-breaking surface touches (fix #354)

**Date:** 2026-07-06
**Design:** .docs/decisions/adr-2026-07-06-migration-gate-waiver.md (APPROVED) +
.docs/architecture/2026-07-06-migration-gate-waiver.md
**Stories:** .docs/stories/self-host-release-gate-bin-conduct-breaking-surfac.md (Accepted)
**Conflict check:** Clean as of 2026-07-06 (one supersession annotated, #282 degrading overlap
accepted — see .docs/conflicts/2026-07-06-migration-gate-waiver.md)
**Tier:** M (see .docs/complexity/self-host-release-gate-bin-conduct-breaking-surfac.md)

## Summary

Adds a third satisfying condition to the TR-10 migration sub-gate: a committed, machine-checkable
no-breaking-surface waiver. 13 tasks, all inside `src/conductor/src/engine/self-host/release-gate.ts`
(+ its test file) plus repo docs. No changes under `skills/`, `hooks/`, `templates/`, HARNESS.md;
`version-signal.ts` untouched.

## Technical Approach

- **Canonical surface names become exported constants** (`BREAKING_SURFACE_NAMES`) in
  `release-gate.ts`; `classifyBreakingSurfaces` emits them and the waiver parser validates
  against them — drift is a test failure, not a silent mismatch.
- **Waiver discovery is from the change set, not a known path** (verified: `ReleaseGateOptions`
  carries no plan stem — only `projectRoot`, `harnessRoot`, `readText`, `changedFiles`). The gate
  scans the classified change set for paths matching `.docs/release-waivers/*.md` with status
  A/M. This makes W1 (freshness binding) structural: a stale waiver merged earlier lives in
  `base`, never appears in `base...HEAD`, and is therefore never discovered. The
  `<plan-stem>.md` filename remains an authoring convention for auditability, not a lookup key.
  Multiple in-diff waivers: all must parse; their surface sets union for W3.
- **Waiver format** parsed by a pure function into a typed result
  (`{ surfaces, rationale } | { malformed, detail }`): a `Waives:` list of canonical names +
  non-empty rationale prose. Mirrors the `hasRunnableMigrationBlock` regex-contract style.
- **Evaluation order inside TR-10** (per ADR + #282 coordination note): condition 1
  (no surfaces, determinable) → condition 2 (runnable migration block) → condition 3 (valid
  waiver) → not-ok. W4: a null change set short-circuits to today's fail-closed reason before
  any waiver logic (and its HALT text does NOT advertise the waiver). Every not-ok branch calls
  the injected `writeHalt` (invariant side-effect).
- **Sequencing:** constants → parser → discovery → waiver evaluation → gate integration →
  HALT-reason text → docs. Hermetic tests throughout via existing seams
  (`readText`, `changedFiles`, `writeHalt` injection) in
  `src/conductor/test/engine/self-host/release-gate.test.ts`.

## Prerequisites

- `npm install` inside the build worktree's `src/conductor` (per-worktree, not shared).
- Run tests with `rtk proxy npx vitest run` (RTK swallows raw vitest output).

## Tasks

### Task 1: Export canonical breaking-surface name constants
**Story:** "Waiver format parses…" — drift-guard criterion
**Type:** infrastructure

**Steps:**
1. Write failing test: `BREAKING_SURFACE_NAMES` is exported from `release-gate.ts` and
   `classifyBreakingSurfaces` output for a fixture touching all four surfaces is a subset of it.
2. Verify RED. 3. Implement: extract the four literals (`bin/conduct CLI`, `skill symlink
   targets`, `hook wiring`, `settings.json schema`) into an exported `const` set; replace inline
   strings in `classifyBreakingSurfaces`. 4. GREEN. 5. Commit "feat(self-host): export canonical
   breaking-surface names".

**Files likely touched:**
- `src/conductor/src/engine/self-host/release-gate.ts` — constants + classifier refactor
- `src/conductor/test/engine/self-host/release-gate.test.ts` — identity test

**Dependencies:** none

### Task 2: Waiver parser — happy paths
**Story:** "Waiver format parses…" — both happy criteria
**Type:** happy-path

**Steps:**
1. Failing tests: `parseWaiver(text)` on a single-surface waiver (`Waives:` list with
   `bin/conduct CLI`, rationale paragraph) yields exactly that surface set + rationale;
   multi-surface waiver yields both names order-independently.
2. RED. 3. Implement `parseWaiver` (pure, regex/line-based like `extractUnreleasedBody`).
4. GREEN. 5. Commit "feat(self-host): waiver parser happy paths".

**Files likely touched:** same two files.
**Dependencies:** Task 1

### Task 3: Waiver parser — malformed negatives
**Story:** "Waiver format parses…" — all four negative criteria
**Type:** negative-path

**Steps:**
1. Failing tests: unknown name `bin/conduct` → malformed naming the unknown string; empty/
   whitespace rationale → malformed (rationale mandatory); no `Waives:` line → malformed (never
   "waives everything/nothing").
2. RED. 3. Implement typed malformed results with specific `detail`. 4. GREEN.
5. Commit "feat(self-host): waiver parser rejects malformed waivers".

**Dependencies:** Task 2

### Task 4: Waiver discovery from the change set (W1 structural)
**Story:** "Valid waiver satisfies TR-10…" — stale-waiver negative
**Type:** infrastructure

**Steps:**
1. Failing tests: `findWaiverPaths(changed)` returns paths under `.docs/release-waivers/`
   with status A/M; ignores D-status and unrelated paths; empty when no waiver in diff (stale
   waiver on disk but absent from `changed` is simply not found).
2. RED. 3. Implement over `ChangedFile[]` (reuse rename-aware path iteration).
4. GREEN. 5. Commit "feat(self-host): discover in-diff waiver files".

**Dependencies:** Task 1

### Task 5: Waiver evaluation — valid waiver covers surfaces
**Story:** "Valid waiver satisfies TR-10…" — happy criteria 1–2
**Type:** happy-path

**Steps:**
1. Failing tests: `evaluateWaiver({ changed, surfaces, readText })` with an in-diff waiver
   covering the classified set → valid; multi-surface change + waiver covering both → valid;
   multiple in-diff waivers union for coverage.
2. RED. 3. Implement: discover (Task 4) → parse each (Tasks 2–3) → union → superset check.
4. GREEN. 5. Commit "feat(self-host): waiver evaluation happy paths".

**Dependencies:** Tasks 3, 4

### Task 6: Waiver evaluation — coverage and malformed negatives (W2, W3)
**Story:** "Valid waiver satisfies TR-10…" — partial-coverage + malformed negatives
**Type:** negative-path

**Steps:**
1. Failing tests: waiver waives `bin/conduct CLI` but diff also classifies `hook wiring` →
   invalid, detail names the uncovered surface; any in-diff waiver malformed → invalid with the
   parser's detail (never silently degrades to "no waiver").
2. RED. 3. Implement invalid-result details. 4. GREEN.
5. Commit "feat(self-host): waiver evaluation negative paths".

**Dependencies:** Task 5

### Task 7: Gate integration — condition 3 in TR-10
**Story:** "Valid waiver satisfies TR-10…" — happy criteria 1–3
**Type:** happy-path, integration point

**Steps:**
1. Failing tests through `runReleaseArtifactGate`: breaking surface + in-diff valid waiver + no
   migration block → `{ok:true}`, `writeHalt` NOT called; breaking surface + runnable block +
   no waiver → `{ok:true}` (condition 2 regression); no breaking surface → `{ok:true}` with a
   stray on-disk waiver (condition 1, waiver irrelevant — containment story negative).
2. RED. 3. Implement: thread waiver evaluation into the TR-10 branch after
   `hasRunnableMigrationBlock`, before the not-ok verdict. 4. GREEN.
5. Commit "feat(self-host): TR-10 accepts a valid committed waiver".

**Dependencies:** Task 6

### Task 8: Gate fall-through negatives write HALT with specific reasons
**Story:** "Valid waiver satisfies TR-10…" — stale/partial/malformed + HALT-side-effect criteria
**Type:** negative-path

**Steps:**
1. Failing tests through `runReleaseArtifactGate` with a `writeHalt` spy: stale waiver (on disk,
   not in diff) → not-ok, reason states the waiver was not committed with this change set;
   partial coverage → reason names uncovered surface; malformed → reason carries parser detail;
   EVERY not-ok TR-10 branch invoked exactly one `writeHalt` call with the full reason.
2. RED. 3. Implement reason composition. 4. GREEN.
5. Commit "feat(self-host): waiver fall-through HALTs with specific reasons".

**Dependencies:** Task 7

### Task 9: W4 — uncertain change set unwaivable; empty ≠ null
**Story:** "Uncertain change set remains unwaivable" — all criteria
**Type:** negative-path

**Steps:**
1. Failing tests: `changedFiles()` → null with a well-formed waiver on disk → not-ok, reason
   cites undeterminable change set (not waiver invalidity) and does NOT mention the waiver
   option; `changedFiles()` → `[]` → `{ok:true}` via condition 1.
2. RED. 3. Implement: null short-circuits before waiver logic (existing `uncertain` path;
   assert ordering). 4. GREEN. 5. Commit "test(self-host): uncertain diff stays unwaivable".

**Dependencies:** Task 7

### Task 10: HALT reason teaches the waiver path (HR)
**Story:** "HALT reason teaches the waiver remediation path" — both criteria
**Type:** happy-path

**Steps:**
1. Failing tests: breaking surface + no block + no waiver → reason includes the classified
   surfaces, the ```bash migration``` option, AND `.docs/release-waivers/<plan-stem>.md` with
   the internal-only applicability condition; uncertain-diff reason omits the waiver mention
   (already asserted in Task 9 — extend with the positive-case substring assertions).
2. RED. 3. Implement `evaluateMigration` reason text. 4. GREEN.
5. Commit "feat(self-host): migration HALT reason names the waiver option".

**Dependencies:** Task 8

### Task 11: Containment regression sweep
**Story:** "Containment — consumer pipelines…" — all criteria
**Type:** negative-path

**Steps:**
1. Run the full existing self-host suite unmodified (`rtk proxy npx vitest run` scoped to
   `test/engine/self-host/`) — all prior TR-7/8/9/10 + wiring/activation tests must pass
   without edits (gate activation predicate untouched).
2. Assert via `git diff --stat` that no files under `skills/`, `hooks/`, `templates/`, or
   `HARNESS.md` changed, and `version-signal.ts` is untouched.
3. Commit only if a fix was needed (otherwise evidence-only step recorded in task status).

**Dependencies:** Tasks 7–10

### Task 12: Docs — CLAUDE.md, READMEs, CHANGELOG
**Story:** "Authoring guidance documented…" — all criteria
**Type:** infrastructure

**Steps:**
1. CLAUDE.md "Release & Update Gates": add the waiver clause — path, `Waives:` + rationale
   format, canonical names, internal-only applicability, and the explicit "NEVER waive a real
   subcommand/flag/behavior, hook-contract, or settings-schema change" rule.
2. README.md + src/conductor/README.md: mention the waiver condition in the self-host gate
   description (docs-track-features).
3. CHANGELOG `[Unreleased]` → Added: waiver condition for TR-10 (fix #354). No `## Migration`
   block — this change is itself internal-only (gate consumes a new optional artifact; no
   consumer surface changes). Note: per this very feature, the implementation build may attach
   a waiver naming `bin/conduct CLI` ONLY if its diff somehow touches a classified surface;
   expected surfaces for this change: none (src/conductor + docs are not classified surfaces).
4. Commit "docs: waiver authoring guidance + changelog".

**Dependencies:** Task 10

### Task 13: Full verification
**Story:** all — Done When aggregation
**Type:** infrastructure

**Steps:**
1. `rtk proxy npx vitest run` (full `src/conductor` suite) — green.
2. `test/test_harness_integrity.sh` — green (repo validation rule).
3. Confirm every story "Done When" checkbox has supporting evidence; record in
   `.pipeline/task-status.json` per harness convention.

**Dependencies:** Tasks 11, 12

## Task Dependency Graph

```
1 ─┬─ 2 ── 3 ─┐
   └─ 4 ──────┴─ 5 ── 6 ── 7 ─┬─ 8 ── 10 ── 12 ─┐
                              ├─ 9 ─────────────┤
                              └─ 11 ────────────┴─ 13
```

## Integration Points

- After Task 7: TR-10 end-to-end passes/fails correctly with waivers through
  `runReleaseArtifactGate` (hermetic).
- After Task 11: whole self-host gate bundle verified regression-free.

## Coverage Mapping

| Story criterion | Task(s) |
|---|---|
| Parser happy (single/multi surface) | 2 |
| Parser negatives (unknown name / empty rationale / no list / drift guard) | 3, 1 |
| Valid waiver passes TR-10 (single/multi) | 5, 7 |
| Migration block still passes without waiver | 7 |
| Partial coverage HALTs naming uncovered surface | 6, 8 |
| Stale waiver ignored (W1) | 4, 8 |
| Malformed waiver never silently passes/degrades | 6, 8 |
| HALT written on every not-ok branch | 8 |
| Uncertain + waiver → fail-closed, reason cites undeterminable | 9 |
| Empty vs null change set not conflated | 9 |
| HALT reason names both options; omits waiver when uncertain | 10, 9 |
| selfHost=false / stray waiver inert / no skills-hooks-templates-HARNESS.md changes | 7, 11 |
| CLAUDE.md + README + CHANGELOG | 12 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
