# Complexity: source-grounded adversarial plan review before land (#3038)

Tier: M

## Rationale

- **Models:** yes — one new adversarial review dispatch (fresh subagent reading real source) with a
  schema-constrained findings shape and a hard one-review-plus-one-re-check bound.
- **State machine:** yes — a new DECIDE step after `coherence_check` (tier-skipped at S), plus a
  `landSpec` rung that refuses land on a missing review artifact or an unresolved blocking finding.
- **Integrations / auth / schema:** none external — single repo; one new committed `.docs/` review
  artifact and one deterministic candidate-builder primitive over plan text and target source.
- **Removals:** coherence-check §4a/§4d judge re-runs and plan §7b at M/L (§7b kept at S) — skill
  edits only, no directory deletion.
- **Story count:** estimated 7–9 (candidate builder ×3 lenses, review skill + findings schema,
  bound/operator handoff, step registration + tier skip, land rung, judge removals, docs).

Medium: real step and model involvement, but one repo and proven analogs for every piece
(coherence-check's skill + land rung, plan-slices dependency parsing, as-built finding schema).
Not Large: no cross-repo surface, no new infrastructure, no migration of persisted state.
