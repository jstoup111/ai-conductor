# Conflict Check: Integrity suite checks fail closed (#1014)

**Date:** 2026-10-14
**Stories checked:** `.docs/stories/integrity-suite-two-checks-cannot-fail-one-warns-p.md` (Stories 1-5) against every file in `.docs/stories/`
**Result:** PASS after resolution — 3 blocking conflicts found and resolved; 0 remain

## ADR corpus

**Examined (subject overlaps these stories):**
- `adr-2026-07-03-generated-model-table-single-source` — checks 5, 5a, 5b and SKILL.md pins (conflict C1)
- `adr-2026-07-05-engine-owned-task-status` — field-level write partition for `.pipeline/task-status.json` (agent: advisory `pending`/`in_progress`; engine-only: `completed`/`skipped`); Story 5 flags only engine-only writes, no conflict

**Narrowed out:** every other approved ADR in `.docs/decisions/`; none addresses the integrity suite's checks 5/5a/5b/5c/10, the docs-guard generator's check mode, or SKILL.md model pins.

## Stories examined with no conflict

- `report-a-failing-integrity-check-instead-of-aborti.md` — failure-reporting contract; new checks keep using captured statuses
- `run-the-harness-integrity-suite-in-build-s-test-su.md` — suite runs in `test_suite`, after `npm test`; consistent with Story 4
- `prd-audit-kickback-preserves-task-status.md`, `demote-task-stamping-to-telemetry.md` — engine-owned task status; Story 5 leaves advisory scheduling writes legal and flags only engine-only ones
- `2026-07-07-evidence-gate-task-id-grammar.md`, `code-removal-skill.md`, `tautology-fails-are-unfixable-when-planned-behavio.md` — sections of `skills/tdd/SKILL.md`; this spec does not edit that file
- `block-edits-to-docs-spec-artifacts-during-build-an.md`, `missing-session-hook-files-terminally-halt-a-build.md` — docs-guard hook provisioning; Story 3 only changes where the fixture writes

## Conflict C1: Warn-and-skip degradation contradicts fail-closed prerequisites

**Stories involved:** Story 4 (Missing prerequisites fail instead of skipping) vs ADR: Generated model table single source
**Files:** `.docs/stories/integrity-suite-two-checks-cannot-fail-one-warns-p.md` vs `.docs/decisions/adr-2026-07-03-generated-model-table-single-source.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-03-generated-model-table-single-source
**Story ID:** 4
**ADR opposing sentence (verbatim):** "**Degradation:** when `src/conductor/node_modules` is absent, both checks WARN and skip (exit 0 for the section) — consumer checkouts without `npm install` must never see a false integrity failure."
**Story opposing sentence (verbatim):** "Given `src/conductor/node_modules` is absent, when the suite runs, then checks 5a, 5b, and 5c fail with a message naming the missing directory and the `npm ci` remedy in `src/conductor`, and the suite exits non-zero"

**Description:** The same absent-`node_modules` state cannot both exit 0 with a WARN and exit non-zero with a FAIL. The ADR's premise (consumer checkouts run the suite) is falsified: no `bin/` or installer path invokes `test/test_harness_integrity.sh`.

**Resolution Options:**
1. Additive amendment note on ADR D4 superseding the Degradation clause (root lives in the ADR)
2. New ADR superseding `adr-2026-07-03-generated-model-table-single-source`
3. Drop Story 4 and keep warn-and-skip

**Resolution (operator-selected):** Option 1. Amendment note added beside D4; the original clause is preserved. The plan carries Architecture Obligation Coverage rows for all of D1-D5.

## Conflict C2: Pin-less skills always skipped contradicts both-direction pin check

**Stories involved:** "Pin check keeps SKILL.md frontmatter honest" vs Story 2 (Check 5b enforces model pins in both directions)
**Files:** `.docs/stories/generated-model-table.md` vs `.docs/stories/integrity-suite-two-checks-cannot-fail-one-warns-p.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The shipped story asserted "Given a SKILL.md whose frontmatter has no `model:` line, when check 5b runs, then that skill is skipped … — absence of a pin is never an error." Story 2 fails a non-exempt skill that has an expected model but no pin.

**Resolution Options:**
1. Replace the shipped assertion in place: pin-less skills pass only when exempt or unmapped
2. Narrow Story 2 to warn rather than fail
3. Drop the reverse direction

**Resolution (operator-selected):** Option 1, applied in place in `generated-model-table.md` (criterion and Done When).

## Conflict C3: Warn-and-skip story contradicts fail-closed prerequisites

**Stories involved:** "Integrity suite integrates drift + pin checks with warn-and-skip degradation" vs Story 4
**Files:** `.docs/stories/generated-model-table.md` vs `.docs/stories/integrity-suite-two-checks-cannot-fail-one-warns-p.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The shipped story asserted that an absent `node_modules` emits a WARN and leaves the exit code unaffected; Story 4 requires a counted failure.

**Resolution Options:**
1. Replace the shipped story's title, intent, absent-`node_modules` criterion, and Done When path in place
2. Drop Story 4

**Resolution (operator-selected):** Option 1, applied in place in `generated-model-table.md`.

## Re-check

After resolution, a repo-wide grep of `.docs/stories/` and approved ADRs for warn-and-skip and pin-absence assertions about checks 5/5a/5b finds only the amended ADR's preserved original clause (with its amendment note beside it). Zero blocking conflicts remain; no degrading conflicts accepted.
