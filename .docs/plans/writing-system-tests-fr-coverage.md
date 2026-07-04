# Implementation Plan: FR→Acceptance-Spec Coverage Gate for /writing-system-tests

**Date:** 2026-07-04
**Design:** `.docs/specs/2026-07-04-writing-system-tests-fr-coverage.md`
**Stories:** `.docs/stories/writing-system-tests-fr-coverage.md`
**Conflict check:** Skipped — tier S per `.docs/complexity/writing-system-tests-fr-coverage.md`

## Summary

Adds a self-enforced FR→acceptance-spec coverage gate to `skills/writing-system-tests/SKILL.md`
(plus README/CHANGELOG), in 7 tasks. Markdown-only: no engine/TS code, no change to the TDD
cycle or the prd-audit gate.

## Technical Approach

All behavior lands as documented process + GATE language inside
`skills/writing-system-tests/SKILL.md`, following the harness convention that gates are
self-enforced by the skill (no conductor wiring). Three edit sites:

- **New §3e "FR Coverage Mapping (Product Track)"** — scoping rule (product track AND an
  approved PRD), FR-list parsing, the one-row-per-FR table, the closed disposition set
  (`spec-covered` / `unit-covered` / `already-tested`), and citation requirements. Placed after
  §3d so it sits with the other derivation/classification rules and reuses §2 (already-tested)
  and §3a (unit-covered) outcomes. Section numbering stays unique (integrity check #7).
- **§5a/§5b generation rules** — every generated product-track spec must carry its FR
  identifier searchably: in the top-level suite/describe name **or** a leading comment line
  `Covers: FR-N` (framework-agnostic; multiple FRs comma-separated). Verifiable with
  `grep -rE "FR-[0-9]+" <acceptance dir>`.
- **§6 "Run and Verify RED" extension** — after the RED evidence, finalize the table and write
  it to **`.pipeline/fr-coverage.md`** (settles the PRD's open question): a Markdown table
  `| FR | Disposition | Evidence |` under a header carrying the feature stem, PRD path, date,
  and a final verdict line `Coverage: COMPLETE` / `Coverage: INCOMPLETE — unresolved: FR-…`.
  Markdown (not JSON) because the consumers are humans and LLM steps (prd-audit), not engine
  parsers. GATE: any unresolved FR ⇒ the step MUST NOT report success; failure output lists
  each unresolved FR with its reason. Evidence-file write is part of the gate.

Sequencing: define the mapping (T1) → spec-side identifier rule (T2) → gate + evidence file
(T3) → no-op scoping (T4) → docs (T5, T6) → validation (T7).

## Prerequisites

- None beyond the repo itself (worktree already on `spec/writing-system-tests-map-every-prd-fr-to-an-accept`).

## Tasks

### Task 1: Add §3e — FR coverage mapping and dispositions
**Story:** "Coverage table has exactly one row per PRD FR" (FR-1, happy + negative); "Every row
resolves to exactly one of three dispositions" (FR-2, happy + negative); "Every disposition
cites its evidence" (FR-4, happy)
**Type:** happy-path

**Steps:**
1. Check (RED): `grep -n "FR Coverage" skills/writing-system-tests/SKILL.md` → no match.
2. Insert new section `### 3e. FR Coverage Mapping (Product Track)` after §3d containing:
   scope rule (runs only when the feature's track marker is product AND an approved PRD exists
   in `.docs/specs/`); parse the PRD's enumerated `FR-N` list; build a table with exactly one
   row per FR — a missing or invented identifier invalidates the table; the closed disposition
   set with definitions mapping `already-tested` to the §2 overlap check and `unit-covered` to
   the §3a classification (citing the story that carries the FR); citation requirement per
   disposition; a row with two dispositions, an unknown disposition, or no citation is
   **unresolved**.
3. Verify (GREEN): grep finds the section; wording covers missing + invented FR case and the
   closed-set rule.
4. Commit: `feat(writing-system-tests): add §3e FR coverage mapping (product track)`

**Files likely touched:**
- `skills/writing-system-tests/SKILL.md` — new §3e

**Dependencies:** none

### Task 2: Require FR identifiers in generated specs (§5a/§5b)
**Story:** "Specs name the FR they cover, searchably" (FR-3, happy)
**Type:** happy-path

**Steps:**
1. Check (RED): `grep -n "Covers: FR" skills/writing-system-tests/SKILL.md` → no match.
2. Add to the §5a and §5b rules lists: on the product track, every generated spec identifies
   the FR(s) it covers — FR identifier in the top-level suite/describe name or a leading
   comment `Covers: FR-N[, FR-M]` — so `grep -rE "FR-[0-9]+"` over the acceptance directory
   finds every FR's specs.
3. Verify (GREEN): both §5a and §5b carry the rule.
4. Commit: `feat(writing-system-tests): specs must name covered FRs searchably`

**Files likely touched:**
- `skills/writing-system-tests/SKILL.md` — §5a/§5b rules

**Dependencies:** Task 1 (references the §3e table)

### Task 3: Extend §6 — finalize table, write evidence, GATE on unresolved FRs
**Story:** "An unresolved FR blocks completion" (FR-5, happy + both negatives); "Coverage table
recorded as run evidence" (FR-6, happy + negative); "Specs name the FR they cover" (FR-3,
negative); "Every disposition cites its evidence" (FR-4, negative); "Coverage table has exactly
one row per PRD FR" (FR-1, negative)
**Type:** negative-path

**Steps:**
1. Check (RED): `grep -n "fr-coverage" skills/writing-system-tests/SKILL.md` → no match.
2. Extend §6 (after the RED-evidence block) with a "Record the FR coverage evidence (gating)"
   subsection: finalize the §3e table — verify each cited spec/test file exists on disk and
   contains the FR identifier, each cited story exists in `.docs/stories/` — then write
   `.pipeline/fr-coverage.md` in the documented format (header: feature stem, PRD path, date;
   table `| FR | Disposition | Evidence |`; verdict line). GATE language mirroring the existing
   RED gate: if any FR is unresolved (missing row, invented row, bad/duplicate disposition,
   missing citation, citation that fails verification) or the evidence file cannot be written,
   the step MUST NOT report success — it lists every unresolved FR with its reason and stops
   (a hard stop under the daemon, not a logged warning). On full resolution it reports
   `Coverage: COMPLETE`.
3. Verify (GREEN): §6 documents file name, format, verification of citations, gate + failure
   output; completion checklist includes the evidence file.
4. Commit: `feat(writing-system-tests): gate completion on FR coverage evidence`

**Files likely touched:**
- `skills/writing-system-tests/SKILL.md` — §6 extension + §7/verification checklist line

**Dependencies:** Tasks 1, 2

### Task 4: Scope the no-op path (technical track / missing or unapproved PRD)
**Story:** "Technical track and PRD-less features are untouched" (FR-7, happy + negative)
**Type:** negative-path

**Steps:**
1. Check (RED): §3e scope rule exists (Task 1) but the unapproved-PRD behavior is undefined.
2. Add to §3e: technical track or no PRD ⇒ perform no FR-coverage work, emit no table, complete
   exactly as today (§1–§7 unchanged). A PRD present but not `Status: Approved` ⇒ do NOT build
   a table from an unapproved FR list — surface the missing approval as the failure reason
   (this is a pipeline-state error, not a coverage gap).
3. Verify (GREEN): both branches documented with explicit no-op/surface behavior.
4. Commit: `feat(writing-system-tests): scope FR coverage to approved product-track PRDs`

**Files likely touched:**
- `skills/writing-system-tests/SKILL.md` — §3e scope paragraph

**Dependencies:** Task 1

### Task 5: Update README (docs track features)
**Story:** PRD In-Scope item "Harness documentation reflecting the new behavior"
**Type:** infrastructure

**Steps:**
1. Check (RED): `grep -n "fr-coverage" README.md` → no match.
2. Add/extend the writing-system-tests description in `README.md` (skills overview / gates
   section): product-track runs emit `.pipeline/fr-coverage.md` and block on unresolved FRs.
3. Verify (GREEN): grep finds it; wording matches SKILL.md.
4. Commit: `docs: document FR coverage gate in README`

**Files likely touched:**
- `README.md` — writing-system-tests entry

**Dependencies:** Task 3 (final gate semantics)

### Task 6: CHANGELOG entry
**Story:** repo release gate (CHANGELOG on every PR)
**Type:** infrastructure

**Steps:**
1. Check (RED): `[Unreleased]` has no entry for this feature.
2. Add under `## [Unreleased]` → `### Added`: "writing-system-tests: FR→acceptance-spec
   coverage gate — product-track runs emit a per-FR coverage table
   (`.pipeline/fr-coverage.md`) and refuse to complete while any FR is unresolved
   (spec-covered / unit-covered / already-tested dispositions with citations). (#244)"
3. Verify (GREEN): entry present under Added.
4. Commit: `docs: changelog for FR coverage gate`

**Files likely touched:**
- `CHANGELOG.md` — `[Unreleased]` / Added

**Dependencies:** none (can run any time before PR)

### Task 7: Run the harness integrity suite
**Story:** repo validation rule (every change validated before commit)
**Type:** infrastructure

**Steps:**
1. Run `test/test_harness_integrity.sh`.
2. Fix any failure — most likely §-numbering uniqueness in SKILL.md (check #7) or frontmatter.
3. Verify (GREEN): suite passes clean.
4. Amend/commit any fixes: `test: integrity fixes for FR coverage gate`

**Files likely touched:**
- none expected (verification only)

**Dependencies:** Tasks 1–6

## Task Dependency Graph

```
T1 ──▶ T2 ──▶ T3 ──▶ T5 ──▶ T7
 └───▶ T4 ─────────────────▲
T6 ────────────────────────┘
```

## Integration Points

- After Task 3: the full gate is readable end-to-end in SKILL.md — a dry-read of a product-track
  scenario (7-FR PRD, one FR uncovered) should walk to a blocked completion naming that FR.
- After Task 7: repo validation green; branch ready for PR.

## Coverage Mapping (story criterion → task)

| Story (FR) | Happy | Negative |
|---|---|---|
| FR-1 one-row-per-FR | T1 | T3 (invalid table blocks) |
| FR-2 dispositions | T1 | T1 (closed set → unresolved) + T3 (gate) |
| FR-3 searchable FR ids | T2 | T3 (cited spec lacking id → unresolved) |
| FR-4 citations | T1 | T3 (missing/nonexistent citation → unresolved) |
| FR-5 block on unresolved | T3 | T3 (named FRs; daemon hard stop) |
| FR-6 run evidence | T3 | T3 (unwritable evidence ⇒ no success) |
| FR-7 no-op scoping | T4 | T4 (unapproved PRD surfaced) |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
