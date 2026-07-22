# Complexity: condense-readme-relocate-docs

Tier: S

## Rationale

Scored against conduct's S/M/L signals — models, integrations, auth, state
machines, story count:

- Data models: none
- Integrations / external services: none
- Auth / permissions: none
- State machines / concurrency: none
- Story count: ~5-7 (slim README; relocate each reference topic; preserve
  cross-references; update "Docs track features" pointers; link-integrity check)

This is a mechanical **content relocation** with a cross-reference sweep. It is
high-*volume* (2139-line README → docs/ topic tree) but low-*complexity*: no code
behavior, no schema, no algorithm, nothing to diagram or architecturally review.
High volume is work quantity, not complexity — so it classifies **Small**.

Per the tier, the DECIDE set skips architecture-diagram, architecture-review, and
conflict-check (there is no architecture surface and no inter-story state/resource
contention — it is one cohesive move). The real risks are **information loss** and
**dangling cross-references**, mitigated in the spec by: (1) exhaustive per-topic
relocation stories that require every relocated section be reachable via a link, and
(2) a link-integrity / README-shape acceptance check as the negative-path guard.

Source-Ref: jstoup111/ai-conductor#787
