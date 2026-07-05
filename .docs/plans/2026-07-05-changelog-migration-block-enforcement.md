# Implementation Plan: CHANGELOG Migration-block enforcement (fix ai-conductor#282)

**Date:** 2026-07-05
**Design:** technical track — no PRD; intent in `.docs/track/2026-07-05-changelog-migration-block-enforcement.md`
**Stories:** `.docs/stories/2026-07-05-changelog-migration-block-enforcement.md`
**Architecture:** `.docs/architecture/2026-07-05-changelog-migration-block-enforcement.md`
**Decisions (APPROVED):** `.docs/decisions/2026-07-05-changelog-migration-block-enforcement.md` (ADR-1/2/3)
**Conflict check:** `.docs/conflicts/2026-07-05-changelog-migration-block-enforcement.md` (no blocking conflicts)
**Tier:** M · **Source:** `jstoup111/ai-conductor#282`

## Summary

Move CHANGELOG Migration-block enforcement toward where the block is authored, and turn a
format-defect HALT into a mechanical `/remediate` `build` kickback. Three surfaces: the TS
self-host gate + conductor routing, the bash integrity suite, and `bin/migrate` (left lenient
by design). ~12 tasks.

## Technical Approach

- **Gate** (`src/conductor/src/engine/self-host/release-gate.ts`): tighten
  `MIGRATION_SECTION_RE` from `###?` to `##` (h2-only, ADR-2). Extend the migration verdict with a
  machine-readable `kind` (`'malformed' | 'missing'`): `missing` when no `## Migration` heading is
  in the `[Unreleased]` body, `malformed` when a heading is present but no valid ` ```bash
  migration ` fence / non-empty body. Keep the uncertain-diff and no-breaking-surface paths exactly
  as today (C2 fail-closed). On failure, write a `.pipeline/` remediation-input artifact describing
  surfaces + kind + the required format.
- **Conductor** (`src/conductor/src/engine/conductor.ts`, finish-time branch ~1068–1077): when the
  failing self-host sub-gate is the migration gate with kind `malformed`/`missing` and
  `remediationRounds < MAX_KICKBACKS_PER_GATE`, dispatch `/remediate` (reuse the existing
  prd-audit/finish dispatch machinery at ~1445–1500) pointed at the new artifact, then re-run the
  gate. Otherwise (budget exhausted, or TR-7/TR-8/TR-9 failure) keep the current direct HALT.
- **Integrity** (`test/test_harness_integrity.sh`, new §9d): extract the `[Unreleased]` body; if a
  Migration heading is present, assert exactly `## Migration` (h2), ≥1 ` ```bash migration ` fence,
  and a fence body with ≥1 non-blank non-`#` line. Format-**when-present** only (ADR-3).
- **bin/migrate**: regex UNCHANGED (h2/h3 lenient, ADR-2 backward-compat). Add an in-code comment in
  `release-gate.ts` documenting the intentional asymmetry, and a parity test.
- **Docs**: reaffirm the h2 contract in CLAUDE.md, the gate HALT string (already h2), and the PR
  template (already h2). This PR touches **no** breaking surface (classifier lists only
  `bin/conduct`, `bin/install`, `hooks/`, `settings.json`, removed/renamed `skills/`) → its
  `[Unreleased]` entry carries **no** Migration block (C6).

Sequencing: gate contract + verdict (RED→GREEN) → gate tests → artifact writer → conductor routing
→ routing tests → integrity §9d + self-test → migrate parity + comment → docs + CHANGELOG →
full validation.

## Prerequisites

- `npm install` inside `src/conductor` for this worktree (per-worktree `node_modules`).
- Run TS tests with `rtk proxy npx vitest run <file>` (RTK swallows vitest output otherwise).
- No `bin/conduct`/build in this repo per branch policy — verification is unit tests + integrity suite.

## Tasks

### Task 1: Tighten gate heading regex to h2 (RED)
**Story:** Story 2 · **Type:** test-first
Write a failing unit test asserting `hasRunnableMigrationBlock` / `evaluateMigration` reject an
`### Migration` (h3) `[Unreleased]` block and accept the `## Migration` (h2) equivalent. Test file
alongside the existing self-host gate tests.

### Task 2: Tighten `MIGRATION_SECTION_RE` to `##` (GREEN)
**Story:** Story 2 · **Type:** implementation
Change `###?` → `##` in `MIGRATION_SECTION_RE` (release-gate.ts:198). Make Task 1 pass. Confirm the
no-breaking-surface and uncertain-diff paths are untouched.

