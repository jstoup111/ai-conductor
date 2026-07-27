# Coherence Check: Codex Safety and Self-Host Parity (#907)

**Date:** 2026-07-26
**Tier:** M
**Track:** Product
**Plan stem:** `2026-07-26-codex-safety-and-self-host-parity-907`
**Result:** COVERED — zero gaps

No outcome rows are required: this GitHub-issue conduct run has no staged `.pipeline/`
outcomes file or committed `.docs/intake/` marker for #907.

The accepted stories do not declare separate numeric story labels. Each story declares one
unique `**Requirement:** FR-N` value, so this mapping uses the normalized story identity
`story-fr-N`. Every such identity was confirmed one-to-one against the stories file before
the plan's `**Story:** FR-N ...` citations were judged.

## Functional requirements

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-fr-1 | covered | The accepted attribution-concurrency story explicitly declares `Requirement: FR-1`. |
| fr | fr-2 | story-fr-2 | covered | The accepted matching-task retirement story explicitly declares `Requirement: FR-2`. |
| fr | fr-3 | story-fr-3 | covered | The accepted non-authoritative-attribution story explicitly declares `Requirement: FR-3`. |
| fr | fr-4 | story-fr-4 | covered | The accepted attribution-validation story explicitly declares `Requirement: FR-4`. |
| fr | fr-5 | story-fr-5 | covered | The accepted protected-artifact story explicitly declares `Requirement: FR-5`. |
| fr | fr-6 | story-fr-6 | covered | The accepted indeterminate-target story explicitly declares `Requirement: FR-6`. |
| fr | fr-7 | story-fr-7 | covered | The accepted feature-workspace isolation story explicitly declares `Requirement: FR-7`. |
| fr | fr-8 | story-fr-8 | covered | The accepted unrelated-provider-state isolation story explicitly declares `Requirement: FR-8`. |
| fr | fr-9 | story-fr-9 | covered | The accepted all-exit cleanup story explicitly declares `Requirement: FR-9`. |
| fr | fr-10 | story-fr-10 | covered | The accepted required-protection story explicitly declares `Requirement: FR-10`. |
| fr | fr-11 | story-fr-11 | covered | The accepted diagnostic-gap story explicitly declares `Requirement: FR-11`. |
| fr | fr-12 | story-fr-12 | covered | The accepted retry/resume protection story explicitly declares `Requirement: FR-12`. |
| fr | fr-13 | story-fr-13 | covered | The accepted actionable-failure story explicitly declares `Requirement: FR-13`. |
| fr | fr-14 | story-fr-14 | covered | The accepted confidential-diagnostics story explicitly declares `Requirement: FR-14`. |
| fr | fr-15 | story-fr-15 | covered | The accepted Claude-compatibility story explicitly declares `Requirement: FR-15`. |

## Stories

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-fr-1 | task-1, task-2, task-3, task-4 | covered | Tasks cover exact ids, both providers, concurrent rows, and explicit trailers. |
| story | story-fr-2 | task-3, task-5, task-6 | covered | Tasks cover independent active rows, matching retirement, and safe cleanup/replacement failures. |
| story | story-fr-3 | task-8 | covered | Task 8 covers all happy and negative paths that keep attribution outside mutation/completion authority. |
| story | story-fr-4 | task-1, task-3, task-4 | covered | Tasks cover exact validation, idempotent concurrent telemetry, and no global trailer replacement. |
| story | story-fr-5 | task-9, task-10, task-11 | covered | Tasks cover the durable seal, explicit lifecycle exceptions, and drift rejection without resealing. |
| story | story-fr-6 | task-10, task-12, task-13 | covered | Tasks cover exact exceptions, canonical classification, and fail-closed ambiguous/escaping targets. |
| story | story-fr-7 | task-26, task-27 | covered | Tasks establish the live baseline and reject or detect live-checkout writes. |
| story | story-fr-8 | task-21, task-22, task-23, task-24, task-25, task-26, task-27, task-29 | covered | Tasks cover both minimal homes, selected auth, Codex skill discovery, live-state verification, and provisioning failure. |
| story | story-fr-9 | task-21, task-28, task-29 | covered | Tasks cover idempotent home teardown, every terminal path, and bounded partial cleanup. |
| story | story-fr-10 | task-7, task-14, task-15 | covered | Tasks define the verdict, wrap every candidate attempt, and distinguish inapplicable from unavailable protection. |
| story | story-fr-11 | task-7, task-16 | covered | Tasks distinguish required verdicts from diagnostic-only provider gaps. |
| story | story-fr-12 | task-9, task-11, task-14, task-17, task-18 | covered | Tasks preserve the baseline and boundary across initial, retry, resume, grouped, and replacement paths. |
| story | story-fr-13 | task-19 | covered | Task 19 covers provider/protection identity, cause, recovery, and fallback diagnostics. |
| story | story-fr-14 | task-20, task-24 | covered | Tasks redact persisted safety output and keep cached credentials opaque. |
| story | story-fr-15 | task-2, task-22, task-23, task-30 | covered | Tasks cover provider parity, both isolated homes, and Claude compatibility outside the intentional change. |

