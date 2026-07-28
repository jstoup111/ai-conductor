# Implementation Plan: Deterministic project-config scaffolding (#683)

**Date:** 2026-07-27
**Design:** `.docs/track/non-daemon-projects-inherit-self-host-config-inste.md`
**Complexity:** `.docs/complexity/non-daemon-projects-inherit-self-host-config-inste.md` (Tier M)
**Architecture:** `.docs/architecture/non-daemon-projects-inherit-self-host-config-inste.md`
**Review:** `.docs/decisions/review-2026-07-27-project-config-scaffolding-683.md`
**ADR:** `.docs/decisions/adr-2026-07-27-project-config-scaffolder.md` (APPROVED)
**Stories:** `.docs/stories/non-daemon-projects-inherit-self-host-config-inste.md`
**Conflict check:** `.docs/conflicts/non-daemon-projects-inherit-self-host-config-inste.md` — CLEAR as of 2026-07-27

## Summary

No code path writes a project `.ai-conductor/config.yml`, so the docs instruct operators to copy
a template out of the harness checkout — a directory that also holds the harness's own self-host
config. Replace that human step with a deterministic write: a new project-scoped template, a
shared writer used by both `conduct create` and a new `conduct-ts config init`, a corrected
missing-config message, and documentation reconciled with the code.

## Technical Approach

- Author `templates/project-config.yml.template` containing project-level keys only. It
  deliberately omits the user-level `conductor:` and `markdown_viewer:` blocks that make the
  existing `templates/ai-conductor-config.yml.template` unsuitable as a project seed.
- Introduce one shared writer helper that resolves the template from the harness root and writes
  `<root>/.ai-conductor/config.yml`. `conduct create` calls it as part of `runCreate`'s ordered
  scaffold; `conduct-ts config init` calls it for an already-existing repo. Neither ever
  overwrites an existing config.
- Leave `loadConfig`, `loadMergedConfig`, `mergeConfigs`, `user-config.ts`, and the validation
  allow-list untouched apart from the missing-file message string, keeping #967's merge semantics
  and the anti-leak boundary intact.
- Guard the outcome with the issue's own observable: a scaffolded repo's config contains none of
  the self-host keys.

## Verified Planning Claims

