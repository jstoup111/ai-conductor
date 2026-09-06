# Intake origin: stamp-the-resolved-model-into-audit-trail-step-rec

Source-Ref: jstoup111/ai-conductor#640
Owner: jstoup111

## Desired outcome
- Engine stamps the resolved model (e.g. `sonnet`, `opus`, from resolved-config at dispatch time) into the audit trail for every build/review dispatch — e.g. a `model` field on the dispatch/batch events in `events.jsonl`.
- Deterministic-first: the engine writes the stamp at dispatch (it already knows the resolved model); do NOT rely on the agent to self-report or on prompt discipline for commit trailers.
- Optional if cheap: include the model in the engine-stamped commit-trailer machinery (#433 direction) so `git log` alone answers 'who built this'.
