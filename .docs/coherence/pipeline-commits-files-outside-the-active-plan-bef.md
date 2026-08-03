# Coherence Mapping: Plan-scope containment at the commit boundary

**Date:** 2026-08-02
**Tier:** M
**Track:** technical (FR rows are not applicable)
**Source:** `jstoup111/ai-conductor#1227`

## Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-TI-1, story-TI-2, story-TI-4, story-TI-5 | covered | Enforcement lands one step earlier than "recorded complete" — at the commit — which strictly implies it; TI-4's `Scope:` trailer is the explicit widening, and TI-5's containment-floor record is what makes it reviewable, since the grader receives a diff rather than the commit log. |
| outcome | outcome-2 | story-TI-2, story-TI-3 | covered | The commit-msg hook fires during the task itself, so a violation cannot reach a later task or SHIP; TI-2 requires the task id and offending paths in the message; TI-3 keeps it from over-firing. |
| outcome | outcome-3 | story-TI-2, story-TI-4 | covered | Two paths for legitimate collateral edits: the plan already declares the file (TI-2 happy path) or a `Scope:` trailer widens the set for that commit (TI-4). |
| outcome | outcome-4 | story-TI-6 | covered | TI-6 reproduces the #1074 config-only plan plus finish/finalizer edits and asserts deterministic refusal, and also asserts an in-scope commit is accepted so the test discriminates. |
| story | story-TI-1 | task-1, task-2 | covered | Seeding declared paths onto task rows, plus preservation of existing row state and the none/empty/legacy edge cases. |
| story | story-TI-2 | task-3, task-4, task-8, task-9, task-10 | covered | Core containment rule, anchored matching, the refusal message, replacement of the dead hook block, and exemption handling. |
| story | story-TI-3 | task-5, task-8, task-10 | covered | The full abstention matrix in the evaluator, the three-valued exit contract that makes abstention survive `set -e`, and hook-level exemptions plus fail-open on dispatch failure. |
| story | story-TI-4 | task-6, task-7 | covered | `Scope:` trailer parsing and fail-closed handling of malformed trailers. No docs-guard task is needed — the trailer writes no file. |
| story | story-TI-5 | task-12, task-13 | covered | The engine-side containment floor, its record of accepted `Scope:` widenings for `build_review`, and its fail-soft, exempt-commit-aware behavior. |
| story | story-TI-6 | task-14 | covered | The #1074 regression acceptance test, shipped with the documentation and migration obligations. |
| story | story-TI-7 | task-11 | covered | Report-only as the shipped default, with enforcement a follow-up flip earned on live containment-floor data. |
| task | task-1 | story-TI-1 | covered | Seed plan-declared paths onto task rows, only from an explicit `**Files:**` line. |
| task | task-2 | story-TI-1 | covered | Preserve existing row state and handle none/empty/legacy plans and the parser's prose fallback. |
| task | task-3 | story-TI-2 | covered | Pure containment evaluator core rule. |
| task | task-4 | story-TI-2 | covered | Segment-anchored matching and the machinery allowlist. |
| task | task-5 | story-TI-3 | covered | Abstention matrix, one case per architecture-review F2 condition, including the stale-stamp row-status abstention. |
| task | task-6 | story-TI-4 | covered | `Scope:` trailer parser and per-commit widening. |
| task | task-7 | story-TI-4 | covered | Malformed trailers treated as absent, never blanket permission. |
| task | task-8 | story-TI-2, story-TI-3 | covered | scope-check CLI, its three-valued exit contract, and the actionable refusal message (conflict-check C1 mitigations). |
| task | task-9 | story-TI-2 | covered | Replace the dead bundling block in the commit-msg hook. |
| task | task-10 | story-TI-3 | covered | Inherited exemptions and fail-open on scope-check failure. |
| task | task-11 | story-TI-7 | covered | Report-only mode as the shipped default. |
| task | task-12 | story-TI-5 | covered | Engine-side containment floor and the accepted-widening record supplied to `build_review`. |
| task | task-13 | story-TI-5 | covered | Floor fail-soft behavior and exempt-commit filtering. |
| task | task-14 | story-TI-6 | covered | #1074 regression test, documentation updates, and the runnable migration block. |

## Verdict

Every desired outcome maps to at least one accepted story, every accepted story maps to real
plan tasks, and every task cites exactly one accepted story. No FR class applies on the
technical track. Zero gaps.

## Constraint traceability

The architecture review's seven binding constraints are each carried by a task: F1 (replace the
dead block, regression-test containment) by tasks 9 and 14; F2 (enumerate every abstention, and
the three-valued exit contract that keeps abstention from failing closed under `set -e`) by
tasks 5, 8 and 10; F3 (no path matching re-implemented in shell) by tasks 8 and 9; F4 (a real
runnable migration block, not a waiver) by task 14; F5 (ship the backstop in this feature, and
make `Scope:` widenings reviewable through it) by tasks 12 and 13; F5's seeding constraint (only
an explicit `**Files:**` line declares scope) by tasks 1 and 2; F6 (ship report-only) by
task 11.

The conflict-check mitigations are likewise covered: C1's three requirements — the refusal
message must print the exact `Scope:` line to add per offending path, must be distinguishable
from a generic commit failure, and must be asserted by test — by tasks 8 and 10, with report-only
shipping (task 11) ensuring the #1258 loop cannot be wedged before the refusal rate is measured;
C2's concurrent-stamp safety by the no-trailer and stale-row abstentions in tasks 5 and 10; C3's
unwired-hook exposure by tasks 12 and 13. C5 no longer requires a task — the `Scope:` trailer
writes no file, so the docs-guard is never involved.

Documentation obligations all land in task 14: the new CLI verb in `docs/reference/cli.md`, the
hook behavior change and report-only default in `docs/reference/settings-and-hooks.md`, the new
gate and `Scope:` trailer contract in `docs/explanation/gates.md`, and the `CHANGELOG.md
[Unreleased]` entry with its
migration block. `VERSION` is deliberately untouched — the repository is version-locked pre-v1.

## Residual gaps

None blocking. Two items are consciously deferred with recorded rationale. The mis-stamp case
under concurrent dispatch (a stamp present but belonging to a different in-flight task) could
produce a wrong refusal; that is #531's defect, and this spec fails open on the absent-stamp
case #531 actually produces, and additionally abstains when the stamped row is not
`in_progress`. Separately, an agent may fail to use the `Scope:` trailer and spin until the
kickback budget halts for a human — bounded by existing machinery, by report-only shipping, and
the correct terminal state for a plan-implicating decision under #989.
