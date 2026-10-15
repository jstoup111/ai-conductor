# Architecture Review: Integrity suite check hardening (#1014)
**Date:** 2026-10-14
**Mode:** Lightweight (Tier M) — pre-stories; Sections 2 and 4 only
**Input:** `.docs/track/integrity-suite-two-checks-cannot-fail-one-warns-p.md` (technical track,
Approach A), `.docs/architecture/integrity-suite-two-checks-cannot-fail-one-warns-p.md`
**Verdict:** APPROVED

## Feasibility

Every change stays inside the existing stack: bash, `jq`, `grep`, and the existing generator
CLIs. No new package, service, or infrastructure is needed.

| Concern | Finding | Confidence / basis |
|---|---|---|
| Check 5 fail-closed | Current table run shows exactly three warnings: `tdd`, `coverage-binding`, `engineer`. `tdd` is satisfied by its `tdd-red`/`tdd-green` rows (`ARCHITECTURE.md` lines 99-100); the other two need a row or a reasoned allowlist entry. Check 4's `KNOWN_NON_SKILL_REFS` is the in-file precedent for the allowlist. | 95% verified (suite run on main: 378 passed, 4 warnings) |
| Check 5b both directions | `bin/generate-model-table --pins` returns non-exempt expected values for 8 skills; 5 of them (`architecture-review`, `explore`, `prd`, `rebase`, `remediate`) expect `opus` and carry no `model:` pin. The operator chose to pin them, so the new direction passes on landing. | 95% verified (`--pins` output vs SKILL.md frontmatter) |
| Check 5c on a copy | `generate-docs-guard-hook-main.ts` already reads `GENERATE_DOCS_GUARD_HOOK_OUT` for the target path, so the fixture can point at a `mktemp` copy with no generator change. | 95% verified (source read) |
| 5a/5b/5c hard-fail on missing prerequisites | CI's `integrity` job runs `npm ci` first (`.github/workflows/ci.yml`). Dispatched builds run `npm test` in `src/conductor` before the integrity command (`.ai-conductor/config.yml` `test_suite.commands`), and active feature worktrees carry `src/conductor/node_modules`. A fresh clone without `npm ci` will now fail instead of passing green — that is the intended outcome. | 90% verified (config + worktree listing); `jq` presence on the daemon host inferred, not checked per host |
| Check 10 `skills/` coverage | `skills/` contains no `.sh`/`.ts`/`.js` files today, so the script scan is future-proofing. `adr-2026-07-05-engine-owned-task-status` D4 keeps advisory `pending`/`in_progress` writes with the agent and makes `completed`/`skipped` engine-only, so the prose scan flags only imperative write instructions naming an engine-only status. On today's 20 SKILL.md mentions it flags none; `skills/tdd/SKILL.md:375` (a sanctioned `pending` reset) and read-only "confirm the row reads `completed`" lines pass. | 95% verified (grep of skills/, ADR H4 text) |
| Worktree isolation | The 5c change removes the suite's only write to a tracked file; no port, database, or shared path is introduced. | verified |

## Alignment

- **Machinery by default** (`CLAUDE.md` Design Principles): every change converts a prose-only or
  warn-only guarantee into a counted failure. The prose scan is the one place that leans on string
  matching; it is bounded by a reasoned allowlist rather than an open-ended exception list.
- **Pattern consistency:** both new allowlists mirror check 4's `KNOWN_NON_SKILL_REFS` (named
  entry plus comment reason). Check 5d's fail-closed both-directions comparison is the precedent
  for 5b.
- **Check 29 reporting contract:** new `assert` calls must pass explicitly captured statuses, not a
  raw `$?`, so the failure-reporting fixture keeps passing.
- **Scope boundary honored:** check 4 and check 1b are untouched; the SKILL.md prose scan is the
  operator-approved expansion recorded in the track marker, bounded by the engine-owned task-status
  ADR's field-level write partition.
- **No ADR:** no system boundary, decomposition, integration pattern, data architecture, or
  foundational technology changes. These are validation-rule edits within an existing script.

## Wiring Surface

| New or changed surface | Production caller |
|---|---|
| Prerequisite probe for `node_modules`/`jq` (5a/5b/5c) | Runs inside `test/test_harness_integrity.sh`, invoked by the CI `integrity` job and by `test_suite.commands` in `.ai-conductor/config.yml` |
| Check 5 no-row allowlist | Same suite; read only by check 5 |
| Check 5b missing-pin direction | Same suite; consumes existing `bin/generate-model-table --pins` |
| Check 5c temp-copy fixture | Same suite; passes the temp path through the existing `GENERATE_DOCS_GUARD_HOOK_OUT` env seam |
| Check 10 `skills/` roots and prose allowlist | Same suite |
| `model: opus` pins on 5 SKILL.md files | Host skill loader when those skills are invoked; checked by 5b |

Advisory `ai-conductor overlap-scan` over these paths: no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Prose heuristic flags descriptive lines (false positives) or misses rephrased engine-only write instructions | Technical | Medium | Medium | Stories pin positive and negative fixture lines; residual exceptions go in a reasoned allowlist |
| Hard-fail on missing `node_modules` surprises local operators on a fresh clone | Knowledge | High | Low | Failure message names the missing prerequisite and the `npm ci` remedy; validation.md updated |
| `jq` absent on a daemon host turns every self-host build red | Integration | Low | Medium | Same named-prerequisite failure; `jq` is already required by other harness scripts |
| `engineer` allowlist entry outlives the skill's removal | Technical | Medium | Low | Allowlist reason names the pending removal; check 5 should fail on an allowlist entry with no skill directory (stale entry) |

## ADRs Created

None. No structural decision is made; check 4's allowlist pattern and check 5d's
both-directions pattern are reused.

## Conditions

None.
