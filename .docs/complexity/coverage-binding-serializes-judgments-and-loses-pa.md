# Complexity: coverage-binding-serializes-judgments-and-loses-pa

Tier: M

Rationale: amends an APPROVED ADR (D5 batch identity/cardinality contract), changes the coverage_binding runner's dispatch loop and prompt, extends the envelope writer to per-batch atomic checkpoints, adds a config key (`coverage_binding.judge.batch_size`) to the consumer registry, and updates `skills/coverage-binding/SKILL.md` to a multi-claim payload. Several files across engine, skill, and ADR, with a schema-validated provider payload — beyond S; no new subsystem, so not L.
