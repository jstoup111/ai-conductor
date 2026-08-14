# Complexity: remediate routes buildable review gaps to plan

**Plan stem:** `remediate-routes-buildable-review-gaps-to-plan-hal`
**Date:** 2026-08-14
**Source:** jstoup111/ai-conductor#1550

Tier: S

## Signals

Same signal set conduct uses (models, integrations, auth, state machines, story count):

| Signal | Value | Reading |
|---|---|---|
| New data models / schema | 0 — `.pipeline/remediation.json` keeps its existing shape; the coverage evidence goes in the existing free-text `rationale` field | Small |
| External integrations | 0 | Small |
| Auth surface | 0 | Small |
| State machines | 0 new — the existing kickback/DECIDE-refusal machinery is deliberately untouched | Small |
| Modules touched | 3 — `skills/remediate/SKILL.md`, `agents/remediation-planner.md`, and two lines of `src/conductor/src/engine/conductor.ts` | Small |
| Story count | 3 | Small |

## Rationale

The delivered change is almost entirely prompt-contract text in one skill and one agent persona:
a `build_review` trigger row with its gap-id format, a mandatory coverage check against the
approved plan's existing tasks before any `plan` disposition, the fact that `plan` is a terminal
needs-human HALT in a daemon run, and a `rationale` that names the tasks the gap was matched
against. The engine edit is two lines in the existing build_review→remediate dispatch: drop the
"the plan task may be under-decomposed" priming, and pass the already-resolved active plan path
so the coverage check is executable inside a daemon worktree.

No new contract, no new step, no new gate, no new event, no schema migration. The routing
machinery that produced the halt — `buildReviewFailRoute`, `readRemediationPlan`,
`decideEntryDisposition` — is verified correct and stays as-is, so there is no architectural
decision to take and nothing for a conflict-check to weigh against sibling work.

The one signal arguing upward is blast radius: the remediation planner serves every SHIP gate,
so a careless rewrite of its disposition rules could misroute `prd_audit` or as-built
architecture gaps too. That is contained by scoping every new rule to the `plan` disposition and
the `build_review` trigger, and by covering the untouched triggers in the negative-path stories —
it does not add design surface, so it does not lift the tier.

## Tier effects

Small: `/architecture-diagram`, `/architecture-review`, `/conflict-check`, and `/coherence-check`
are skipped; `/prd` is skipped on the technical track. Stories carry the acceptance criteria.
