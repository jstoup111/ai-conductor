# Complexity: Late-gate fixes restack the whole stack every repair round (#3653)

Tier: L

Rationale: a multi-seam engine change to stacked routed repair, with new durable commit metadata and a new history transformation path:
(1) routed audit-round hosts execute on the leaf branch instead of their own child branch (`src/conductor/src/engine/routing/host-region-entry.ts`, `routing/routed-exit.ts`, `routing/round-admission.ts`), so no exit restack or revalidate round runs per host;
(2) an engine-stamped `Owner:` commit trailer derived from the repair marker, alongside the existing `Round:` stamp (`engine/round-stamp-cli.ts`, `engine/git-hook-assets.ts`);
(3) a new fold restack cause that places each owner-stamped commit on its routed owner, raising only hunks whose lines a higher child introduced, through the journaled replay (`engine/restack/restack-plan.ts`, `restack/restack-executor.ts`), with a leaf-tree-identity check;
(4) one fold-time re-validation per changed child through the existing revalidation queue, with bounded repair and named halts;
(5) per-round restack attribution on the event spine (`types/events.ts`, `provider_attempt`).
It amends APPROVED adr-2026-10-12-routed-whole-feature-repair (decisions 4, 9, 13, 14, 15; it reverses that ADR's rejection of Option C) and adr-2026-10-10-stacked-restack-journaled-replay, and adds a new ADR. Per tier rules: architecture-diagram, full architecture-review, conflict-check, coherence-check and plan-review apply; no PRD (technical track). Operator-confirmed 2026-11-08.
