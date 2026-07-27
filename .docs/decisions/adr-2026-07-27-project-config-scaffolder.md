# ADR: Deterministic project-config scaffolder (#683)

**Status: APPROVED**
**Date:** 2026-07-27
**Track:** technical — Tier M
**Supersedes (in part):** the "bootstrap seeds it" claim in decision 016
(`architecture-review-2026-06-29-pluggable-memory-source.md:93`), which was never true in code.

## Context

Nothing in the harness writes a project `.ai-conductor/config.yml`. `conduct create` writes only
a skeleton `CLAUDE.md` and a `.gitignore` (`registry-cli.ts:151-204`); `bin/install` writes only
the user-level file (`bin/install:704-705`, `:810-811`); `skills/bootstrap/SKILL.md` never
mentions the file at all.

The documented route is therefore a **manual copy out of the harness checkout**
(`docs/quickstart.md:129-131`, `docs/guides/multiprovider.md:45-47`). That checkout also holds
the harness's own self-host config, so the hand-copy step invites picking up the wrong file —
which is the reported symptom: consumer repos carrying `harness_self_host`, `owner_gate_cutover`,
`wiring.entry_points`, `steps.manual_test.disable`, and the attribution cutovers.

Four of those keys measurably change behavior in an unrelated repo — most damagingly
`steps.manual_test.disable`, which silently removes a gating step (`resolved-config.ts:386`,
no repo-identity guard), and `wiring.entry_points`, which hard-blocks the wiring gate with
`bad-root` (`wiring-probe.ts:695-701`).

This is exactly the failure class this repo's design principle names: a rule enforced by human
or prompt discipline, where machinery should do the work.

## Decision

1. **Add `templates/project-config.yml.template`** — a project-scoped seed containing only
   project-level keys: a `harness_version` floor, a commented `test_suite` block with guidance,
   and commented per-step/`complexity` override examples. It deliberately **omits** the
   user-level `conductor:` and `markdown_viewer:` blocks.

2. **`conduct create` writes `.ai-conductor/config.yml` from that template**, alongside the
   existing `CLAUDE.md` and `.gitignore`, as part of `runCreate`'s ordered scaffold.

3. **Expose `conduct-ts config init`** — an idempotent, refuse-to-clobber primitive that writes
   the same template into an existing repo. This covers repos onboarded via `conduct register` +
   `/bootstrap`, deterministically rather than by instructing an agent to hand-author a config.

4. **Delete the hand-copy instruction from the docs** and describe the scaffolded behavior
   instead, in `docs/quickstart.md`, `docs/guides/multiprovider.md`, and
   `docs/reference/configuration.md`.

5. **Correct the false seeding claim** in decision 016, and the stale
   "Run bin/migrate to create it" message at `config.ts:144`.

6. **Guard it with a test**: a scaffolded repo's config must contain none of
   `harness_self_host`, `owner_gate_cutover`, `auto_restart_on_stale_engine`,
   `attribution_enforcement_cutover`, `attribution_judge_cutover`,
   `attribution_audit_sample_pct`, `wiring.entry_points`, or `manual_test.disable`.

## Consequences

**Positive.** The human copy step — the actual leak vector — is removed from both onboarding
routes. A consumer repo's starting config is self-host-free by construction rather than by
instruction. The orphaned-template inconsistency is resolved: one template is user-level, one is
project-level, each with a real writer or a documented role.

**Negative / accepted.** `conduct create`'s observable output changes, so the shipped assertion at
`registry-cli.test.ts:313` must be updated in the same diff. Two templates now exist and can
drift from the documented key set; this is mitigated by extending the existing
`config-template.test.ts` validation to the new file.

**Neutral.** Already-polluted consumer configs in the wild are not repaired — see below.

## Rejected alternatives

**Wire the existing `templates/ai-conductor-config.yml.template` into `create`** (the filer's
stated hypothesis). Rejected: that template is user-level-shaped. It carries a live `conductor:`
block (update channel, `last_checked_at`) and `markdown_viewer:`, and its own header declares
`conductor:` user-level only. Writing it into a project file would inject user-level state into
project scope — reproducing the user/project mixing this issue complains about. The hypothesis
was right that the seed should be deterministic and wrong about which asset to seed.

**Ship no project config; document zero-config defaults** (the issue's stated alternative
outcome). Rejected as not viable: `full-suite-verifier.ts:707-724` fails with `missing_config`
when the project config is absent or lacks `test_suite`, and it reads project-scoped `loadConfig`,
so `test_suite` cannot come from the user file. A project genuinely needs a project config.

**Make the self-host keys inert off the harness path / reject them in consumer configs.**
Rejected *for this change*, deferred as separate work. It treats the symptom rather than the
leak, most of the keys are already self-guarding (`auto_restart_on_stale_engine` at
`daemon-cli.ts:738`, `version_freeze` via `isSelfBuild()`, `owner_gate_cutover` at
`gate.ts:60-78`), and hard-rejecting the four harmful ones would break the harness's own config
unless carefully repo-scoped. It also conflicts with the issue's explicit negative path that a
consumer may still set any key by hand. Worth revisiting as a defence-in-depth follow-up for
configs already polluted in the wild.

**Have `/bootstrap` write the config.** Rejected: that is prompt discipline for something
machinery can do, which this repo's design principle forbids. Hence the `config init` primitive
in decision 3, which `/bootstrap` invokes rather than imitates.
