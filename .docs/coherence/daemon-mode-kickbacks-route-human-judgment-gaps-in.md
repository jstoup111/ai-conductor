# Coherence Check: daemon-mode DECIDE kickbacks HALT instead of re-running (#551)

**Date:** 2026-07-27
**Tier:** M
**Track:** Technical
**Plan stem:** `daemon-mode-kickbacks-route-human-judgment-gaps-in`
**Result:** COVERED — zero gaps

Technical track: there is no PRD, so there are no `fr` rows — acceptance criteria live in the
stories file. The upstream row class is the five desired-outcome bullets staged from the intake
issue `jstoup111/ai-conductor#551`.

## Traceability mapping

| Row class | Id | Cited ids | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-S1, story-S6 | covered | Engine-enforced DECIDE halt. S1 adds the missing enforcement at the verdict-kickback seam and requires the gap evidence in the halt body; S6 folds the already-shipped remediation guard onto the same predicate so the two seams cannot drift. |
| outcome | outcome-2 | story-S2 | covered | BUILD-phase targets stay autonomous. S2 asserts route-not-halt for every non-DECIDE step across the whole step table, and that deterministic build kickbacks are unchanged. |
| outcome | outcome-3 | story-S3 | covered | Interactive conduct unchanged. S3 makes the proof the unmodified passing of the existing interactive kickback suites, so a diff touching them fails the story. |
| outcome | outcome-4 | story-S4 | covered | Kickback caps preserved. S4 fixes evaluation order so the cap check precedes the phase check, and pins the existing cap test unmodified. |
| outcome | outcome-5 | story-S5 | covered | Resume after a human resolves the halt. S5 requires the needs-human classification that stops auto-clearing, plus a resume criterion composing with the verdict-aware resume clamp. |
| story | story-S1 | task-2, task-3 | covered | Task 3 is the behavioral fix inside the verdict-kickback scan; Task 2 covers S1's unresolvable-target negative path. |
| story | story-S2 | task-1, task-6 | covered | Task 1's table-driven test over the whole step table is the exhaustive scoping proof; Task 6 is the end-to-end build-target case. |
| story | story-S3 | task-8 | covered | Task 8 runs the existing interactive suites unmodified and adds one explicit non-daemon acceptance case. |
| story | story-S4 | task-3, task-8, task-11 | covered | Task 11 is the dedicated cap-precedence spec; Task 3 places the phase check after the cap check; Task 8 runs the existing cap test unmodified. |
| story | story-S5 | task-4, task-5, task-9 | covered | Task 4 pins the halt-class sidecar by content; Task 5 fences the rekick sweep across two shas; Task 9 pins the resume composition. |
| story | story-S6 | task-7 | covered | Task 7 replaces the inline phase check and gates on two existing suites passing unmodified. |
| story | story-S7 | task-10 | covered | Task 10 updates the gates explanation page and the changelog, and records no version bump, no migration block, and no waiver. |
| task | task-1 | story-S2 | traced | Pure predicate module with the DECIDE rule. |
| task | task-2 | story-S1 | traced | Unknown-target and empty-table fail-open cases. |
| task | task-3 | story-S1, story-S4 | traced | Consult the predicate in the verdict-kickback scan, after the cap check. |
| task | task-4 | story-S5 | traced | Halt classified needs-human, sidecar asserted by content. |
| task | task-5 | story-S5 | traced | Rekick sweep never auto-clears the guard, across two shas. |
| task | task-6 | story-S2 | traced | BUILD-phase targets still route under daemon mode. |
| task | task-7 | story-S6 | traced | Replace the inline remediation phase check with the shared predicate. |
| task | task-8 | story-S3, story-S4 | traced | Interactive path regression proof via unmodified existing suites. |
| task | task-9 | story-S5 | traced | Resume after a human clears the halt does not re-walk. |
| task | task-10 | story-S7 | traced | Documentation and changelog. |
| task | task-11 | story-S4 | traced | Cap precedence over the phase check, with the below-cap counter and event still recorded. |

## Reverse check

Every one of the eleven plan tasks appears as a `task` row above and cites at least one story; every
story S1 through S7 appears as a `story` row and cites at least one task; every staged outcome
bullet appears as an `outcome` row with an affirmative verdict. There are no orphan tasks, no
stories without tasks, and no outcomes without stories.

## Note on scope narrowing

The intake describes the DECIDE-rewind hole as open on both routing paths. Discovery established
that the remediation half was already closed by issue #644. The narrowing is traced rather than
dropped: outcome-1 maps to two stories — S1 for the genuinely missing enforcement at the
verdict-kickback seam, S6 for consolidating the shipped guard onto the shared predicate. Nothing
in the intake is left uncovered.
