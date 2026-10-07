# Complexity: Remediation disposition native contract migration

Tier: L

Source: jstoup111/ai-conductor#2522

The operator approved Tier L on 2026-10-06 for the technical-track migration.

The change crosses a versioned engine-owned input projection, native-schema dispatch for the
`remediate` gap-plan mode, structural-reference and vocabulary validation, an engine-owned
persisted result replacing the tolerant `readRemediationPlanResult` reader, engine-stamped
as-built finding identity, every `planRemediation` caller (validation group, build stall,
PRD audit, as-built, finish verification), restart/replay, #2187 rejection diagnostics, and a
skill-prose reintroduction guard. Migrating only the writer or only one source would leave the
legacy prose contract as a competing authority, so these must change as one coherent delivery
while preserving current routing, budget, operator-authority, and idempotence semantics.

The shipped #2188 and #2521 migrations supply a working local pattern, so this is not a
technology spike. Full architecture review, accepted stories, conflict check,
dependency-bearing plan, and coherence mapping are required. No production directory deletion
is intended.
