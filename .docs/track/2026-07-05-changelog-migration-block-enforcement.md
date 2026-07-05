# Track: CHANGELOG Migration-block enforcement where authored (fix ai-conductor#282)

Track: technical

Internal harness / self-host plumbing. The self-host release gate (TR-10,
`src/conductor/src/engine/self-host/release-gate.ts`) rejects a malformed CHANGELOG
Migration block, but only *after* every build task has completed — turning a mechanical
format defect into an operator HALT plus a manual CHANGELOG rewrite. No user-facing
product behavior; this converges enforcement toward where the block is authored and turns
a format-defect HALT into a mechanical, auto-remediable `build` kickback.

Source: `jstoup111/ai-conductor#282`.

## What this changes (three self-host mechanisms)

1. **Route the gate's migration-format failure through `/remediate`** as a mechanical
   `build` disposition (bounded by the existing per-gate kickback budget), instead of
   HALTing directly. The by-design human step here is only the merge (ADR-005/ADR-010),
   not block-format repair.
2. **Add a format-when-present check to `test/test_harness_integrity.sh`** so the
   CHANGELOG task's own `full validation` step fails on a malformed block *before* the
   task can be marked complete.
3. **Tighten the format contract to `## Migration` (h2)** in the gate and the new
   integrity check (matching the documented contract), while leaving `bin/migrate`
   lenient (h2/h3) to keep already-shipped historical blocks executable.

## Why technical (no PRD)

The audience is the daemon/operator and the harness's own build/release machinery. There
are no user-facing functional requirements — acceptance lives in the stories and is
verified against the gate code, the integrity suite, and `bin/migrate`.

## Hard constraint carried into DECIDE (operator gate)

Enforcement must **not** add harness-repo-specific CHANGELOG/Migration language to the
shared consumer surface — `skills/` (tdd, finish, pipeline) and `agents/`. Those are
consumed by every project using the harness; the Migration-block/self-host concern is
harness-repo-only. All self-host-specific knowledge stays in the TS self-host module,
the `.pipeline/` remediation artifact, `test/test_harness_integrity.sh`, `bin/migrate`,
and harness-repo docs (CLAUDE.md, PR template) — never in the shared skills/agents prose.

Related (out of scope): `#191` (schema-forced verdicts for gating steps) — same class of
"gates scraping Markdown that upstream steps author freeform," tracked separately.
