# Intake origin: wiring-gate-flags-production-reachable-seams-compo

Source-Ref: jstoup111/ai-conductor#880
Owner: jstoup111

## Desired outcome

- An export whose only callers are in its own module does NOT gap when that module is production-reachable through an externally-referenced root (transitively), or when the plan declares the intra-file call site and the declaring file itself is production-referenced. Per the approved 2026-07-30 refinement, the exception requires both a matching declared caller contract and production-root reachability, plus exact symbol identity.
- A genuinely orphaned export — unreachable from any production entry point through any chain — still gaps exactly as today.
- An export referenced only by tests, with no production path to it, still gaps as today.
- Plan-declared same-file call sites are valid contracts only when the declared caller resolves to the exact export in the defining file and the module is production-reachable; missing or mismatched proof is rejected deterministically with an actionable named gap.
