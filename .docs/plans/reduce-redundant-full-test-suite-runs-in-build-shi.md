# Plan: reduce redundant full test-suite runs in build/ship pipeline (#588, S)

Tier: S. Track: technical. Source: jstoup111/ai-conductor#588.

Conductor paths are relative to `src/conductor/`; skill/ADR paths are repo-root relative.
Tests live under `src/conductor/test/…`, never beside source (#538 lesson).

Design key: the FULL suite runs authoritatively at CI (`.github/workflows/ci.yml`
`conductor` job) and at most once in-pipeline at finish. Every intermediate step is scoped
to the affected/mapped tests. The build_review completion gate is the verdict JSON
predicate (`CUSTOM_COMPLETION_PREDICATES.build_review`) with a diff-honesty rubric judged
statically from the diff (ADR-2026-07-07 §54-56, which labels execution "a future dial") —
so narrowing the grader's own test run to the diff's scoped tests changes no gate
semantics. The grader already receives the full feature diff
(`src/engine/build-review-inputs.ts:70`), so the diff's own test files are derivable.

Non-goals: manual_test (`skills/manual-test/SKILL.md`) runs endpoints/UI, not the unit
suite — untouched. CI (`.github/workflows/ci.yml`) — untouched, remains authoritative.

---

### Task 1: Scope the build_review grader prompt to the diff's own tests

**Story:** Story 1 (grader runs scoped tests, rubric/verdict unchanged), Story 2 (gate
not weakened).
**Type:** feature (behavioral change to the grader instruction).
**Steps:**
- RED: in `test/engine/build-review-prompt.test.ts`, replace the assertion at ~`:46-49`
  (`it('instructs the grader to run the project test suite itself')` →
  `expect(prompt).toMatch(/run the project's test suite/i)`) with the new contract: the
  prompt instructs the grader to run only the SCOPED tests the diff touches/adds (e.g.
  `expect(prompt).toMatch(/scoped tests?/i)` AND
  `expect(prompt).not.toMatch(/run the project's (full |entire )?test suite/i)`). Keep the
  existing verdict-schema and rubric assertions untouched to prove those are unchanged.
- GREEN: in `src/engine/build-review-prompt.ts`, edit the paragraph at `:34-36` from
  "Before judging, run the project's test suite yourself and observe the output firsthand
  …" to instruct running only the tests exercised by the diff under review (its own/changed
  test files, derivable from the diff already in the prompt), observe their output
  firsthand, and explicitly NOT run the full project suite (CI and finish cover that). Do
  NOT touch the rubric block (`:25-32`), the verdict schema (`:38-45`), or the diff/plan
  sections.
- COMMIT: `feat(build-review): grade on the diff's scoped tests, not the full suite (#588)`
**Files:**
- `src/conductor/src/engine/build-review-prompt.ts` (`:34-36` instruction paragraph)
- `src/conductor/test/engine/build-review-prompt.test.ts` (`:46-49` assertion → scoped wording)
**Dependencies:** none

---

### Task 2: Doc-sync the build_review ADR's test-observation line

**Story:** Story 2 (gate not weakened — keep the governing ADR consistent with the code).
**Type:** docs (keep an APPROVED ADR non-contradictory with the shipped prompt; no
decision reversed — the ADR itself frames test execution as "a future dial" at §54-56).
**Steps:**
- Edit `.docs/decisions/adr-2026-07-07-build-review-judgement-gate.md` §45 (the "raw test
  output: the grader runs the project's test suite itself inside its session" bullet) to
  read that the grader runs the diff's SCOPED tests (its own/changed test files) inside its
  session and observes output firsthand — the full suite is CI's (and finish's)
  authoritative job, per #588. Add a short parenthetical noting this narrows a v1 dial and
  leaves the verdict predicate and rubric (§4, §54-56) unchanged.
- COMMIT: `docs(adr): build_review grader observes the diff's scoped tests (#588)`
**Files:**
- `.docs/decisions/adr-2026-07-07-build-review-judgement-gate.md` (§45 bullet)
**Dependencies:** Task 1 (keep the ADR wording in step with the prompt that ships in T1)

---

### Task 3: Reconcile TDD per-cycle test runs to the scoped policy

