# Coherence: Move wiring judgement into build_review

**Date:** 2026-08-11
**Source:** intake #1496
**Tier:** M · **Track:** technical
**Plan:** `.docs/plans/per-task-wired-into-contracts-cost-build-cycles-th.md` (17 tasks)
**Stories:** `.docs/stories/per-task-wired-into-contracts-cost-build-cycles-th.md` (7 stories)

One row class is **omitted entirely**, and the omission is correct rather than a gap:

- **`fr`** — technical track, no PRD. Acceptance criteria live directly in the stories.

Both ADRs authored for this spec are APPROVED and uncontested; each carries an affirmative `adr`
adjudication row below naming the stories it governs.

**Outcome-4 required a design change, recorded here rather than silently dropped.** The staged
bullet asks that intentionally-unwired code have "one documented way to pass" leaving "a reviewable
record of which symbols were waived and why." The design as reviewed had no such hatch — deleting
the contract layer removed the `none (inert until <ref>)` waiver form with nothing in its place.
Rather than reintroduce a waiver grammar (which would recreate the notation-kickback class this
spec exists to eliminate), the resolution reuses an input the grader already receives: a plan task
that states in its own Steps that it ships scaffolding for a later task has declared intentional
non-wiring, and the committed plan is the reviewable record. Silence is never an implicit waiver.
Added to story ST-1496-1 as two acceptance criteria and to task-4 as step 4.

**Outcome-3's "at BUILD" is satisfied in spirit, with one honest deviation.** The bullet asks that
a wiring failure "at BUILD" name the unreachable symbol and never report a failure whose remedy is
editing plan notation. Both properties hold, and the failure still surfaces during the BUILD phase —
but it is now reported by `build_review` rather than by `wiring_check`. The bullet's intent (an
actionable, code-level failure, not a notation one) is fully delivered; only the reporting step
differs from what the filer assumed.

**Outcome-2 is over-delivered.** The bullet asks for BUILD failure on unwired exports "at every
complexity tier, including S." `build_review` is `skippableForTiers: []`, so the new item covers S —
which the deleted `wiring_check` also did, but which neither SHIP-side check does. The filer's
premise that SHIP independently sweeps reachability is false at S tier
(`architecture_review_as_built` and `manual_test` are both `skippableForTiers: ['S']`); this is
recorded in `adr-2026-08-11-wiring-judged-in-build-review`.

