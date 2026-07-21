# Complexity: Remove Serena from harness dependencies and install (#753)

Tier: S

## Rationale

Pure subtraction across a small, fully-enumerated file set. No new logic, no models, no
integrations, no auth, no state machines, no config-schema change — every task deletes an
existing block or updates the doc/test that referenced it. The one genuine judgment call
(what the upgrade path does about the already-registered user-scope MCP server and the
already-installed tool) is a policy decision, not a design seam, and is captured in
`adr-2026-07-21-serena-removal-path.md` rather than warranting architecture artifacts.

- **Touchpoints are exhaustively known** (verified by repo-wide `grep -ri serena`):
  `bin/install` (Serena block + uv-for-Serena ladder), `skills/bootstrap/SKILL.md`
  (§9a + §5 gitignore bullet), `HARNESS.md` (MCP Servers section),
  `src/conductor/src/engine/registry-cli.ts` (`GITIGNORE_SKELETON`) + its integration
  test, `README.md` (3 spots), `.gitignore` (kept — see ADR), `CHANGELOG.md`
  (new entry + Migration block only; history untouched).
- **No breaking surface under the release gate.** The four canonical surfaces
  (`bin/conduct CLI`, `skill symlink targets`, `hook wiring`, `settings.json schema`)
  are untouched — no waiver needed. A `## Migration` block is still included
  voluntarily because the issue's "clean removal path" outcome is exactly what
  `bin/migrate`'s approval-gated migration blocks exist for.
- **Only one non-doc code change**: a constant edit in `registry-cli.ts:106` plus the
  matching test assertion flip (`registry-cli.test.ts:299,305`).
- **Verification is deterministic**: `grep -ri serena` over the active surfaces,
  `test/test_harness_integrity.sh`, and the conductor test suite.

## Why not M

No cross-file interlock, no behavioral neighbors mid-flight (no open PR touches these
files — checked 2026-07-21), and the migration block is a guarded two-command script.
Story count is 6 but five are negative-path assertions over the same removal. Extra
artifacts beyond the S minimum (ADR, conflict check) are included because the operator
flagged a genuine DECIDE and because this spec supersedes closed spec PR #728 — their
presence does not raise the build tier.
