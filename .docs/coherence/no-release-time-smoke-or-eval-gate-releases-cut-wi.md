# Coherence Check: Release-time smoke and eval gate (#1259)

**Date:** 2026-08-04
**Tier:** M
**Track:** Technical
**Plan stem:** `no-release-time-smoke-or-eval-gate-releases-cut-wi`
**Result:** COVERED — zero gaps

No `fr` rows are required: this is a technical-track spec with no PRD, so acceptance criteria live
directly in the stories. Outcome ids are 1-based in the order the bullets appear under the
**Desired outcome** heading of jstoup111/ai-conductor#1259.

Every `covered` verdict below was confirmed by reading the counterpart id in its own artifact file,
not inferred from a phrase match.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | "One documented command executes the entire smoke tier." Story 1 tags DO-1; its Done-When requires the `smoke` script plus glob discovery of all nine files. |
| outcome | outcome-2 | story-3, story-4, story-5 | covered | "Cutting a release cannot succeed while the smoke tier is failing." Story 4 blocks the tag and Release; story 3 supplies the free classification that makes the gate affordable; story 5 makes a blocked release recoverable. All three tag DO-2. |
| outcome | outcome-3 | story-1 | covered | "A smoke file added to the repository is picked up without editing a list." Story 1 tags DO-3; its happy path covers a new file under both include globs with no other edit. |
| outcome | outcome-4 | story-4 | covered | "A signal exercises the pipeline against a real agent." Story 4 tags DO-4 and requires the smoke job to call live-daemon-e2e.yml with require_credentials true. |
| outcome | outcome-5 | story-2, story-4 | covered | "Failures are attributable." Story 2 tags DO-5 and requires a per-file ledger naming the unmet capability and evidence path; story 4 requires the failing run to identify the case without local reproduction. |
| outcome | outcome-6 | story-2, story-4 | covered | "Unavailable credentials report explicitly rather than silently passing an empty run." Story 2 tags DO-6 (gate mode fails, all-credentialed-skipped fails, override cannot pass); story 4 covers the workflow layer naming the missing secret. |
| story | story-1 | task-1, task-2, task-3, task-4, task-14 | covered | Entry point and config (1), discovery coverage (2), empty-discovery failure (3), default-run exclusion guard (4), resolution of the three never-run files (14). |
| story | story-2 | task-5, task-6, task-7, task-8, task-9, task-10, task-11, task-12, task-13 | covered | Helper and enum (5), undeclared (6), out-of-set (7), advisory skip (8), gate failure (9), all-skipped failure (10), operator override (11), ledger (12), migration of all nine files (13). |
| story | story-3 | task-15, task-16, task-17 | covered | Extraction (15), zero-mutation and fail-closed rejection paths (16), export plus self-derived publish authority (17). |
| story | story-4 | task-18, task-19 | covered | Three-job restructure with the publishable predicate (18), gate-mode reusable call and fail-closed conclusion handling (19). |
| story | story-5 | task-20 | covered | Idempotent re-run, tag and Release mismatch rejection, and no-partial-state assertions. |
| task | task-1 | story-1 | covered | Type infrastructure; supporting purpose is the entry point Story 1's Done-When names. |
| task | task-2 | story-1 | covered | Happy path — discovery covers every known smoke file. |
| task | task-3 | story-1 | covered | Negative path — empty discovery exits non-zero. |
| task | task-4 | story-1 | covered | Negative path — the default run still excludes smoke. |
| task | task-5 | story-2 | covered | Type infrastructure; supplies the capability enum every later Story 2 task builds on. |
| task | task-6 | story-2 | covered | Negative path — undeclared file rejected. |
| task | task-7 | story-2 | covered | Negative path — out-of-set capability rejected. |
| task | task-8 | story-2 | covered | Happy path — advisory-mode skip names the unmet capability. |
| task | task-9 | story-2 | covered | Negative path — gate mode fails and names the missing secret. |
| task | task-10 | story-2 | covered | Negative path — gate mode fails when no credentialed case ran. |
| task | task-11 | story-2 | covered | Negative path — operator override, including the gate-mode failure that keeps it from passing a release. |
| task | task-12 | story-2 | covered | Happy path — per-file ledger with a failed versus skipped distinction. |
| task | task-13 | story-2 | covered | Type refactor; migrates all nine files onto the declaration mechanism. |
| task | task-14 | story-1 | covered | Type infrastructure; resolves review condition C-2 so the fail-closed gate does not block the first release on a pre-existing defect. |
| task | task-15 | story-3 | covered | Type infrastructure; the extraction Story 3 describes. |
| task | task-16 | story-3 | covered | Negative paths — zero mutation plus every rejection and ignore condition. |
| task | task-17 | story-3 | covered | Happy path — export and self-derived publish authority. |
| task | task-18 | story-4 | covered | Type infrastructure; the three-job restructure Story 4 requires. |
| task | task-19 | story-4 | covered | Negative paths — gate-mode reusable call and fail-closed on any non-success conclusion. |
| task | task-20 | story-5 | covered | Negative paths — recovery, idempotency, and mismatch rejection. |

## Verdict

COVERED. Six outcome rows, five story rows, and twenty task rows, all `covered`; zero gaps. No
coherence waiver is required.

## Corrections made during this pass

Two defects were found and amended in DECIDE rather than deferred to BUILD:

1. The stories file declared headings with no ids while the plan cited Story 1 through Story 5.
   Story headings now carry explicit ids, so every plan citation resolves against a real story id.
2. The plan's Summary claimed 19 tasks against a 20-task tree. Corrected to 20, so the plan's own
   count no longer contradicts its task list.
