# Coherence: Off-tag checkout reports up to date forever (#1437)

**Date:** 2026-08-09
**Track:** technical — the `fr` row class is omitted because there is no PRD and no enumerated
`FR-N`; on this track the stories are themselves the acceptance-criteria artifact. Omission is
correct here, not a gap.
**Tier:** M
**Source:** jstoup111/ai-conductor#1437

Outcome ids are the four Desired-outcome bullets of the originating issue, in bullet order, as
recorded in the stories file header (`DO-1`…`DO-4`). Story ids are the headings `## Story 1:`
through `## Story 10:`. Task ids are the plan's task tree: `1, 2, 3, 4, 5, 6, 7, 7.1, 8, 9, 10,
11, 12, 13, 14`.

Every `covered` verdict below was confirmed by reading the counterpart's own artifact file —
the stories file for story ids, the plan's `**Story:**` lines for task ids — not inferred from
the mapping supplied to this step. Two rows were re-derived rather than transcribed: the
supplied mapping listed Task 14 under Story 10 and Task 7.1 under Story 8, and both were checked
against the plan text before being recorded.

A consistency pass (§4d) was run over every covered row for cross-layer contradiction and
oscillation — outcome↔task and outcome↔story pairs sharing a subject. No `fail` rows resulted;
the one same-layer contradiction found during DECIDE (Story 5 vs Story 8, over whether the
between-releases fixture records a version) was resolved by `/conflict-check` and amended into
both the stories file and `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` before this
artifact was authored, so it is no longer live in either direction.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-3, story-8, story-10 | covered | "Identifies itself correctly or reports that it cannot; never silently concludes it is current." story-2 is the reported defect's direct guard (post-release, no newer release → non-empty output). story-3 covers the drifted-but-updatable case, story-8 removes the contradicting record's authority, story-10 closes the second entry point. |
| outcome | outcome-2 | story-6, story-7 | covered | "A user can tell which identity it used and where it came from." story-6 requires exactly one identity line naming identity and source on every tagged check that reaches a decision; story-7 extends the same guarantee to the main channel. Operator confirmed this applies to every invocation including `--auto`. |
| outcome | outcome-3 | story-4 | covered | "An install exactly on a release tag continues to resolve identity from the checkout and be offered newer tags exactly as today." story-4 is a pure regression story; its Done When pins the existing `i17-installed-tag` and `i17-recorded-tag` assertions as unchanged. Both were re-derived empirically during conflict-check and reproduce under the new rule. |
| outcome | outcome-4 | story-5 | covered | "An install with no determinable identity still declines to guess." story-5 preserves the refusal while `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` moves its trigger from "no recorded identity" to "no reachable release tag". The refusal is unchanged; only the condition that fires it is made testable. |
| story | story-1 | task-1, task-2 | covered | Resolver. task-1 is the RED specs (three kinds, highest-reachable-wins, 22-tag no-truncation, `-rc1` exclusion); task-2 implements `resolve_harness_identity`. Both cite `**Story:** Story 1`. |
| story | story-2 | task-4 | covered | The reported defect. task-4's step 1 asserts non-empty output for a checkout past the newest tag and its step 4 asserts HEAD unchanged — the direct regression guard. |
| story | story-3 | task-5 | covered | Drifted checkout with a newer release still offered. task-5 covers accept, decline, migrate-failure rollback, and no-TTY. |
| story | story-4 | task-3 | covered | Exact-tag behavior preserved. task-3 routes the tagged check through the resolver and re-verifies both untouched `#1005` fixtures. |
| story | story-5 | task-7, task-12, task-13 | covered | Declines to guess. task-7 implements the undeterminable branch, task-12 retargets the two `#1005` assertions, task-13 adds the no-reachable-tag fixture that gives the refusal its first genuine test. |
| story | story-6 | task-6 | covered | Identity line on every check. task-6 emits it once immediately after resolution, before any branch, so no exit path can skip it; its negative cases pin `autoCheck=false` and non-git as silent. |
| story | story-7 | task-8 | covered | Main-channel identity. task-8 emits the line before the level-with-remote early return at `bin/update:193` and leaves all offer/pull behavior unchanged. |
| story | story-8 | task-7.1 | covered | Record demoted to write-only cache. task-7.1 persists the baseline (never the `«tag»+N` display form), writes only through `conductor_cfg_set`, and removes the remaining `conductor_cfg_get currentVersion` read from the decision path. |
| story | story-9 | task-11 | covered | Installer stops guessing. task-11 rewrites `detect_current_version` to delegate to the resolver and drops the `VERSION` fallback for tagged identity. |
| story | story-10 | task-9, task-10, task-14 | covered | Mirror and parity. task-9 updates `bin/conduct`'s duplicate, task-10 adds the fail-closed divergence check, task-14 records the release waiver naming the `bin/conduct CLI` surface the mirror edit trips. |
| task | task-1 | story-1 | covered | Cites `**Story:** Story 1`. Type negative-path; RED specs for the resolver. |
| task | task-2 | story-1 | covered | Cites `**Story:** Story 1`. Type infrastructure; the resolver itself, landed inert. |
| task | task-3 | story-4 | covered | Cites `**Story:** Story 4`. Routes the tagged check through the resolver while preserving exact-tag behavior. |
| task | task-4 | story-2 | covered | Cites `**Story:** Story 2`. The defect fix. |
| task | task-5 | story-3 | covered | Cites `**Story:** Story 3`. Drift plus offer. |
| task | task-6 | story-6 | covered | Cites `**Story:** Story 6`. Always-printed identity line. |
| task | task-7 | story-5 | covered | Cites `**Story:** Story 5`. Undeterminable branch; persists nothing. |
| task | task-7.1 | story-8 | covered | Cites `**Story:** Story 8`. Split out of task-7 during plan authoring precisely so story-8 had a task naming it — before the split, story-8's criteria were implemented but untraced. |
| task | task-8 | story-7 | covered | Cites `**Story:** Story 7`. Main-channel identity line. |
| task | task-9 | story-10 | covered | Cites `**Story:** Story 10`. The `bin/conduct` mirror. |
| task | task-10 | story-10 | covered | Cites `**Story:** Story 10`. Divergence guard in `test/test_harness_integrity.sh`; discharges condition C2's "assert both copies agree" requirement. |
| task | task-11 | story-9 | covered | Cites `**Story:** Story 9`. Installer identity fix. |
| task | task-12 | story-5 | covered | Cites `**Story:** Story 5`. Retargets the `#1005` assertions with an inline ADR citation. |
| task | task-13 | story-5 | covered | Cites `**Story:** Story 5`. The no-reachable-tag fixture. |
| task | task-14 | story-10 | covered | Cites `**Story:** Story 10`. Type infrastructure. The release waiver is not itself behavior, but it is the artifact that lets story-10's `bin/conduct` edit ship without an invented migration block, so it is traced to story-10 rather than exempted. |

