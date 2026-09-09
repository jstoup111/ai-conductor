# Track: coherence-accepts-plans-that-cannot-deliver-sealed

Track: technical

Scope boundary: Engine half of #2419 only, confined to land-time DECIDE (`coherence-parse.ts`, `coherence-validator.ts`, `coherence-waiver.ts`). Adds an optional 7th criterion-row cell carrying the correction layer (`plan` or `architecture:adr-<stem>#D<n>`), required when the verdict is `fail`; per-layer gap ids; validation that an `architecture` layer cites an approved ADR decision in the change set. Excluded: the skill-text achievability judgement (operator's separate session), any BUILD-time reroute (PLAN_GAP keeps its needs-human halt), and the plan `## Coverage Check` carrier.

Land-time validator contract with no end-user surface; acceptance criteria live in stories.
