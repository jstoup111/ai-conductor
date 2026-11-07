# Complexity: Manual-test failure routed to a child that can't hold the fix, no way out (#3605)

Tier: M

Rationale: an engine routing correctness fix across existing seams, with no new module, dependency or persisted schema:
(1) the audit host-entry no-op guard in `src/conductor/src/engine/routing/host-region-entry.ts` treats a taskless obligation as dispatchable work;
(2) taskless admission in `src/conductor/src/engine/conductor.ts` feeds the residue judge the FAIL evidence and per-child changed paths, then raises placement through `selectHost` (`engine/routing/cannot-host.ts`), with the leaf as the fallback;
(3) the residue routing contract in `engine/routing/residue-routing-call.ts` gains an implicated-paths answer field;
(4) operator recovery in `engine/stack-rounds-cli.ts` and the refusal text in `engine/stack-commit-guard-cli.ts`.
It amends APPROVED adr-2026-10-12-routed-whole-feature-repair (decisions 3 and 7) and adr-2026-07-13-kickback-build-no-op-escalation (D1). Expected 4 stories. Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check, coherence-check and plan-review apply; no PRD (technical track). Operator-confirmed 2026-11-07.
