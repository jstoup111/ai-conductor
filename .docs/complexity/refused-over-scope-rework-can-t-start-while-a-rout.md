# Complexity: refused over-scope rework can't start while a routing round is open (#3597)

Tier: M

Rationale: engine state-machine correctness fix in `src/conductor/src/engine/conductor.ts` and the
routing fence (`src/conductor/src/engine/routing/round-admission.ts`): (1) one shared routed-region
closure for the build_review PASS and adjudication-`settled` arms, (2) a guard that keeps
whole-feature gates from running on a stacked feature while a routing round or repair marker is
open, (3) refusal rework preserving the fence's `mechanical` halt class with a fence detail that
names the blocking round, host and host state. No new module, dependency, schema or CLI surface.
Governed by adr-2026-10-12-routed-whole-feature-repair D7 (#3445 amendment), D13 and D15; the
gate guard may need an ADR amendment. Expected 3 stories. Per tier rules: architecture-diagram,
lightweight architecture-review, conflict-check, coherence-check and plan-review apply; no PRD
(technical track). Operator-confirmed 2026-11-07.
