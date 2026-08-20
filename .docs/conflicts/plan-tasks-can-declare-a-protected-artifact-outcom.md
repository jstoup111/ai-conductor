# Conflict Check: Plan tasks can declare a protected-artifact outcome BUILD cannot deliver

Date: 2026-08-19
Feature: plan-tasks-can-declare-a-protected-artifact-outcom
Verdict: **Clean — after the required amendments below are performed in this change set.**

## In-flight overlap scan

| Feature | State | Overlap | Verdict |
| --- | --- | --- | --- |
| #1629 `review-infrastructure-failures-are-operator-unreco` | spec merged, build in flight (PR #1734) | Both were reachable from ai-conductor#1736's desired outcomes | **None.** The kickback-budget and mechanical-fault lane were scoped out of this feature; it now touches no build_review surface at all. |
| #647 `kickback-to-build-no-op-when-target-evidence-stamped` | plan on main, unbuilt | Both concern unproductive kickback loops | **None.** #647 edits the kickback→build seam in `conductor.ts`; this feature edits `plan-protected-targets.ts` and prose. Disjoint files, disjoint predicates. |
| #1700 | open | Plan diverged from an amended DECIDE artifact | **None.** There the plan is wrong; here the plan is right and the outcome is unreachable. Distinct classes, stated in ai-conductor#1736 itself. |
| `rebase-invalidated-test-suite-proof-halts-build-re` (#1729) | spec merged (PR #1732) | Touches build_review dispatch | **None.** No shared file or predicate. |

No resource contention, no state-machine conflict, no oscillating requirement pair.

## Required Amendments (same change set)

The scan found the feature falsifies an assertion repeated in **four** accepted artifacts. All four
state the sealed set as **four** directories and omit `.docs/decisions/`, while
`protected-artifact-seal.ts:17-22` has had **five** throughout. The artifact at the centre of
ai-conductor#1736 was an ADR under the omitted directory — so every normative statement in the
corpus told the plan author that an ADR-checkbox task was permitted.

| Artifact | Line | Falsified assertion | Owner |
| --- | --- | --- | --- |
| `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` | §3 | "The four sealed directories only — `.docs/architecture`, `.docs/plans`, `.docs/specs`, `.docs/stories`" | **DECIDE performs it now** — the file is under `.docs/decisions/` and is therefore protected. Tasking it would commit the exact violation this feature exists to prevent. |
| `HARNESS.md` | 123-124 | Same four-directory list | BUILD (not a protected path) |
| `skills/plan/SKILL.md` | 143-144 | Same list, **and** scopes the ban to the `**Files:**` set only | BUILD (not a protected path) |
| `skills/remediate/SKILL.md` | 101 | Same four-directory list | BUILD (not a protected path) |

**Disposition.** Per `adr-2026-08-04` §1 and `skills/conflict-check`'s accepted-artifact amendment
rule, the ADR amendment is performed during this DECIDE pass and committed on the spec branch; the
plan carries **no task** for it. The other three live outside the sealed directories, so they are
ordinary BUILD tasks.

## Note on this feature's own compliance

This spec must not commit the violation it fixes. The ADR under `.docs/decisions/` is amended here,
at DECIDE time, and is deliberately absent from the plan's task list and from its claimed outcomes —
so no completeness finding can anchor to a deliverable that will sit in the build branch's base
rather than its diff.
