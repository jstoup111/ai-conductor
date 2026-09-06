# Complexity: Self-healing mechanical remediation for the self-host release gate

Tier: M

## Rationale

Medium, not Small: the change spans three surfaces that must agree — the shell integrity
suite (structured per-failure remediation records), the engine release gate (allowlist
validation, bounded self-heal, commit, single re-run), and the event spine (reporting the
self-heal attempt and its outcome). It introduces a new engine-executed mutation at the ship
tail, which is a trust surface on a self-host build and needs an architecture review before
stories. Two self-healable checks already exist (`bin/generate-model-table`,
`bin/generate-docs-guard-hook`), so the lane must be general from the first commit rather
than special-cased.

Medium, not Large: the blast radius is one gate function and one assert helper. There is no
schema migration, no consumer-facing CLI change, no new persistence, and no cross-repo
coordination. The existing `build_review` mechanical-fault lane supplies the bounded-attempt
pattern to follow rather than invent.

## Tier-required artifacts

- `.docs/architecture/` diagram (Medium)
- `.docs/decisions/` lightweight architecture review (Medium)
- `.docs/conflicts/` conflict-check (Medium)
- `.docs/coherence/` coherence-check (Medium)
