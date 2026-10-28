# Complexity: build_review severity definitions have one engine-owned source

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None. One exported constant and one render helper beside `renderRubricContractShape` |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None. No step, lap, cache, or verdict behavior changes |
| Story count | 3 (built-in prompts, custom prompt, skills free of the scale) |
| Files touched | `src/conductor/src/engine/build-review-contract.ts`, `src/conductor/src/engine/step-runners.ts` (rubric prompt assembly), `src/conductor/src/engine/build-review-policy-contract.ts`, the three `skills/build-review-*/SKILL.md`, two test files |
| Contract surface | None. Result schemas, contract versions (built-in v4, custom v2), and finding identity are unchanged |

## Rationale

The change moves text that already exists into one engine-owned place and renders it at the two
prompt-assembly seams that already render the shared result schema. It adds no module, layer,
dependency, or event. The rubric cache needs no change: the engine content stamp is already part of
every rubric cache key (`adr-2026-08-21-engine-identity-in-build-review-cache-key` D1 and D2), so a change
to the engine-owned text re-keys judgements exactly as a skill edit does today. The one architecture
touch is an amendment note narrowing the reviewer-guidance bullet of
`adr-2026-10-19-build-review-finding-severity-advisory-threshold` D1, from skill-owned guidance to
engine-owned guidance, which precedent allows at this tier. Estimated 4 plan tasks.
→ **Small**. Architecture-diagram, architecture-review, conflict-check, coherence-check, and plan
review are skipped for this tier.
