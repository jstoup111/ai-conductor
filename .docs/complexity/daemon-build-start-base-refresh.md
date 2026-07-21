# Complexity: daemon-build-start-base-refresh

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | Extends `StepConfig` (+`action?`); a small engine-native action registry (1 entry: `base-refresh`) |
| External integrations | None new — reuses existing `resolveBase` (git fetch origin) and the hook runner |
| Auth / permission surface | None — daemon already has the fetch creds it uses at ship-time rebase |
| State machines | Modifies the step-sequence builder + dispatch loop to run skill-less (action/hook) custom steps; base-refresh inserted `after: plan` |
| Story count | 6 (framework happy + base-refresh happy + 4 negatives: skill-less body, bad `after`/cycle, conflict HALT, no-origin/non-daemon no-op) |
| Files touched | `types/config.ts`, `engine/config.ts` (validation), `engine/steps.ts` (`buildStepRegistry`), `engine/conductor.ts` + `engine/hooks.ts` (dispatch/action wiring), new action registry, this repo's `.ai-conductor/config.yml`, tests, README, CHANGELOG |
| New runtime code | Moderate — relax skill-mandatory → skill-optional, add action registry + one action, wire `runWithHooks`/action dispatch into the loop; base-refresh action composes existing primitives |

## Rationale

**M, not S.** This is no longer a single boolean — it is a general custom-step framework
(skill | engine-action | hook-only bodies) plus one wired instance. **But not from scratch:**
the skeleton already exists in source — `StepConfig` already carries `after`/`skill`/
`enforcement`/`hooks`/`gate`, `buildStepRegistry` already splices customs at `after`, the
validator already rejects unknown `after` targets, and `runWithHooks` already exists. The net
new work is bounded: (a) make `skill:` optional when an `action:` or `hooks.before` body is
present (validator + registry), (b) add an `action:` field + a tiny engine-action registry
with `base-refresh` as its only entry, (c) **wire the hook/action dispatch into the step loop**
(`runWithHooks` currently has no callers), (d) reject `after:` cycles among sibling customs,
(e) wire the base-refresh instance in this repo's config. No new external system, no schema
migration (additive config only), no product/UX surface; the git mechanic is three
already-tested functions reused verbatim.

**Not L:** bounded blast radius behind an opt-in `steps:` map that is empty for every consumer;
no distributed/stateful new subsystem. **Edge-to-L risk (surfaced):** if wiring non-skill
dispatch into the loop turns out deeper than the `runWithHooks` seam suggests (STEP_PROMPTS is
keyed by built-in `StepName`, so custom-name dispatch/prompt resolution may need more plumbing),
this could grow toward L — flagged in the plan as the primary scope risk. → **M**.
