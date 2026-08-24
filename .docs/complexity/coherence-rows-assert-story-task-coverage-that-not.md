# Complexity: coherence-rows-assert-story-task-coverage-that-not

Tier: L

Rationale: Touches five coupled surfaces — a new signal-gated coherence row class and validator
layer in `coherence-validator.ts` (1592 lines), a new mechanical land rung in `land-spec.ts`, a
shared per-criterion extractor path also consumed by `acceptance_specs` (`artifacts.ts`), the
`coherence-check` and `plan` skill contracts, and the waiver gap-id vocabulary. Five binding ADRs
constrain the design (no LLM at land; land-only rung with no discovery/plan-gate propagation;
signal-gated layer derivation; waivable gap ids; no re-asking an owned review question). No new
models or auth, but the state machine around layer engagement, deferral dispositions, and
retroactivity over the merged plan corpus is multi-day work.