**Result: 29 rows, 0 gap, 0 fail.** Every desired outcome has at least one story; every story has
at least one task; every task cites a story that exists.

Three findings from the consistency pass, all resolved before this artifact and recorded here so
a reader does not re-derive them:

- **outcome-2 ↔ task-6 (cross-layer, checked both directions).** outcome-2 demands the user can
  always tell which identity was used; task-6 exempts `autoCheck=false` and non-git checkouts
  from printing. Not a contradiction: both exempted paths return before any identity is resolved
  or any decision is reached, so there is no identity to report. Satisfying task-6 fully leaves
  outcome-2 holding, and vice versa.
- **outcome-4 ↔ task-7.1 (cross-layer).** outcome-4 forbids guessing; task-7.1 writes a version
  record. Not a contradiction: task-7.1 persists only on determinable kinds and explicitly
  persists nothing when the identity is undeterminable.
- **outcome-3 ↔ task-3 (cross-layer).** outcome-3 requires today's behavior for exact-tag
  installs while task-3 replaces the resolution mechanism wholesale. Confirmed compatible by
  rebuilding both `#1005` fixtures and executing the new resolution commands against them: each
  yields the same baseline the old exact-match/record path produced, because `v0.4.0` is a
  descendant in both and `git tag --merged HEAD` correctly excludes it.