## Traceability mapping

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| adr | adr-2026-08-11-wiring-judged-in-build-review | story-ST-1496-1, story-ST-1496-3, story-ST-1496-4 | agrees | APPROVED and uncontested. Its decision — wiring becomes a fifth build_review rubric item, the probe and contract layers are deleted — is exactly what these three stories specify. No story contradicts it. |
| adr | adr-2026-08-11-deprecated-no-op-step-retirement | story-ST-1496-2 | agrees | APPROVED and uncontested. Its decision — retain wiring_check as a deprecated no-op emitting a spine event, delete the name only in a later change — is exactly what ST-1496-2 specifies. No story contradicts it. |
| outcome | outcome-1 | story-ST-1496-3 | covered | Plans author and land with no wiring contracts; the landSpec 4b-ii gate and the validate-wired-into subcommand are both removed by tasks 11 and 12. |
| outcome | outcome-2 | story-ST-1496-1 | covered | BUILD still fails on an export nothing outside its defining file references, at every tier — build_review is never tier-skipped. Delivered by tasks 3-5. |
| outcome | outcome-3 | story-ST-1496-1 | covered | The failure names the symbol and the paths searched and never cites plan notation. Reported by build_review rather than wiring_check — see the deviation note above. |
| outcome | outcome-4 | story-ST-1496-1 | covered | Plan-stated scaffolding intent is the documented hatch; the committed plan is the reviewable record. Added during this pass — see the note above and Amendments below. |
| outcome | outcome-5 | story-ST-1496-7 | covered | The SHIP as-built reachability sweep is unchanged in behavior; task-16 adds only an ADR citation to it. |
| story | story-ST-1496-1 | task-3, task-4, task-5 | covered | Confirmed against the plan: tasks 3, 4 and 5 each carry a Story line citing ST-1496-1. |
| story | story-ST-1496-2 | task-6, task-7, task-8, task-9, task-10 | covered | Confirmed: all five cite ST-1496-2 — the event variant, the no-op predicate, and the kickback-route removal. |
| story | story-ST-1496-3 | task-11, task-12 | covered | Confirmed: both cite ST-1496-3. |
| story | story-ST-1496-4 | task-13, task-14 | covered | Confirmed: both cite ST-1496-4. |
| story | story-ST-1496-5 | task-1, task-2 | covered | Confirmed: both cite ST-1496-5. |
| story | story-ST-1496-6 | task-15 | covered | Confirmed: task-15 cites ST-1496-6. Regression fence only — deliberately adds no production change. |
| story | story-ST-1496-7 | task-16, task-17 | covered | Confirmed: both cite ST-1496-7. |
| task | task-1 | story-ST-1496-5 | covered | RED: a verdict lacking the wiring key is not judged. |
| task | task-2 | story-ST-1496-5 | covered | GREEN: the verdict schema carries rubric.wiring and findings.wiring. |
| task | task-3 | story-ST-1496-1 | covered | RED: configured entry points reach the grader prompt. |
| task | task-4 | story-ST-1496-1 | covered | GREEN: the fifth rubric item, the rendered entry points, and the plan-stated-scaffolding hatch. |
| task | task-5 | story-ST-1496-1 | covered | The all-or-FAIL evaluation covers five items and kicks back through the existing route. |
| task | task-6 | story-ST-1496-2 | covered | RED: the deprecation event variant is specified. |
| task | task-7 | story-ST-1496-2 | covered | GREEN: the variant exists and renders through the existing daemon switch. |
| task | task-8 | story-ST-1496-2 | covered | RED: wiring_check passes unconditionally under every degraded input. |
| task | task-9 | story-ST-1496-2 | covered | GREEN: the predicate becomes a no-op, emits the notice, and drops the evidence artifact. |
| task | task-10 | story-ST-1496-2 | covered | Remove the wiring_check kickback route and the entries assuming the step does work. |
| task | task-11 | story-ST-1496-3 | covered | Remove the DECIDE-time wiring anchor gate; other landSpec gates still reject. |
| task | task-12 | story-ST-1496-3 | covered | Remove the validate-wired-into subcommand and its re-exports. |
| task | task-13 | story-ST-1496-4 | covered | Delete the three wiring modules and their six test files; WIRED_INTO_LINE leaves plan-task-parse. |
| task | task-14 | story-ST-1496-4 | covered | Remove the vestigial gate-instruction feed and the remaining step entries; WiringConfig is retained. |
| task | task-15 | story-ST-1496-6 | covered | Fence the Files convention and the seal's branching against regression. |
| task | task-16 | story-ST-1496-7 | covered | Update skills/plan and skills/architecture-review; §12 sweep behavior unchanged. |
| task | task-17 | story-ST-1496-7 | covered | Update the five docs pages and HARNESS.md; regenerate the model table if the step row changed. |

## Amendments made during this pass

1. **Story ST-1496-1 gained two acceptance criteria** covering the plan-stated-scaffolding hatch and
   its negative counterpart (silence is not a waiver), closing outcome-4.
2. **Task 4 gained step 4**, instructing the grader to honor plan-stated scaffolding intent, and its
   remaining steps were renumbered.
3. **Story ST-1496-1 and Story ST-1496-4 were amended earlier**, during `/conflict-check`, to retain
   `WiringConfig.entry_points` and render it into the prompt — the blocking conflict recorded in
   `.docs/conflicts/per-task-wired-into-contracts-cost-build-cycles-th.md`.
