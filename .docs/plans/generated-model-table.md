# Implementation Plan: Generated HARNESS.md Model-Selection Table

**Date:** 2026-07-03
**Design:** `.docs/decisions/adr-2026-07-03-generated-model-table-single-source.md` (APPROVED); review `.docs/decisions/architecture-review-2026-07-03-generated-model-table.md` (conditions C1–C3)
**Stories:** `.docs/stories/generated-model-table.md` (TS-1..TS-6, Accepted)
**Conflict check:** Clean as of 2026-07-03
**Tier:** M (`.docs/complexity/generated-model-table.md`)

## Summary

Build a typed-metadata + tsx generator that makes `src/conductor/src/engine` the single source
of the HARNESS.md Model Selection table, plus integrity-suite drift and SKILL.md-pin checks.
16 tasks.

## Technical Approach

- **Data layer first:** a new data-only module `src/conductor/src/engine/model-table-metadata.ts`
  exports `STEP_RATIONALE: Record<StepName, string>`, `EXTRA_MODEL_TABLE_ROWS`,
  `SKILL_STEP_MAP`, `PIN_EXEMPT_SKILLS`. No changes to `resolveStepConfig` or any runtime path.
- **Pure core, thin CLI:** table rendering (`renderModelTable`) and marker-region splicing
  (`spliceGeneratedRegion`) are pure functions in
  `src/conductor/src/tools/generate-model-table.ts`, unit-tested with vitest
  (`rtk proxy npx vitest run`); the same file's CLI entry handles `write` (default), `--check`,
  and `--pins`. Exit codes: 0 ok, 1 drift, 2 environment/marker error. Marker errors throw typed
  errors before any write (C2).
- **One bash/TS seam:** `bin/generate-model-table` resolves
  `src/conductor/node_modules/.bin/tsx` (exit 2 + "run npm install in src/conductor" if absent;
  never `npx`, never `tsup`/build — shared-dist hazard). The integrity suite only ever calls
  this wrapper.
- **Suite integration:** check 5a (drift) and 5b (pins) added to
  `test/test_harness_integrity.sh`; both gated on `src/conductor/node_modules` existing —
  absent → `warn_check` skip; present-but-broken toolchain (wrapper exit 2) → hard FAIL.
- **Sequencing:** metadata → pure renderer/splicer → CLI → wrapper (real-binary smoke, not just
  argv injection) → suite sections → regenerate HARNESS.md + docs. Every negative path from the
  stories is its own test task step, exercised with real adversarial inputs (mangled markers,
  disagreeing pins, corrupted JSON).

## Prerequisites

- `npm install` in `src/conductor` inside the build worktree (worktrees don't share
  node_modules).
- No dist rebuild at any point; the daemon may be running elsewhere.

## Tasks

### Task 1: Add tsx devDependency (C1)
**Story:** TS-2 Done-When (tsx in devDependencies)
**Type:** infrastructure
**Steps:**
1. Add `"tsx"` to `src/conductor/package.json` devDependencies (caret-pinned current major); run `npm install` in `src/conductor`.
2. Verify `src/conductor/node_modules/.bin/tsx` exists and `./node_modules/.bin/tsx --version` runs.
3. Commit: "chore(conductor): add tsx devDependency for source-run tooling"
**Files likely touched:** `src/conductor/package.json`, `src/conductor/package-lock.json`
**Dependencies:** none

### Task 2: STEP_RATIONALE metadata with completeness test
**Story:** TS-1 happy path 1; negative path 1 (compile-time enforcement)
**Type:** happy-path
**Steps:**
1. Write failing vitest: every key of `DEFAULT_STEP_MODELS` has a non-empty `STEP_RATIONALE` entry (import both; iterate keys). Also a type-level assertion (`satisfies Record<StepName, string>` + an `@ts-expect-error` fixture asserting a missing key fails typecheck).
2. RED.
3. Create `src/conductor/src/engine/model-table-metadata.ts` with `STEP_RATIONALE` populated from the existing `//` comments in `resolved-config.ts` + current HARNESS.md "Why" text for all 21 steps (including `complexity`, `architecture_review_as_built`).
4. GREEN. Remove the now-moved rationale comments from `resolved-config.ts` value lines (keep the header comment pointing at the metadata module).
5. Commit: "feat(conductor): STEP_RATIONALE typed metadata for model table"
**Files likely touched:** `src/conductor/src/engine/model-table-metadata.ts` (new), `src/conductor/src/engine/resolved-config.ts` (comments only), `src/conductor/test/model-table-metadata.test.ts` (new)
**Dependencies:** Task 1

