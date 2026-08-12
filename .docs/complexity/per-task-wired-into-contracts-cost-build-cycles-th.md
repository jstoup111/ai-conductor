# Complexity: remove the BUILD wiring_check gate

Tier: M

## Signals

| Signal | Count | Mechanical tier |
|---|---|---|
| models | 0 | S |
| integrations | 0 | S |
| auth | 0 | S |
| stateMachines | 1 (the conduct step graph + kickback routing) | M |
| stories | ~8 | M |

`assessTier` on those signals returns **S** (three S signals outbid two M).

## Override to M — rationale

The mechanical signal set is product-shaped: `models`, `integrations`, and `auth`
are all structurally zero for any pure-engine change, so they drag every engine
refactor toward S regardless of its actual blast radius. That under-reads this
change badly:

- It is **consumer-facing** — `**Wired-into:**` is a documented plan convention in
  the shipped `skills/` catalog and `conduct-ts validate-wired-into` is a public
  subcommand. Both are removed, so it carries a `Removed` / `major` disposition.
- It removes ~2,200 lines across `wiring-probe.ts`, `wired-into.ts`,
  `validate-wired-into.ts`, the `artifacts.ts` completion predicate, `conductor.ts`
  kickback routing, `land-spec.ts`, the `/plan` skill, and seven docs pages, plus
  their tests.
- It **relocates a safety gate** — deleting a deterministic BUILD check and
  re-siting the judgement as a fifth `build_review` rubric item. That is exactly
  the class of decision that warrants an ADR and an as-built sweep, and S tier
  would skip `architecture_review`, `conflict_check`, `coherence_check`,
  `manual_test`, and `architecture_review_as_built` — every check that would catch
  a botched teardown.

M (not L): no new subsystem is designed, no data model or integration is added,
and the work is dominated by deletion along seams that are already well isolated.

## Consequence

Full DECIDE artifact set applies: architecture diagram, architecture review with
ADRs, conflict check, and the coherence mapping are all required before land.
