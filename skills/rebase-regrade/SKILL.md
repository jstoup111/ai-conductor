---
name: rebase-regrade
disable-model-invocation: true
description: "Judge whether a rebase conflict resolution that changed the feature's own diff warrants regrading prd_audit or architecture_review_as_built."
enforcement: gating
phase: ship
---

## Judgement policy

A rebase completed, but its conflict resolution changed the feature's own contribution: the
feature's patch after the rebase differs from its patch before it. The feature's documents (plan,
stories, specs, cited ADRs) did not change. The engine supplies, per changed file, the feature
patch before and after the rebase, plus the candidate gates whose earlier PASS would otherwise be
kept. Answer one question per candidate: could this change plausibly alter that gate's grade?

- `prd_audit` grades whether the feature delivers its stories' acceptance criteria. Regrade it when
  the resolution adds, removes, or alters behavior a criterion depends on.
- `architecture_review_as_built` grades whether the as-built design conforms to the plan and cited
  ADRs. Regrade it when the resolution changes structure, boundaries, data flow, or a dependency a
  decision constrains.

Do not regrade for changes that preserve behavior and structure: re-ordered or re-indented hunks,
renamed locals, import reshuffles, upstream identifiers adopted verbatim, or merged context that
leaves the feature's own lines semantically intact. When the supplied delta is marked truncated and
the omitted part could matter, regrade.

Do not read files, run commands, or use any transcript. Judge only the supplied delta.

## Result contract

Return exactly one JSON object and no surrounding prose:

```json
{ "regrade": true, "gates": ["prd_audit"], "rationale": "..." }
```

`regrade` is a boolean. `gates` names only supplied candidate gates: non-empty when `regrade` is
true, empty when false. `rationale` is a non-empty sentence naming the change that decided it. Any
other shape is rejected, and the engine then reopens every candidate.
