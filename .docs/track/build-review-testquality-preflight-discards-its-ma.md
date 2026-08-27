# Track: build_review testQuality preflight discards its materialization error

Track: technical

Scope boundary: Minimal — capture the discarded error at the bare catches (build-review-test-quality-preflight.ts:458, 462) and surface it through the existing failure-excerpt channel into the persisted result, spine event, and HALT body. Excluded: splitting the three materialization operations into distinct cause names; any change to mechanical-fault allowance consumption (per-attempt vs per-dispatch).

Engine diagnostics improvement with no user-facing product behavior; acceptance criteria live in stories (no PRD). Approach A: pass boundedHeadTailExcerpt of the caught error through failure()'s existing excerpt parameter.