| Claim | Confidence | Evidence |
|---|---:|---|
| Nothing today writes a project config. | 99% | `runCreate` writes only `CLAUDE.md` + `.gitignore` (`registry-cli.ts:151-204`, asserted at `registry-cli.test.ts:313`); `bin/install` writes only user-level files (`:704-705`, `:810-811`); `skills/bootstrap/SKILL.md` never mentions `config.yml`. |
| "No project config" is not a viable end state. | 95% | `full-suite-verifier.ts:707-724` fails `missing_config` when the config is absent or lacks `test_suite`, and reads project-scoped `loadConfig`, so `test_suite` cannot come from the user file. |
| The existing template is user-level-shaped. | 95% | It carries live `conductor:` and `markdown_viewer:` blocks; its own header (lines 1-6) declares `conductor:` user-level only. |
| The docs actively instruct a hand-copy from the harness checkout. | 99% | `docs/quickstart.md:129-131`; `docs/guides/multiprovider.md:45-47`. |
| The missing-config message names a command that cannot create it. | 95% | `config.ts:144` says "Run bin/migrate to create it"; `bin/migrate` writes only `~/.claude/ai-conductor.config.json`. |
| Four inherited keys genuinely change consumer behavior. | 90% | `manual_test.disable` → `resolved-config.ts:386` (no repo guard, fails silently); `wiring.entry_points` → `wiring-probe.ts:695-701` (blocking `bad-root`); `harness_self_host.activation: force_on` → `detector.ts:86`; `attribution_enforcement_cutover` → `conductor.ts:3807-3810`. |
| Self-host behavior cannot be affected by the scaffolder. | 95% | Self-host activation is a positive-only realpath match against the harness root (`detector.ts:46-57`). |
| The README is already out of scope. | 99% | Rewritten by `2dd65cd7f` (#1030); now 148 lines whose only config mention is an index link at `:92`. |

No unconfirmed load-bearing assumption changes the task breakdown.

## Prerequisites

- Do not modify `templates/ai-conductor-config.yml.template`; it remains the user-level reference.
- Do not change `loadMergedConfig`, `mergeConfigs`, `user-config.ts`, or the validation allow-list
  (preserves #967 and the anti-leak boundary).
- Do not modify the harness repo's own `.ai-conductor/config.yml`.
- Preserve `conduct create`'s refuse-to-clobber contract (`registry-cli.test.ts:414-425`).
- Per repo policy: VERSION is not bumped (locked pre-v1); a `## [Unreleased]` CHANGELOG entry is
  required because this is a notable reader-visible implementation change. The additive
  `conduct-ts config init` subcommand touches no `bin/conduct` CLI, hook wiring, skill symlink, or
  `settings.json` surface, so no migration block is expected.

## Task Dependency Graph

```
Task 1 (template)
  └─▶ Task 2 (writer + create)
        └─▶ Task 3 (config init)
              └─▶ Task 4 (loader message)
                    └─▶ Task 5 (docs)
Task 6 (decision 016)  — independent
```

## Tasks

### Task 1: Author the project-scoped config template

**Story:** Story S1
**Type:** happy-path

**Steps:**
1. Write a failing test asserting `templates/project-config.yml.template` exists, parses as YAML,
   declares `harness_version`, and contains none of `conductor:`, `markdown_viewer:`,
   `harness_self_host`, `owner_gate_cutover`, `auto_restart_on_stale_engine`,
   `attribution_enforcement_cutover`, `attribution_judge_cutover`,
   `attribution_audit_sample_pct`, `wiring`, or `manual_test` as uncommented keys.
2. Verify it fails because the template does not exist.
3. Author the template: `harness_version` floor, a commented `test_suite` block with guidance on
   naming a project-owned aggregate command, and commented per-step / `complexity` examples.
4. Assert its uncommented keys pass project-source config validation.
5. Verify the test passes and `templates/ai-conductor-config.yml.template` is unchanged.
6. Commit with message: `feat(config): add project-scoped config template`

**Files:** `templates/project-config.yml.template`; `src/conductor/test/engine/config-template.test.ts`
**Wired-into:** `templates/project-config.yml.template`
**Dependencies:** none

### Task 2: Write the project config during `conduct create`

**Story:** Story S2
**Type:** happy-path

**Steps:**
1. Extend the create integration test to assert `<target>/.ai-conductor/config.yml` exists, matches
   the template, loads without a `missing` error, and contains none of the self-host keys.
2. Verify it fails because `runCreate` writes no config.
3. Add a shared writer helper that resolves the template from the harness root and writes
   `<root>/.ai-conductor/config.yml`, never overwriting an existing file.
4. Call it from `runCreate` alongside the existing `CLAUDE.md` and `.gitignore` writes; update the
   scaffold-set assertion at `registry-cli.test.ts:313`.
5. Verify the refuse-to-clobber test still passes with nothing written, including no
   `.ai-conductor/` directory.
6. Commit with message: `feat(create): scaffold project config from template`

**Files:** `src/conductor/src/engine/registry-cli.ts`; `src/conductor/test/integration/registry-cli.test.ts`
**Wired-into:** `src/conductor/src/engine/registry-cli.ts#runCreate`
**Dependencies:** Task 1

### Task 3: Add the `conduct-ts config init` primitive

**Story:** Story S3
**Type:** happy-path

**Steps:**
1. Write failing tests: the real CLI program dispatches a `config` subcommand; `config init` in a
   git repo with no config writes it from the template; a second run exits 0 and reports the file
   already exists; an existing edited config is left byte-for-byte unchanged; a non-git directory
   exits non-zero and writes nothing.
2. Verify they fail because no such subcommand exists.
3. Implement `config init` on top of the Task 2 writer helper, with the refuse-to-clobber
   pre-condition.
4. Update `skills/bootstrap/SKILL.md` to direct the agent to invoke it rather than author a config.
5. Verify all five cases pass.
6. Commit with message: `feat(cli): add conduct-ts config init`

**Files:** `src/conductor/src/index.ts`; `src/conductor/src/engine/registry-cli.ts`; `skills/bootstrap/SKILL.md`; `src/conductor/test/integration/registry-cli.test.ts`
**Wired-into:** `src/conductor/src/index.ts`
**Dependencies:** Task 2

### Task 4: Point the missing-config error at a real remedy

**Story:** Story S4
**Type:** negative-path

**Steps:**
1. Write a failing test asserting `loadConfig` on a project with no config returns a `missing`
   error whose message names `conduct-ts config init` and does not contain `bin/migrate`.
2. Verify it fails against the current message.
3. Update the message at `config.ts:144`.
4. Assert a present-but-malformed config still returns `parse_error`/`invalid`, not `missing`.
5. Commit with message: `fix(config): name a real remedy in the missing-config error`

**Files:** `src/conductor/src/engine/config.ts`; `src/conductor/test/config-validation.test.ts`
**Wired-into:** `src/conductor/src/engine/config.ts#loadConfig`
**Dependencies:** Task 3

### Task 5: Reconcile the documentation with the scaffolded behavior

**Story:** Story S5
**Type:** happy-path

**Steps:**
1. Remove the hand-copy instruction from `docs/quickstart.md:129-131` and
   `docs/guides/multiprovider.md:45-47`, replacing each with the scaffolded route.
2. Update `docs/reference/configuration.md`: correct the `:21` claim that no harness code path
   creates a project config, and state in "File locations" which keys are user-level only and that
   self-host keys belong to the harness checkout.
3. Document `conduct-ts config init` in `docs/reference/cli.md`.
4. Add a `## [Unreleased]` CHANGELOG entry.
5. Verify neither onboarding page still tells the reader to copy the template out of the harness
   checkout.
6. Commit with message: `docs: describe scaffolded project config`

**Files:** `docs/quickstart.md`; `docs/guides/multiprovider.md`; `docs/reference/configuration.md`; `docs/reference/cli.md`; `CHANGELOG.md`
**Wired-into:** `docs/reference/cli.md`
**Dependencies:** Task 4

### Task 6: Correct the false seeding claim in decision 016

**Story:** Story S6
**Type:** negative-path

**Steps:**
1. Read decision 016 at
   `.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md:93`.
2. Replace the "guaranteed present in every project (bootstrap seeds it)" claim with the actual
   behavior: the resolver is total and an absent or unavailable provider resolves to `local`.
3. Grep the repo for any other claim that `/bootstrap` or `create` seeds a project config; confirm
   none remain.
4. Commit with message: `docs: correct decision 016 memory_provider seeding claim`

**Files:** `.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md`
**Wired-into:** `.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md`
**Dependencies:** none

## Verification

- `test/test_harness_integrity.sh` passes.
- `npm test` in `src/conductor` passes.
- A scaffolded throwaway repo's `.ai-conductor/config.yml` contains none of the self-host keys —
  the issue's stated observable.
- The harness repo's own `.ai-conductor/config.yml` is unchanged in the diff.
