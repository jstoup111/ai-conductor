Waives: outcome-1

Rationale: #1989's first desired outcome is that each boundary's implementation is chosen at one wiring point per entry point. The operator chose to scope this spec to the convention, the registry and the ratchet (2026-11-07). ADR `adr-2026-11-07-external-boundary-ports-registry-and-ratchet` D2 and D6 deliver the wiring point boundary by boundary, so no production surface ships without a consumer. This spec delivers the mechanical half: story-3 rejects a production-adapter import outside the composition roots. Each boundary's root wiring has a named home, and every one is blocked by #1989:

- git: jstoup111/ai-conductor#3043 (it also introduces `Boundaries`, `createProductionBoundaries()` and root construction)
- llm: jstoup111/ai-conductor#3633
- process: jstoup111/ai-conductor#3634
- otel: jstoup111/ai-conductor#3635
- filesystem: jstoup111/ai-conductor#3636
- gh: jstoup111/ai-conductor#3637
- clock: jstoup111/ai-conductor#3638
- tmux: jstoup111/ai-conductor#3639
