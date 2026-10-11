# Conflict Check: Source-grounded adversarial plan review before land (#3038)

**Date:** 2026-10-10
**Stories checked:** `.docs/stories/source-grounded-plan-defects-pass-every-decide-gat.md`
(Stories 1–11), together with the full `.docs/stories/` corpus.
**ADR corpus:** repo-wide (the sweep is enabled in this repository), narrowed by subject.
**Method:** a fresh adversarial subagent tested every pair sharing a subject in both directions.
The author resolved each conflict, and the operator delegated approval through spec delivery.
**Result:** 4 conflicts found: 2 blocking and 2 degrading. All are resolved, and 0 blocking remain.

## Corpus

**Examined:**
- Stories:
  - `contradictory-decide-artifacts-reach-build-and-hal.md` (#1391)
  - `no-decide-sweep-covers-task-versus-task-oscillatio.md` (#1540)
  - `daemon-autonomous-runs-must-fail-closed-on-any-amb.md`
  - `record-land-gate-rejections-on-the-event-spine.md`
  - `s-tier-pipeline-knobs.md`
  - `2026-07-26-daemon-decide-phase-coherence-ownership-971.md`
- ADRs:
  - `adr-2026-08-09-adr-contradiction-detection-in-two-halves`
  - `adr-2026-08-03-fail-closed-decide-entry`
  - `adr-2026-08-31-coverage-binding-judge-step`
  - `adr-2026-09-23-provider-admission-gate…`
  - `adr-2026-07-22-coherence-gate-placement-and-validation-split`
  - `adr-008-agent-hosted-loop-and-in-chat-authoring`
  - `adr-2026-07-21-s-tier-pipeline-knobs`
  - `adr-2026-10-03-per-feature-step-applicability`
  - `adr-2026-09-20-operator-launched-sessions…`
- Other: `.agents/skills/event-spine` §4.

**Narrowed out:**
- `adr-approval-gate-before-build` and `adr-2026-08-08-single-adr-approval-parser-three-rungs`: their "§7b" is architecture-review's §7b, not the plan's.
- `file-changing-rebase…`: its §7a mention is unrelated.
- Hits on `coherence-waiver`, `llm_provider`, `nativeSchema` and `composer-events` that mention these surfaces but make no binding claim on them.

## Conflict: "Missing artifact refuses" vs "legacy disengages like coherence" (resolved)

**Stories involved:** Story 8 vs Story 9 (both new)
**Type:** sequencing
**Severity:** blocking

**Description:**
- Story 8 refuses an M spec that has no review artifact.
- Story 9 made the rung disengage for "legacy" change sets "the same way the coherence gate does".
  The coherence gate decides legacy status by whether the artifact is present
  (`land-spec.ts:665-666`, `coherence-validator.ts:1504`).
- Under that rule a new spec with no artifact counts as legacy, so it can never be refused.

**Resolution applied:** the land rung has **no** legacy disengagement. Every land after this
feature ships happens after the step exists. Story 9's negative path was replaced: a spec authored
earlier but landed later is refused, and ADR D9 was revised to match.

## Conflict: Removing §4d breaks the #1540 ownership and task-sweep stories (resolved)

**Stories involved:** #1540 Stories 1–4 vs new Story 10 and Story 5
**Type:** contradiction
**Severity:** blocking

**Description:**
- #1540 gives cross-layer pairs and task-vs-task pairs to `/coherence-check`, and requires the
  task sweep in its skill.
- This feature removes §4d and moves those pairs to plan review.
- Three skill-contract tests pin the old text:
  - `coherence-check-task-sweep-skill-contract.test.ts`
  - `conflict-check-layer-ownership-skill-contract.test.ts`
  - `plan-interference-check-skill-contract.test.ts`

**Resolution applied:** the #1540 stories were rewritten in place so that plan review owns
cross-layer and task-vs-task pairs at M/L, and the plan's §7b owns them at S. Story 10 gained a
Done-When for a single shared ownership statement in conflict-check, coherence-check and
plan-review. Updating the three contract tests is a plan task.

## Conflict: #1391 ADR-row story requires contradiction judgement in coherence-check (resolved)

**Stories involved:** #1391 Story 3 vs new Story 10
**Type:** contradiction
**Severity:** degrading

**Description:** #1391 Story 3 required coherence `adr` rows to record `fail` with `CONTRADICTS:`
notes, and §4d to name ADR-vs-story pairs. Story 10 removes §4d and its contradiction-derived fail
rows.

**Resolution applied:**
- #1391 Story 3 was rewritten in place: at M/L, plan review records the ADR-vs-story contradiction
  finding, and the `adr` row records only coverage.
- The Done-When now points to `skills/plan-review/SKILL.md`.
- Story 10 now requires coherence-check's `covered` definition (§4b) and FR tie-out (§4e) to stop
  pointing at §4d.

## Conflict: D9's absent-artifact skip overrides the fail-closed DECIDE entry rule (resolved)

**Stories involved:** new Story 9 vs `adr-2026-08-03-fail-closed-decide-entry` D1 rule 8, and
`daemon-autonomous-runs-must-fail-closed-on-any-amb` Story 1
**Type:** contradiction
**Severity:** degrading

**ADR filename stem:** adr-2026-08-03-fail-closed-decide-entry
**Story ID:** Story 9
**ADR opposing sentence (verbatim):** "8. Otherwise (`satisfied === false`, or `'unknown'` from a predicate that threw) → `halt`."
**Story opposing sentence (verbatim):** "then `plan_review` is fast-forwarded as skipped with reason `landed-before-plan-review` and the build proceeds."

**Resolution applied:**
- `adr-2026-08-03-fail-closed-decide-entry` D1 is amended additively. A step may declare the
  structural `StepDefinition` field `absentArtifactDisposition: 'skipped'`. In daemon mode, a
  wholly absent artifact for that step fast-forwards as skipped.
- An artifact that is present but unsatisfied still halts under rule 8.
- `plan_review` is the only declarer. Story 9 gained a negative path where the artifact is present
  but blocking and the run halts.

## Minor (resolved)

- **The edit-to-resolve path after round 2 could not be reached.** ADR D6/D7 now define
  `--accept <id> --reason`, which also covers resolving a finding by editing, and
  `--acknowledge --reason`, which re-stamps the digest after edits made once the bound is reached
  and dispatches no reviewer. Story 7 gained that criterion.
- **Dispatch-count wording.** Story 7's Done-When now counts *review rounds*, and says that a
  dispatch failing the schema is not a counted round.

## Assumptions Not Grounded (recorded, no conflict)

- **adr-008 D4** ("in-chat authoring"): it governs how artifacts are authored, and plan review
  authors none. This is noted in the new ADR's Context.
- **adr-2026-09-23 D2/D7:** the same-provider fallback is an ordinary fall-through to the next
  candidate. No text conflicts.
- **S-tier pinned set; #1628 land-gate events; event-spine exceptions B/C;** coverage-binding D4's
  ordering (it still holds with `plan_review` inserted).

## Re-check

After the resolutions above, the author re-ran the both-direction pairs: Stories 8/9; Story 10
against #1540 Stories 1–4 and #1391 Story 3; Story 9 against 08-03 D1 as amended; Story 7 against
Stories 4 and 8. **0 blocking, 0 degrading open.**