**Story:** Story 3 (per-cycle scoped; full suite at finish + CI).
**Type:** docs (skill drift fix — the Verification checklist at `:312-313` already states
the scoped policy; two earlier lines contradict it).
**Steps:**
- Edit `skills/tdd/SKILL.md:78` (Phase 3 GREEN step 4) from "Run the full test suite —
  ensure nothing else broke" to "Run the affected/scoped test set (the task's own tests +
  the files this change touches) — the full suite runs at finish + CI, not per-cycle".
- Edit `skills/tdd/SKILL.md:118` (Phase 5 COMMIT hard-gate item 1) from "Full test suite
  passes (not just the new test)" to "Scoped affected-test set passes (the full suite runs
  at the feature's final verification / finish and at CI, not per-task)" — matching the
  existing Verification checklist at `:312-313`.
- Verify no other line in `skills/tdd/SKILL.md` still mandates a per-cycle full-suite run
  (grep "full test suite"); leave `references/green.md` alone unless it also mandates one
  (check and, only if it does, apply the same scoping).
- COMMIT: `docs(tdd): per-cycle runs the scoped affected set; full suite at finish + CI (#588)`
**Files:**
- `skills/tdd/SKILL.md` (`:78` GREEN step 4; `:118` COMMIT gate item 1)
**Dependencies:** none

---

### Task 4: Document finish as the single in-pipeline full-suite checkpoint

**Story:** Story 4 (finish keeps the one full run; red still blocks).
**Type:** docs (clarify, do not weaken — finish still runs the full suite).
**Steps:**
- In `skills/finish/SKILL.md`, at the "Fresh Verification" list item 1 (`:45` "Full test
  suite — Run it fresh …"), add a one-line note that this is the SINGLE in-pipeline
  full-suite checkpoint before push — it complements, and is not duplicated by,
  intermediate steps (which run scoped tests) or CI's authoritative `conductor` job. Do
  NOT change the gate behavior: finish still runs the full suite fresh and still refuses on
  real failures (the `.pipeline/test-failures.md` / no-`finish-choice` block is unchanged).
- COMMIT: `docs(finish): note finish is the single in-pipeline full-suite checkpoint (#588)`
**Files:**
- `skills/finish/SKILL.md` (`:45` Full test suite list item)
**Dependencies:** none

---

## Task Dependency Graph

```
Task 1 (build_review prompt + test)  ──►  Task 2 (ADR doc-sync)
Task 3 (TDD reconcile)   ── independent
Task 4 (finish clarify)  ── independent
```
Task 2 depends on Task 1 (ADR wording tracks the shipped prompt). Tasks 3 and 4 are
independent of each other and of 1/2 (different files). Any order is valid except Task 2
before Task 1.

## Verification

- `src/conductor`: `npm run build` clean; `npx vitest run test/engine/build-review-prompt.test.ts`
  green (new scoped-wording assertion passes, verdict/rubric assertions still pass); full
  `npx vitest run` green (no regression from the prompt-string change).
- `bash test/test_harness_integrity.sh` passes (SKILL.md frontmatter/section-numbering,
  agent/skill references) after the tdd/finish edits.
- Manual grep confirms no intermediate step (build_review prompt, tdd GREEN/COMMIT) still
  says "full test suite"; finish and CI still do.
- CHANGELOG `[Unreleased]` gains a Changed entry (per this repo's release gate). No
  Migration block required (no CLI/hook/schema/symlink change; prompt+skill+ADR text only).

## Coverage Mapping

| Story | Task(s) | Test / assertion anchor |
|---|---|---|
| Story 1 (grader scoped; rubric caught) | 1 | `test/engine/build-review-prompt.test.ts` scoped-wording assertion (replaces `:46-49`); rubric/verdict assertions unchanged |
| Story 2 (gate not weakened) | 1, 2 | build-review-prompt.test.ts verdict-schema assertions still green; `CUSTOM_COMPLETION_PREDICATES.build_review` untouched; ADR §45 synced |
| Story 3 (per-cycle scoped) | 3 | `skills/tdd/SKILL.md` internal consistency: `:78`/`:118` match `:312-313`; integrity suite green |
| Story 4 (finish single checkpoint) | 4 | `skills/finish/SKILL.md:45` note; finish full-suite gate behavior unchanged; integrity suite green |