## Plan tasks

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| task | task-1 | story-fr-1, story-fr-4 | covered | The task cites existing FR-1 and FR-4 acceptance criteria for exact identity validation. |
| task | task-2 | story-fr-1, story-fr-15 | covered | The task cites existing cross-provider dispatch and Claude/Codex parity criteria. |
| task | task-3 | story-fr-1, story-fr-2, story-fr-4 | covered | The task cites existing concurrent, independent, and idempotent telemetry criteria. |
| task | task-4 | story-fr-1, story-fr-4 | covered | The task cites existing explicit-trailer preservation criteria. |
| task | task-5 | story-fr-2 | covered | The task cites existing matching-task terminal retirement criteria. |
| task | task-6 | story-fr-2 | covered | The task cites existing telemetry-write and invalid-replacement negative paths. |
| task | task-7 | story-fr-10, story-fr-11 | covered | This infrastructure task serves the existing required-versus-diagnostic safety verdict criteria. |
| task | task-8 | story-fr-3 | covered | The task cites all existing non-authoritative-attribution criteria. |
| task | task-9 | story-fr-5, story-fr-12 | covered | This infrastructure task serves the existing first-BUILD seal and durable-state criteria. |
| task | task-10 | story-fr-5, story-fr-6 | covered | The task cites existing active-step exception and exact-target criteria. |
| task | task-11 | story-fr-5, story-fr-12 | covered | The task cites existing drift and stale-baseline rejection criteria. |
| task | task-12 | story-fr-6 | covered | The task cites existing known-target classification criteria. |
| task | task-13 | story-fr-6 | covered | The task cites existing indeterminate, traversal, and indirection rejection criteria. |
| task | task-14 | story-fr-10, story-fr-12 | covered | This infrastructure task serves existing all-attempt protection and bypass-rejection criteria. |
| task | task-15 | story-fr-10 | covered | The task cites existing applicability and unavailable-protection criteria. |
| task | task-16 | story-fr-11 | covered | The task cites every existing diagnostic-only capability-gap criterion. |
| task | task-17 | story-fr-12 | covered | The task cites existing initial/retry/resume/group/replacement boundary criteria. |
| task | task-18 | story-fr-12 | covered | The task cites existing reusable-state match and stale-state rejection criteria. |
| task | task-19 | story-fr-13 | covered | The task cites every existing actionable protection-failure criterion. |
| task | task-20 | story-fr-14 | covered | The task cites every existing confidential diagnostic/persistence criterion. |
| task | task-21 | story-fr-8, story-fr-9 | covered | This infrastructure task serves existing minimal-home and idempotent-teardown criteria. |
| task | task-22 | story-fr-8, story-fr-15 | covered | The task cites existing minimal Claude home, live-state isolation, and compatibility criteria. |
| task | task-23 | story-fr-8, story-fr-15 | covered | The task cites existing Codex isolation and cross-provider compatibility criteria. |
| task | task-24 | story-fr-8, story-fr-14 | covered | The task cites existing opaque cached-auth and confidentiality criteria. |
| task | task-25 | story-fr-8 | covered | The task cites the existing child-only #904 discovery criterion. |
| task | task-26 | story-fr-7, story-fr-8 | covered | This infrastructure task serves existing live-checkout and unrelated-state integrity criteria. |
| task | task-27 | story-fr-7, story-fr-8 | covered | The task cites existing forbidden-write and unverifiable-boundary negative paths. |
| task | task-28 | story-fr-9 | covered | The task cites existing all-terminal-path teardown criteria. |
| task | task-29 | story-fr-8, story-fr-9 | covered | The task cites existing unisolatable-auth, partial-provisioning, and repeated-cleanup criteria. |
| task | task-30 | story-fr-15 | covered | This refactor task serves every existing Claude compatibility and intentional-isolation criterion. |

## Coverage-table cross-check

The plan's 15-row `Acceptance-Criteria Coverage` table cites only FR-1 through FR-15 and
task-1 through task-30. Every cited task exists in the task tree, every listed task's
`**Story:**` line cites that FR, and no task-tree citation is omitted from the table. No
`claim-<row>` gap is present.

## Verdict

**covered** — 15 FR rows, 15 story rows, and 30 task rows are grounded in the approved
PRD, accepted stories, and approved plan. The outcome row class is not required. No gap
or unconfirmed load-bearing assumption remains.