### Task 3: Add `kind` (`malformed` | `missing`) to the migration verdict (RED→GREEN)
**Story:** Story 2 · **Type:** implementation
Extend `evaluateMigration` to distinguish: heading absent → `missing`; heading present but no valid
fence/body → `malformed`. Return the kind on the verdict object without altering the `{ok:true}`
fast paths. Unit tests pin both kinds + the uncertain-diff fail-closed case (kind may be `missing`
but `ok:false` is preserved).

### Task 4: Gate unit-test matrix
**Story:** Story 2 · **Type:** test
Pin: h2+`bash migration` accept; h3 reject (malformed); plain ` ```bash ` fence reject (malformed);
no heading (missing); comment-only body reject (malformed); no breaking surface pass; `null` diff
fail-closed.

### Task 5: `.pipeline/` remediation-input artifact writer
**Story:** Story 3 · **Type:** implementation
In the self-host module, on a migration-gate failure, write a `.pipeline/` artifact (e.g.
`release-gate-migration.md`) carrying: failing kind, the breaking surfaces from
`classifyBreakingSurfaces`, and the exact required format (h2 + ` ```bash migration `). Content is
self-contained so `/remediate` needs no harness-specific skill prose (C1). Unit-test the writer.

### Task 6: Conductor routes migration-format failure through /remediate (RED)
**Story:** Story 3 · **Type:** test-first
Failing test: a finish-time self-host verdict `{ok:false, subgate:'migration', kind:'malformed'}`
with budget remaining triggers a `/remediate` dispatch (not an immediate `loop_halt`).

### Task 7: Implement the conductor reroute (GREEN)
**Story:** Story 3 · **Type:** implementation
In the finish-time branch (~1068–1077), when the failing sub-gate is `migration` + kind
`malformed`/`missing` + `remediationRounds < MAX_KICKBACKS_PER_GATE`, dispatch remediation (reuse
the ~1445–1500 path) pointed at the Task 5 artifact and re-run the gate; else fall through to the
current direct HALT. Key the reroute on sub-gate identity so TR-7/TR-8/TR-9 keep direct HALT.

### Task 8: Routing negative-path tests
**Story:** Story 3 · **Type:** test
Pin: budget-exhausted migration failure → direct HALT; TR-8 integrity-suite failure → direct HALT
(no reroute); reroute never mutates the gate's own `ok:false`.

### Task 9: Integrity §9d — format-when-present (bash) + self-test
**Story:** Story 1 · **Type:** implementation
Add §9d to `test/test_harness_integrity.sh`: awk-extract the `[Unreleased]` body; if a
`^#{2,3} Migration` heading is present, assert it is exactly `## Migration`, contains ≥1
` ```bash migration ` fence, and the fence body has ≥1 non-blank non-`#` line — else fail with a
specific message. Never fail when absent. Add fixtures / a self-test asserting: clean pass, h3
fail, plain-`bash` fail, comment-only-body fail, no-Migration pass.

### Task 10: bin/migrate parity test + asymmetry comment
**Story:** Story 4 · **Type:** implementation
Leave `bin/migrate`'s heading regex UNCHANGED. Add a parity test: a gate-accepted fixture (h2 +
`bash migration`) is matched by `bin/migrate`'s `extract_migration_blocks` regex; a shipped h3
fixture is still matched by `bin/migrate` (but rejected by the gate). Add a comment to
`release-gate.ts` documenting the intentional gate-strict / migrate-lenient asymmetry (do not
re-sync).

### Task 11: Docs + this PR's CHANGELOG entry (no Migration block)
**Story:** Story 6 · **Type:** docs
Reaffirm `## Migration` (h2) in CLAUDE.md "Release & Update Gates" §2; verify the gate HALT string
and `.github/pull_request_template.md` already say h2 (adjust if not). Add an `[Unreleased]` entry
(Changed: gate + integrity now enforce h2 format-when-present and route format defects through
remediate; Fixed: format-defect HALT; note `bin/migrate` intentionally unchanged) with **no**
Migration block (this PR touches no breaking surface).

### Task 12: Full validation
**Story:** all · **Type:** verification
`rtk proxy npx vitest run` (self-host gate + conductor routing tests green), `tsc --noEmit` clean in
`src/conductor`, and `test/test_harness_integrity.sh` green (including new §9d on the real CHANGELOG).
Confirm no new CHANGELOG/Migration string landed under `skills/**` or `agents/**` (Story 5 grep guard).

## Out of scope
- Adding CHANGELOG/Migration authoring instructions to shared `skills/`/`agents/` (C1).
- Rerouting TR-7/TR-8/TR-9 through remediate.
- Changing the breaking-surface classifier or which surfaces require a block.
- Rewriting historical CHANGELOG h3 blocks; `#191` schema-forced verdicts.
