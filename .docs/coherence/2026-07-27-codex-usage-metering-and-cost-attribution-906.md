# Coherence Mapping: Codex usage metering and cost attribution (#906, absorbs #1008)

**Date:** 2026-07-27 · Tier L · technical track · intake jstoup111/ai-conductor#906
**Stories:** `.docs/stories/2026-07-27-codex-usage-metering-and-cost-attribution-906.md`
**Plan:** `.docs/plans/2026-07-27-codex-usage-metering-and-cost-attribution-906.md`

Technical track: there is no PRD, so there are no FR rows. Acceptance criteria are the stories'
Given/When/Then scenarios, and the chain is outcome → story → task.

## Traceability

| Row | Id | Cites | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1, story-2, story-7 | covered | Codex JSON output is parsed into TokenUsage when the CLI provides usage data |
| outcome | outcome-2 | story-3, story-4, story-5, story-7 | covered | If Codex does not expose per-run usage locally, reports explicitly mark Codex steps unmetered without fabricating zeros |
| outcome | outcome-3 | story-3, story-4, story-5 | covered | Cost rollups continue to work for Claude and mixed historical event logs |
| outcome | outcome-4 | story-7 | covered | Parser tests cover at least one real or fixture Codex JSONL stream |
| story | story-1 | task-2 | covered | Codex usage accumulates across every turn of a dispatch |
| story | story-2 | task-3 | covered | Codex cache-creation and reasoning tokens are captured |
| story | story-3 | task-4, task-9 | covered | A dispatch with tokens but no cost is classified cost-unmetered |
| story | story-4 | task-5, task-6 | covered | The committed Cost block records cost-unmetered, additively |
| story | story-5 | task-7 | covered | Cost-unmetered work still contributes to token aggregates |
| story | story-6 | task-8 | covered | conduct kpi renders per-provider and previously-hidden fields |
| story | story-7 | task-1 | covered | The parser is pinned against a real captured Codex stream |
| story | story-8 | task-10 | covered | Documentation reflects the new metering states |
| task | task-1 | story-7 | mapped | Commit a real captured Codex JSONL fixture |
| task | task-2 | story-1 | mapped | Accumulate Codex usage across turns |
| task | task-3 | story-2 | mapped | Capture Codex cache-creation and reasoning tokens |
| task | task-4 | story-3 | mapped | Add the metering classification helper and fix the rollup |
| task | task-5 | story-4 | mapped | Write cost_unmetered into the committed Cost block |
| task | task-6 | story-4 | mapped | Parse the new field with backward compatibility |
| task | task-7 | story-5 | mapped | Split cost aggregation from token aggregation |
| task | task-8 | story-6 | mapped | Render per-provider attribution and the six hidden fields |
| task | task-9 | story-3 | mapped | Acceptance coverage for the end-to-end metering path |
| task | task-10 | story-8 | mapped | Update documentation and changelog |

## Outcome verdict notes

**outcome-1 was already partly implemented before this spec.** `parseCodexJsonl` exists today
(from the #904 family), so Codex usage *is* parsed — but only from the final turn, and with two
token classes dropped. Stories 1 and 2 close the gap from partly-parsed to fully-parsed; story 7
pins the result against a real captured stream.

**outcome-2's premise is corrected.** The issue assumed Codex might expose no usage. Verified
against `codex-cli 0.145.0`, Codex *does* expose token usage; what it does not expose is USD
cost. The no-fabricated-zeros requirement is therefore honored on the axis where the absence is
real: story 3 introduces the `cost-unmetered` state so absent cost is never summed as `$0`.
Story 7's negative path preserves the literal reading — an unrecognized schema degrades to
unmetered, never to zeros.

**outcome-3 is the backward-compatibility outcome.** Story 3 HP-2 pins Claude's behavior as
unchanged; story 4 NP-1 pins that a `## Cost` block committed before this change still parses;
story 5 keeps mixed-provider features contributing to token aggregates rather than dropping out
of the KPI entirely.

## Absorbed scope (#1008)

Story 6 and task 8 implement #1008 — `conduct kpi` rendering the `providers:` sub-block and the
six recorded-but-unrendered fields documented at `docs/reference/artifacts.md:534-540`. This is
**not** an outcome row: #1008 is a separate issue absorbed by operator decision, not a desired
outcome of #906. It is traced here so the extra story and task are not orphans, and task 10
removes the limitation note so the docs stop describing a gap that no longer exists.

## Drift and duplication checks

- **Adjacent drift** — no task implements anything no story asks for. Task 10's release-gate
  waiver step is compliance with an existing repo gate, not new behavior.
- **Duplicate spec** — partial overlap found and resolved: `parseCodexJsonl` already exists, so
  outcome-1 is not greenfield. Recorded in architecture review F1 and in the outcome-1 note.
- **Scope collision** — #1008 owned part of this; absorbed deliberately, closed by story 6.
- **Coverage-table contradiction** — none; every story maps to at least one task, and every task
  cites exactly one story.
- **Negative-path presence** — every story carries at least one negative path; stories 3 and 4
  carry two each, covering risks R1 and R3, the two that would produce silently wrong output.

## Verdict

**Coherent.** The chain outcome → story → task is complete in both directions, with no orphan
tasks, no uncovered stories, and no unmapped outcomes. The one substantive finding is that
#906's stated premise is stale, so outcomes 1 and 2 were re-derived from verified source and a
live CLI capture rather than taken at face value.
