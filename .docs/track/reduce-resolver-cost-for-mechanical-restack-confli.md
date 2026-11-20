# Track: Reduce mechanical restack resolver cost

Track: technical

Source: jstoup111/ai-conductor#3632

Scope boundary: Operator-approved comprehensive work on avoiding restack conflicts, safely reusing prior resolutions, deterministic resolution where correctness can be established, validation before applying results, and per-round resolution-tier and cost reporting. Investigate conflicts involving `.memory/`, but obtain a separate operator decision before changing its storage policy. Preserve semantic conflict escalation and operator decisions for genuine design choices. Adjacent-line appearance alone never authorizes automatic acceptance.

Approach: Prevention and verified reuse first. Extend existing restack bookkeeping, recorded-resolution reuse, journal recovery, ownership safeguards, and the event spine. Remaining conflicts retain the configured strong resolver. A new small-model resolution tier is not part of this selected approach.

Rationale: This changes internal restack orchestration across consumer repositories; acceptance criteria belong in stories. It changes behavior and is not a behavior-preserving maintenance exemption.

Operator approval: 2026-11-15 — comprehensive scope and safeguards confirmed, followed by approval of Approach A and the technical track.

Dependency approved by operator 2026-11-15: jstoup111/ai-conductor#3653. Extend its reporting foundation after implementation; preserve its scheduling decisions. Delivery: single implementation PR.
