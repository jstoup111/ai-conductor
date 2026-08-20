# Complexity: clean-rubric-judgements-rejected-as-invalid-provid

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None. Existing types are refined: the judged-result parse boundary splits into a narrow on-the-wire shape and the unchanged full at-rest shape. |
| External integrations | None. The provider boundary already exists; this narrows what crosses it. |
| Auth / permission surface | None |
| State machines | None new. Touches the existing build_review dispatch → validate → repair → settle path without adding states. |
| Story count | ~10 across four seams (A diagnosis integrity, B planTask canonical form, C engine-owned envelope, D grammar drift guard), each with happy + negative paths |
| Files touched | ~8: `build-review-domain.ts`, `build-review-coordinator.ts`, `step-runners.ts`, the four `skills/build-review-*/SKILL.md` contracts, `test/check_build_review_rubric_skill_vocabularies.sh`, plus `docs/explanation/gates.md` |
| New runtime code | Moderate. A rejection diagnosis that reports unexplained failures honestly, a canonical plan-task normalizer, an engine-side envelope stamp, and a repair-turn no-op guard. |
| Governance weight | One APPROVED ADR amended (`adr-2026-08-13-engine-managed-build-review-rubric-branches` §2), and conformance with an APPROVED-but-unimplemented sibling ADR that an in-flight feature owns. |

## Rationale

Four related but independently testable seams on one existing subsystem. No new entities,
integrations, auth surface, or states — the change is concentrated in a single trust boundary
(the rubric judged-result parse) plus its provider-facing contract text and a drift guard.

The weight above Small comes from breadth rather than depth: four shipped SKILL.md contracts
move together, the envelope change forces an explicit `contractVersion` ruling, and an APPROVED
ADR sentence is amended, so `/architecture-diagram`, `/architecture-review`, `/conflict-check`
and `/coherence-check` all earn their place. It stays below Large because no seam is
architecturally novel: the engine already stamps identity on the cache-hit path, the closed
reason vocabulary already exists, and the drift-guard pattern already exists for vocabularies —
each seam extends a mechanism that is present and working rather than introducing one.

Cross-feature coordination with `review-infrastructure-failures-are-operator-unreco` is real but
bounded to a declared dependency, not shared implementation. → **Medium.**