### Task 3: EXTRA_MODEL_TABLE_ROWS + duplicate-name guard
**Story:** TS-1 happy path 2; negative path 3 (duplicate row name rejected)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing vitests: (a) every current non-engine HARNESS.md row name appears exactly once in `EXTRA_MODEL_TABLE_ROWS` (hardcode the expected name list from today's table: domain-reviewer, evaluator, code-review, debugging, simplify, engineer, conduct, pr, tdd-red, tdd-green, writing-system-tests, and the 10 cto-* agents — reconcile exact set against HARNESS.md during RED); (b) `assertNoDuplicateRowNames(engineRows, extraRows)` throws on a fixture where an extra row is named `plan`.
2. RED.
3. Implement `EXTRA_MODEL_TABLE_ROWS` (name, model text, rationale each) + the duplicate guard invoked by the renderer.
4. GREEN.
5. Commit: "feat(conductor): EXTRA_MODEL_TABLE_ROWS metadata + duplicate row guard"
**Files likely touched:** `model-table-metadata.ts`, `generate-model-table.ts` (guard location), tests
**Dependencies:** Task 2

### Task 4: SKILL_STEP_MAP + PIN_EXEMPT_SKILLS with real-skills test
**Story:** TS-1 happy path 3; negative path 2 (unmapped pinned skill fails)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing vitests: (a) scanning the real `skills/*/SKILL.md` files, every `model:` pin is in `SKILL_STEP_MAP` or `PIN_EXEMPT_SKILLS`; (b) `classifyPinnedSkill('made-up-skill', …)` on a fixture with a pin but no mapping/exemption returns a failure record naming the skill.
2. RED.
3. Implement the map (architecture-review→architecture_review, explore→explore, prd→prd, rebase→rebase, remediate→remediate, assess→assess, architecture-diagram→architecture_diagram, prd-audit→prd_audit, …) and exemptions (code-review, debugging, engineer, simplify — no engine step; inline rationale each).
4. GREEN.
5. Commit: "feat(conductor): skill→step map + pin exemptions"
**Files likely touched:** `model-table-metadata.ts`, tests
**Dependencies:** Task 2

### Task 5: Pure renderer — engine rows with tier suffixes
**Story:** TS-2 happy path 2 (row shape, tier suffixes, explicit complexity/as-built rows)
**Type:** happy-path
**Steps:**
1. Write failing vitests: `renderModelTable()` output contains a header `| Skill/Agent | Model | Effort | Why |`; row `plan` renders model `sonnet (S/M), fable (L)` and effort `medium (S), high (M), xhigh (L)`; row `conflict-check` renders `sonnet (S/M), fable (L)`; rows `complexity` and `architecture-review --as-built` present; extra rows render after engine rows.
2. RED.
3. Implement `renderModelTable` from `DEFAULT_STEP_MODELS/EFFORT/TIER_OVERRIDES` + metadata (display-name mapping snake→kebab, `build`→`pipeline`, `worktree`→`worktree-manager`, `acceptance_specs`→`writing-system-tests` per the ADR's naming mapping).
4. GREEN.
5. Commit: "feat(conductor): model-table renderer with tier suffixes"
**Files likely touched:** `src/conductor/src/tools/generate-model-table.ts` (new), `src/conductor/test/generate-model-table.test.ts` (new)
**Dependencies:** Tasks 2–4

### Task 6: Pure splicer — marker region replacement
**Story:** TS-2 happy path 1 (byte-identical outside region)
**Type:** happy-path
**Steps:**
1. Write failing vitest: `spliceGeneratedRegion(doc, table)` on a fixture doc replaces only the region between BEGIN/END markers; every byte outside (including markers, prose, interim-fallback blockquote) identical.
2. RED. 3. Implement. 4. GREEN.
5. Commit: "feat(conductor): generated-region splicer"
**Files likely touched:** `generate-model-table.ts`, tests
**Dependencies:** none (parallel with 2–5; pure string function)

### Task 7: Marker hard errors (C2)
**Story:** TS-2 negative paths 1–2 (missing BEGIN/END, END-before-BEGIN, duplicate BEGIN)
**Type:** negative-path
**Steps:**
1. Write failing vitests with four adversarial fixtures: no BEGIN; no END; END before BEGIN; two BEGINs. Each: splicer throws a typed `MarkerError` naming the defect; input doc object untouched.
2. RED. 3. Implement validation before any splice. 4. GREEN.
5. Commit: "feat(conductor): hard-error marker validation"
**Files likely touched:** `generate-model-table.ts`, tests
**Dependencies:** Task 6

### Task 8: CLI write mode + idempotency
**Story:** TS-2 happy paths 1, 3; TS-2 negative path 1 (file not modified on marker error)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing vitests (temp-dir HARNESS.md fixtures, CLI invoked in-process with injected paths): write mode rewrites region and returns 0; write→check sequence returns 0 (idempotent); on marker error exits 2 and fixture file byte-identical (assert on the error branch, not just happy path).
2. RED. 3. Implement CLI arg parsing (default write, `--check`, `--pins`) + file IO. 4. GREEN.
5. Commit: "feat(conductor): generate-model-table CLI write mode"
**Files likely touched:** `generate-model-table.ts`, tests
**Dependencies:** Tasks 5, 7

### Task 9: CLI --check mode — drift detection
**Story:** TS-3 all criteria
**Type:** happy-path + negative-path
**Steps:**
1. Write failing vitests: clean region → exit 0; in-region hand-edit (sonnet→opus) → exit 1 + unified diff + remediation command `bin/generate-model-table` in output; changed engine default (inject modified models record) → exit 1; trailing-whitespace/CRLF corruption → exit 1 (exact compare); before/after byte compare proves check never writes — including on the exit-1 branch.
2. RED. 3. Implement. 4. GREEN.
5. Commit: "feat(conductor): --check drift mode with exact diff"
**Files likely touched:** `generate-model-table.ts`, tests
**Dependencies:** Task 8

### Task 10: CLI --pins mode — JSON emission
**Story:** TS-4 happy path 1
**Type:** happy-path
**Steps:**
1. Write failing vitest: `--pins` emits JSON `{ "<skill>": { "expected": "<model>" } | { "exempt": true } }` for every mapped/exempt skill; expected value is the untiered engine default.
2. RED. 3. Implement. 4. GREEN.
5. Commit: "feat(conductor): --pins JSON emission"
**Files likely touched:** `generate-model-table.ts`, tests
**Dependencies:** Tasks 4, 8

### Task 11: bin/generate-model-table wrapper with real-binary smoke
**Story:** TS-2 happy path 4; TS-2 negative paths 3–4 (tsx missing → exit 2, no npx fallback; dist untouched)
**Type:** infrastructure + negative-path
**Steps:**
1. Write failing test (bash, `test/test_generate_model_table_wrapper.sh` or a vitest execa spec): running the real wrapper with tsx present → exit 0; with `node_modules/.bin/tsx` renamed away (temp copy of the tree or PATH shim) → exit 2 + "npm install" message; `grep -c 'npx\|tsup\|npm run build' bin/generate-model-table` = 0; stat `src/conductor/dist` mtimes before/after (both success and error runs) unchanged. Real-binary smoke, not argv injection only.
2. RED. 3. Implement wrapper (resolve repo root, exec local tsx with passthrough args, distinct exit codes). 4. GREEN. `bash -n` passes.
5. Commit: "feat: bin/generate-model-table wrapper (tsx-from-source, no dist rebuild)"
**Files likely touched:** `bin/generate-model-table` (new), smoke test file (new)
**Dependencies:** Tasks 8–10

### Task 12: Integrity check 5a — drift gate with degradation
**Story:** TS-5 happy paths 1–2; negative paths 1–3
**Type:** happy-path + negative-path
**Steps:**
1. Extend `test/test_harness_integrity.sh`: if `src/conductor/node_modules` absent → `warn_check "model-table checks skipped — run npm install in src/conductor"`; else run `bin/generate-model-table --check`; exit 1 → `assert` FAIL with remediation text; exit 2 → FAIL with environment text (installed-but-broken is a real failure); exit 0 → PASS. Section must not abort the suite (subsequent checks still run).
2. Verify by real runs: healthy pass; seeded drift (temp edit of HARNESS.md region) fails; renamed tsx binary fails with env message; renamed node_modules warns and suite exit unaffected. Restore all.
3. Commit: "test: integrity check 5a — model-table drift gate"
**Files likely touched:** `test/test_harness_integrity.sh`
**Dependencies:** Task 11

### Task 13: Integrity check 5b — pin agreement
**Story:** TS-4 happy path 2; negative paths 1–4
**Type:** happy-path + negative-path
**Steps:**
1. Extend suite: consume `bin/generate-model-table --pins` JSON; for each `skills/*/SKILL.md` with a `model:` line, compare against expected; disagreement → FAIL naming skill/pinned/expected; exempt → PASS; no `model:` line → skip silently; unparseable JSON → FAIL (fail closed, e.g. via `jq -e` guard or python fallback consistent with suite conventions).
2. Verify by real runs: current pins all pass; temp-edit `skills/explore/SKILL.md` to `sonnet` → fails naming explore/sonnet/fable; corrupt JSON via a stub wrapper on PATH → fails. Restore all.
3. Commit: "test: integrity check 5b — SKILL.md pin agreement"
**Files likely touched:** `test/test_harness_integrity.sh`
**Dependencies:** Tasks 10, 11

### Task 14: Markers + first regeneration of HARNESS.md
**Story:** TS-6 happy paths 1, 3; negative paths 1–2 (row accounting, prose survival)
**Type:** integration
**Steps:**
1. Insert BEGIN/END markers around the current table in HARNESS.md; run `bin/generate-model-table`; run `--check` → 0.
2. Diff old vs new table: assert every old row present under old or mapped name with its "Why" text carried into `STEP_RATIONALE`/`EXTRA_MODEL_TABLE_ROWS` (fold the architecture-review as-built prose note into the new explicit row); record the row accounting for the PR body. Verify "Two enforcement paths" prose + interim-fallback blockquote survive outside the region byte-identical.
3. Commit: "feat: HARNESS.md model table now generated (markers + regeneration)"
**Files likely touched:** `HARNESS.md`
**Dependencies:** Tasks 11, plus 12 recommended (gate exists) — hard dep: 11

### Task 15: Docs — HARNESS.md prose, CLAUDE.md suite list, CHANGELOG (C3)
**Story:** TS-6 happy path 2
**Type:** infrastructure
**Steps:**
1. HARNESS.md: replace "when you change one, change all three" prose with "edit `model-table-metadata.ts`/`resolved-config.ts` and run `bin/generate-model-table`; CI enforces drift + pins".
2. CLAUDE.md Validation Suite list: add checks 5a (table content drift) and 5b (SKILL.md pin agreement).
3. `CHANGELOG.md` `[Unreleased]` → Added: generator + integrity checks; Changed: HARNESS.md table now generated (new Effort column, explicit complexity/as-built rows).
4. Commit: "docs: generated model table — prose, validation list, changelog"
**Files likely touched:** `HARNESS.md`, `CLAUDE.md`, `CHANGELOG.md`
**Dependencies:** Task 14

### Task 16: Full verification sweep
**Story:** TS-6 happy path 3; TS-5 happy path 1
**Type:** integration
**Steps:**
1. `rtk proxy npx vitest run` in `src/conductor` — green.
2. `src/conductor: npm run typecheck` — green.
3. `test/test_harness_integrity.sh` — all sections green (with node_modules present).
4. Re-run `bin/generate-model-table --check` — exit 0.
5. Commit any stragglers; assemble PR body with row accounting from Task 14.
**Dependencies:** Tasks 12–15

## Task Dependency Graph

```
T1 ──▶ T2 ──▶ T3 ─┐
        │         ├─▶ T5 ─┐
        └──▶ T4 ──┘       ├─▶ T8 ─▶ T9 ─┐
T6 ─▶ T7 ─────────────────┘            │
                    T4 ─────▶ T10 ◀────┘ (T10 needs T4+T8)
T8,T9,T10 ─▶ T11 ─▶ T12 ─▶ T14 ─▶ T15 ─▶ T16
             T11 ─▶ T13 ──────────────▶ T16
```

## Integration Points

- After Task 8: generator runs end-to-end against a fixture HARNESS.md.
- After Task 11: real `bin/generate-model-table --check` runnable against the repo (will report
  drift until Task 14 inserts markers — expected).
- After Task 14: repo self-consistent; drift gate meaningful.

## Coverage

| Criterion | Tasks |
|---|---|
| TS-1 happy 1–3 / neg 1–3 | T2, T3, T4 (neg 3 guard in T3) |
| TS-2 happy 1–4 | T6, T5, T8, T11 |
| TS-2 neg 1–4 | T7+T8 (marker errors, file untouched), T11 (tsx missing, no npx, dist untouched incl. error branches) |
| TS-3 all | T9 |
| TS-4 happy 1–2 / neg 1–4 | T10, T13 |
| TS-5 all | T12 (+T13 for pin-side), suite non-abort in T12 |
| TS-6 all | T14, T15, T16 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by explicit tasks with real adversarial inputs
- [ ] No task exceeds ~5 minutes
- [ ] Dependencies explicit and acyclic
- [ ] 16 tasks — within normal range
