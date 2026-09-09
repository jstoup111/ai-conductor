# Hotfix: Resolve candidate source references to canonical findings

Date: 2026-09-09
Track: technical
Complexity: S
Authorization: Operator explicitly approved repairing review machinery during halted-feature recovery.

This direct hotfix records the approved bounded recovery work. A reviewer can copy a projected
candidate source hash while the gate requires a declared-title hash, losing an actionable finding
to a malformed-result halt. Preserve the existing finding identity and scope authority.

### Task 1: Translate uniquely resolved candidate evidence at the provider boundary
Files: src/conductor/src/engine/build-review-coordinator.ts, src/conductor/test/engine/build-review-coordinator.test.ts, skills/build-review-test-quality/SKILL.md, docs/explanation/gates.md, README.md

Validate complete candidate resolutions, then translate only a unique resolved source reference
into the canonical title/occurrence reference. Preserve canonical inputs and all substantive
findings. Reject ambiguous, excluded, indeterminate, foreign, and wrong-occurrence references.
Document this accepted provider input using the existing skill and gate reference.

Done when: the real coordinator settles and saves a canonical failing finding in one fake-provider
dispatch for a valid resolved source reference, while the negative cases remain rejected.

Validation: scoped coordinator/domain/identity/runner tests, configured typecheck including tests,
lint, harness integrity, and engine-native configured full-suite verification.
