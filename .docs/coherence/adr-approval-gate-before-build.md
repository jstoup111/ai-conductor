# Coherence Mapping: ADR approval enforced before build

**Date:** 2026-08-08
**Feature:** adr-approval-gate-before-build
**Source-Ref:** jstoup111/ai-conductor#662
**Plan stem:** `adr-approval-gate-before-build`
**Tier:** M
**Track:** technical
**Result:** COVERED — zero gaps

The `fr` row class is omitted: this is a technical-track spec with no PRD, so there are no `FR-N`
to trace. Every `covered` verdict below was confirmed by reading the counterpart artifact file, not
inferred from a plausible id. The story→task mapping was additionally cross-checked mechanically —
all 7 story ids in the stories file receive at least one task, and all 12 task `**Story:**` lines
cite a story id that exists.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-3 | covered | Fail fast when a governing ADR is not approved, before spec authoring rather than after ship steps. Satisfied by a different mechanism than the filer proposed: the intake hypothesized a precondition on writing-system-tests; DECIDE placed enforcement at engineer land (pre-merge), which is strictly earlier since writing-system-tests cannot run until a spec has merged. Mechanism deliberately superseded per the hypothesis-is-not-requirement rule. story-1 supplies the signal, story-2 makes it the only signal, story-3 enforces it. |
| outcome | outcome-2 | story-4, story-5 | covered | A daemon-dispatched build cannot start when the ADR set contains non-approved members, with a reason naming the ADR. story-4 supplies the base-branch enumeration the check requires; story-5 blocks dispatch and requires the remedy to name the offending ADR and its status, satisfying the naming clause directly. |
| outcome | outcome-3 | story-6 | covered | The as-built check stays as the backstop and firing there becomes the exception path. story-6 asserts the as-built verdict logic is unchanged and its existing tests pass unmodified; the exception-path half is structural, since outcome-1 and outcome-2 install earlier rungs so as-built can only fire on what they did not catch. |
| story | story-1 | task-1, task-2, task-3, task-4 | covered | Parser contract split across its four non-negotiable properties: allowlist grammars, fence exclusion, line-anchoring with first-wins and fail-closed, and a whole-corpus proof. |
| story | story-2 | task-5 | covered | Single cutover task; both callers migrate and the old export is deleted in one commit so the build is never red between steps. |
| story | story-3 | task-6 | covered | Rung 1 rejection message names the offending file and the status found, and distinguishes a missing declaration from a disallowed value. |
| story | story-4 | task-7, task-8 | covered | task-7 adds the required interface member and updates all 13 typed test doubles in the same task; task-8 covers absent-directory, git-failure, and empty-corpus degradation. |
| story | story-5 | task-9, task-10 | covered | task-9 blocks dispatch with per-slug rows; task-10 covers the once-per-pass scan, once-per-pass logging, and next-pass recovery. |
| story | story-6 | task-11 | covered | Verify-only regression guard; the as-built path never referenced the removed export, so the assertion is that nothing changed. |
| story | story-7 | task-12 | covered | Template and architecture-review skill vocabulary aligned to the allowlist, then the repository integrity suite is run. |
| task | task-1 | story-1 | covered | happy-path — allowlisted grammar forms. |
| task | task-2 | story-1 | covered | negative-path — fenced examples must not be read as declarations. |
| task | task-3 | story-1 | covered | negative-path — mentions, first-wins, fail-closed. |
| task | task-4 | story-1 | covered | negative-path — corpus-wide regression proof. |
| task | task-5 | story-2 | covered | refactor — supporting purpose is the single-source-of-truth cutover; cites a real story. |
| task | task-6 | story-3 | covered | negative-path — rung 1 message content. |
| task | task-7 | story-4 | covered | infrastructure — interface extension plus the 13 test doubles it necessarily breaks. |
| task | task-8 | story-4 | covered | negative-path — safe degradation and the empty-corpus-passes rule. |
| task | task-9 | story-5 | covered | happy-path — rung 2 blocking behavior and per-slug reporting. |
| task | task-10 | story-5 | covered | negative-path — pass-scoped scan and logging, plus operator recovery. |
| task | task-11 | story-6 | covered | refactor, verify-only — proves existing behavior is unaffected; completes via an empty commit with an evidence trailer. |
| task | task-12 | story-7 | covered | happy-path — authoring vocabulary alignment. |

## Result

No gaps. 3 outcome rows, 7 story rows, and 12 task rows are all `covered`; the `fr` row class is
correctly omitted for a technical-track spec. No `.docs/coherence-waivers/` entry is required.

One assumption was surfaced and resolved during authoring. The staged intake outcomes file
(`.pipeline/intake-outcomes.md`) was written with an empty outcome block, because the claim that
started this session returned a reaped-stale-claim placeholder rather than the issue body, and
because the issue titles its section `OUTCOMES` while the staging parser
(`engineer/outcome-staging.ts:23`) extracts a `Desired outcome` section. The three bullets traced
above were restored verbatim from the real issue body under the heading the parser expects, so the
committed `.docs/intake/` marker and this mapping cite the same outcome text rather than an empty
section.
