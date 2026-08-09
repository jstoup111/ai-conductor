# Architecture Review: Update-check config single source of truth (#1400)

**Date:** 2026-08-09
**Tier:** M (lightweight review)
**Reviewer:** engineer session, DECIDE phase for intake #1400
**Verdict:** APPROVED — proceed to stories
**Design:** `.docs/architecture/update-check-config-single-source-of-truth.md`
**ADRs:** `adr-2026-08-09-conductor-block-single-source-of-truth.md`,
`adr-2026-08-09-legacy-json-seed-migration-rule.md`,
`adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md` (all APPROVED)

## What was reviewed

The proposal to make the schema-owned `conductor:` block in `~/.ai-conductor/config.yml` the sole
source of truth for update-check state, seeding it once from the legacy
`~/.claude/ai-conductor.config.json` and reaching it from bash through `conduct-ts config`.

## Feasibility

**Feasible.** Every mechanism the design depends on already exists in the tree and was verified
directly:

| Dependency | Status |
|---|---|
| `conductor:` block typed | Exists — `types/config.ts:202-207` |
| Block schema-validated with per-key messages | Exists — `engine/config.ts:1133-1166` |
| Generic dotted-path user-config read | Exists — `cli.ts:133-136`, accepts any path |
| Atomic, key-preserving user-config write | Exists — `user-config.ts:70-82` |
| Bash-delegates-YAML-to-`conduct-ts` precedent | Exists — `docs/reference/cli.md:520-521` |
| Scalar user-config write verb | **Missing** — must be added (`config set`) |
| Seed function in the permanent home | **Missing** — must move from `bin/conduct:226` |

Only two new pieces are required, both small and both additive. No schema design work is needed
because the target schema already exists and is already validated.

## Architectural alignment

- **Deterministic where possible.** The whole change is mechanical: file paths, a key map, a rename
  as an idempotence marker, and a grep-based integrity check. No LLM judgement is involved anywhere,
  which matches the repository's stated design principle.
- **Machinery over prompt discipline.** Issue outcome #4 asks that the split "cannot silently
  reappear." The design answers with a `test/test_harness_integrity.sh` check that fails closed at
  the moment of violation, not with a comment or a convention. This is the correct instrument.
- **No parallel channel.** The change consolidates two config surfaces into one; it introduces no new
  observation, reporting, or coordination channel, so `event-spine` does not apply.
- **Provider-agnosticism.** Moving per-user harness state out of the Claude-branded `~/.claude/` path
  is the deciding argument for the chosen direction and aligns with the Codex parity work
  (`.docs/plans/2026-07-25-first-class-codex-harness-parity-904.md`) and #759.

## Risks and how the design handles them

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A migration writes a stale/empty `current_version`, and `bin/update:133-138` silently stops checking forever (advisory-only spawn hides the warning) | **High** | Seed rule: the live JSON wins the one-time seed, so no install loses its version identity (ADR: seed-migration-rule, decision 1) | Low |
| PyYAML absent → `harness_cfg_get` silently returns the default → same silent-stop failure | **High** | Bash never parses YAML; delegates to `conduct-ts config` (js-yaml). Missing `conduct-ts` fails loudly rather than defaulting (ADR: bash-yaml-access, decisions 1, 4) | Low |
| A malformed value written to `conductor:` fails only at merged-validate time and blocks every project on the machine (#1026) | **High** | `config set` runs `validateConductorBlock` before persisting and coerces `auto_check` to a real boolean (ADR: bash-yaml-access, decision 3) | Low |
| `bin/install:930,947` writes the JSON directly, bypassing the accessors — repointing accessors alone leaves a third writer | Medium | `configure_conductor()` explicitly repointed (ADR: single-source-of-truth, decision 2) | Low |
| The seed runs *after* a fresh write, overwriting it with older data (concretely: `bin/install` sets `current_version`, then the seed clobbers it) | Medium | The seed is a precondition inside both accessors, guarded by a process-scoped flag — structurally impossible to write before seeding (ADR: seed-migration-rule, decision 5) | Low |
| #226 deletes `bin/conduct` and takes the only copy of the migration with it | Medium | Seed function lives in `bin/lib/harness-common.sh`, the designated permanent home per `bin/update:12-14` (ADR: single-source-of-truth, decision 6) | Low |
| Rewriting the YAML destroys the operator's `markdown_viewer` block | Medium | Reuses `writeUserConfig`'s atomic, key-preserving write; hand-rolled YAML editing explicitly rejected (ADR: bash-yaml-access, Option B) | Low |
| A rename-marker failure leaves the seed claiming success | Low | Seed reports failure on rename failure; a re-seed is idempotent, a false success is not (ADR: seed-migration-rule, decision 2) | Low |

## Assumptions carried into BUILD

All were verified during discovery; none remain unconfirmed, so nothing blocks.

1. The YAML `conductor:` block has **zero** production readers. *Verified* — `readLegacyJson` and
   `ConductorConfig` have no non-test callers. Confidence 95%.
2. `bin/install:930,947` writes the legacy JSON without going through `conductor_cfg_set`.
   *Verified* by reading `configure_conductor()`. Confidence 100%.
3. #226 is scoped to removing `bin/conduct`. *Verified* — issue title and open state. Confidence 92%.
4. PyYAML is not a documented installation prerequisite. *Verified* — no mention in `bin/install`,
   `docs/`, or `README.md` beyond the "optionally" note at `harness-common.sh:9`. Confidence 90%.
5. The operator's intent — "YAML wins, but set my user-scoped YAML to latest" — means seed from the
   live JSON once, then YAML is authoritative. *Confirmed explicitly by the operator*, 2026-08-09,
   after the two readings were put side by side. Confidence 100%.

## Scope boundaries

**In scope:** the four update-check keys, the three bash writers, the two bash readers, the new
`config set` verb, the seed, the integrity check, removal of `readLegacyJson`/`legacyJsonPath`, and
the affected pages of `docs/reference/configuration.md` and `docs/reference/cli.md`.

**Explicitly out of scope:** deleting `bin/conduct`'s duplicated update block (#226 owns that);
`harness_cfg_get`/`harness_cfg_set` and their viewer callers; validating user-config blocks other
than `conductor`; deleting the renamed legacy backup file; the broader user-config validation gap
tracked by #1026.

## Release surface

The diff touches `bin/conduct` and `bin/install` and adds a `conduct-ts` subcommand. The path-based
release-gate classifier is expected to flag the `bin/conduct CLI` breaking surface. This is a genuine
user-visible config relocation with an automatic migration, so the PR must carry a real runnable
```` ```bash migration ```` fence in a `## Migration` section — **not** a waiver. Release disposition:
`note` / `Fixed` / `patch`.

## Conditions on approval

1. Every one of the three ADRs must be reflected in the plan's tasks; none may be silently dropped.
2. The integrity check (outcome #4) is not optional polish — a plan that ships the repoint without it
   does not close the issue, because nothing then prevents the next writer from reintroducing the
   split.
3. `docs/reference/configuration.md:20` ("Legacy user JSON") and `docs/reference/cli.md` must be
   updated in the same PR; both are currently wrong about this surface.
