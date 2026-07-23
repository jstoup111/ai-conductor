# Complexity: DECIDE artifact coherence check

Tier: M

**Rationale:** Cross-layer change — a new DECIDE skill (`/coherence-check`), a
deterministic validator inside `engineer land` (`land-spec.ts`), a waiver parser
mirroring `release-gate.ts`, early persistence of the intake body into the worktree,
and mechanical duplicate-spec detection. Multiple integration points across skill +
engine layers with new gate semantics and several negative paths (technical track,
no-intake ideas, S-tier fast-pass). No external services, auth, new models, or state
machines, and the parsing layer largely reuses existing code (`artifacts.ts`,
`plan-task-parse.ts`) — so M, not L.

Intake: jstoup111/ai-conductor#539 · Track: product
