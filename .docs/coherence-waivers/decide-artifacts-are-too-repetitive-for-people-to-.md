Waives: outcome-1, outcome-2, outcome-3

Rationale: jstoup111/ai-conductor#3405 is delivered as three sequential specs
(`adr-2026-10-24-per-feature-artifact-manifest` decision 10). This spec (spec 1) adds the
per-feature artifact manifest and one lookup and moves no file, so it cannot change what a
reviewer reads.

- outcome-1 (each criterion stated in full in one place) and outcome-2 (materially shorter review
  artifacts) are delivered by spec 3, which moves new specs to the numbered `1-review/` and
  `2-machine/` layout and restructures artifact content.
- outcome-3 (the land coherence gate still refuses unmapped criteria and names each one) is not at
  risk in this spec: land and its coherence validator are deliberately not routed through the
  manifest (decision 5). It becomes at risk only when spec 3 references criteria by id instead of
  copied text, so spec 3 owns proving it.

Spec 2 (path policy reads the manifest) is blocked by this spec, and spec 3 by spec 2; both are
filed as intakes after this spec lands.
