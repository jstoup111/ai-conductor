# Complexity: Plans declare ordered slices of one feature (#2723)

Tier: M

## Signals

| Signal | Reading |
|---|---|
| New data models | One parsed structure — an ordered slice manifest (order, title, task ids) plus a parsed per-task dependency set for sliced plans |
| External integrations | None |
| Auth / permissions | None |
| State machines | None — no new step, gate, or lifecycle state; validation rides the existing land gate and the #1700 reseal → coverage_binding path |
| Estimated stories | 5–7 |
| Surfaces touched | plan grammar parser, engineer land gate, coverage_binding re-validation, project config schema + consumer registry + template, plan skill authoring guidance |

## Rationale

Above **S** because it extends the engine-owned plan grammar (new `## Slices` manifest, and the
first real parse of `**Dependencies:**`, which is presence-only today) and adds a land refusal
class and a config key. Those are contracts governed by existing ADRs
(adr-2026-08-30-shared-plan-task-reference-resolver, adr-2026-08-23-criterion-layer-is-structural-at-land,
adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal) and need a design decision,
not only plan tasks.

Below **L**: no runtime behavior changes — the flag is default-off and nothing downstream consumes
slices until #2724. Strict dependency parsing applies only to plans that declare slices, so the
blast radius on the 512 existing plans is nil. Issue is labelled size M.
