**Status:** Accepted

# Stories: Deterministic project-config scaffolding (#683)

Technical track, Tier M. Consumer repos today get no project `.ai-conductor/config.yml` from any
code path, so the docs instruct a manual copy out of the harness checkout — next to the harness's
own self-host config. These stories replace that human step with a deterministic write and
reconcile the documentation with the code.

Per ADR `adr-2026-07-27-project-config-scaffolder.md`.

## Story S1: A project-scoped config template exists

**Requirement:** Technical — the seed asset must contain project-level keys only.

As a harness maintainer, I want a template that carries only project-level configuration, so that
seeding a consumer repo cannot inject user-level state or self-host guardrails into it.

### Acceptance Criteria

#### Happy Path
- Given the repo, when `templates/project-config.yml.template` is read, then it parses as valid
  YAML.
- Given that template, when its keys are inspected, then it declares `harness_version` and a
  commented `test_suite` block with guidance on naming a project-owned aggregate command.
- Given that template, when it is validated by the project-config loader's allow-list, then every
  uncommented key it declares is accepted for `source: 'project'`.

#### Negative Paths
- Given that template, when it is searched for user-level keys, then it contains no uncommented
  `conductor:` block and no uncommented `markdown_viewer:` block (these remain user-level, per
  `templates/ai-conductor-config.yml.template` lines 1-6).
- Given that template, when it is searched for self-host keys, then it contains none of
  `harness_self_host`, `owner_gate_cutover`, `auto_restart_on_stale_engine`,
  `attribution_enforcement_cutover`, `attribution_judge_cutover`, `attribution_audit_sample_pct`,
  `wiring`, or `manual_test`.
- Given the existing `templates/ai-conductor-config.yml.template`, when this change lands, then it
  is unchanged on disk (it remains the user-level reference, not the project seed).

### Done When
- [ ] `templates/project-config.yml.template` exists and parses as YAML.
- [ ] Its uncommented keys pass project-source config validation.
- [ ] It contains no user-level or self-host keys per the negative paths above.
- [ ] `templates/ai-conductor-config.yml.template` is byte-for-byte unchanged.

## Story S2: `conduct create` scaffolds a project config

**Requirement:** Technical — the create path writes the seed deterministically.

As an operator onboarding a new project, I want `conduct create` to write the project config for
me, so that I never hand-copy a file out of the harness checkout and never inherit its self-host
flags.

### Acceptance Criteria

#### Happy Path
- Given an empty target directory, when `conduct create <name>` runs, then it exits 0 and
  `<target>/.ai-conductor/config.yml` exists in addition to the existing `CLAUDE.md` and
  `.gitignore`.
- Given that scaffolded repo, when its config is loaded with the project-config loader, then the
  load succeeds (no `missing` error).
- Given that scaffolded repo, when its config content is compared to
  `templates/project-config.yml.template`, then it matches the template.

#### Negative Paths
- Given a scaffolded repo, when its `.ai-conductor/config.yml` is searched, then it contains none
  of `harness_self_host`, `owner_gate_cutover`, `auto_restart_on_stale_engine`,
  `attribution_enforcement_cutover`, `attribution_judge_cutover`, `attribution_audit_sample_pct`,
  `wiring.entry_points`, or `manual_test.disable` — the issue's stated observable.
- Given a non-empty target directory, when `conduct create` runs, then it exits non-zero and
  writes nothing, including no `.ai-conductor/` directory (the existing refuse-to-clobber
  contract is preserved).
- Given the harness repo itself, when this change lands, then its own `.ai-conductor/config.yml`
  is unchanged and no code path reads it as a seed source.

### Done When
- [ ] `runCreate` writes `.ai-conductor/config.yml` from the project template.
- [ ] The integration test asserting the scaffold set is updated to include the config file.
- [ ] A leak-guard assertion covers the full self-host key list above.
- [ ] The refuse-to-clobber test still passes with nothing written.

## Story S3: An existing repo can be seeded without a manual copy

**Requirement:** Technical — cover the `register` + `/bootstrap` onboarding route deterministically.

As an operator onboarding an existing repo, I want a command that writes the project config, so
that the bootstrap route does not depend on an agent hand-authoring one.

### Acceptance Criteria

#### Happy Path
- Given an existing repo with no `.ai-conductor/config.yml`, when `conduct-ts config init` runs in
  it, then it exits 0 and writes `.ai-conductor/config.yml` from the project template.
- Given that repo, when `conduct-ts config init` runs a second time, then it exits 0 and reports
  the file already exists (idempotent).

#### Negative Paths
- Given a repo whose `.ai-conductor/config.yml` already exists with operator edits, when
  `conduct-ts config init` runs, then the existing file is byte-for-byte unchanged (refuse to
  clobber).
- Given a directory that is not a git repository, when `conduct-ts config init` runs, then it
  exits non-zero and writes nothing.

### Done When
- [ ] `conduct-ts config init` is dispatched by the real CLI program.
- [ ] It writes the template, is idempotent, and never overwrites an existing config.
- [ ] `skills/bootstrap/SKILL.md` directs the agent to invoke it rather than author a config.

## Story S4: The missing-config error names a real remedy

**Requirement:** Technical — `config.ts:144` cites a command that cannot do the job.

As an operator hitting a missing-config error, I want the message to name a command that actually
creates the file, so that I am not sent to `bin/migrate`, which never writes a project config.

### Acceptance Criteria

#### Happy Path
- Given a project with no `.ai-conductor/config.yml`, when `loadConfig` runs, then the returned
  `missing` error message names `conduct-ts config init` as the remedy.

#### Negative Paths
- Given that same error path, when the message is inspected, then it no longer contains the string
  `bin/migrate`.
- Given a project whose config is present but malformed, when `loadConfig` runs, then the error
  type remains `parse_error`/`invalid` and is not reclassified as `missing`.

### Done When
- [ ] `config.ts` missing-file message names `conduct-ts config init`.
- [ ] No `bin/migrate` reference remains on the missing-project-config path.

## Story S5: Documentation describes the scaffolded behavior

**Requirement:** Technical — the hand-copy instruction is the leak vector and must not survive.

As a reader of the docs, I want onboarding pages to describe the config being written for me, so
that I am never told to copy a file out of the harness checkout.

### Acceptance Criteria

#### Happy Path
- Given `docs/quickstart.md`, when the onboarding section is read, then it states that the project
  config is scaffolded by `conduct create` (or `conduct-ts config init` for an existing repo).
- Given `docs/guides/multiprovider.md`, when its project-config note is read, then it points at the
  same scaffolded route.
- Given `docs/reference/configuration.md`, when its "File locations" section is read, then it
  states which keys are user-level only and that self-host keys belong to the harness checkout.

#### Negative Paths
- Given `docs/quickstart.md` and `docs/guides/multiprovider.md`, when they are searched, then
  neither instructs the reader to copy `templates/ai-conductor-config.yml.template` from the
  harness checkout into a project.
- Given `docs/reference/configuration.md:21`, when it is read, then its claim that no harness code
  path creates a project config is updated to match the new scaffolder.

### Done When
- [ ] The hand-copy instruction is absent from `docs/quickstart.md` and `docs/guides/multiprovider.md`.
- [ ] `docs/reference/configuration.md` documents user-level vs project-level placement and the
      scaffolded route.
- [ ] `docs/reference/cli.md` documents `conduct-ts config init`.

## Story S6: The false seeding claim in decision 016 is corrected

**Requirement:** Technical — a shipped ADR asserts behavior that does not exist.

As a maintainer reading the decision record, I want decision 016 to match the code, so that
`memory_provider` is not documented as guaranteed-present when nothing seeds it.

### Acceptance Criteria

#### Happy Path
- Given `.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md`, when
  decision 016 is read, then it no longer claims `memory_provider` is "guaranteed present in every
  project (bootstrap seeds it)".
- Given the corrected entry, when it is read, then it states the actual resolution behavior: the
  resolver is total and an absent or unavailable provider resolves to `local`.

#### Negative Paths
- Given the repo, when it is searched for other claims that bootstrap or create seeds a project
  config, then none remain outside this corrected entry.

### Done When
- [ ] Decision 016's "bootstrap seeds it" claim is removed or corrected.
- [ ] No remaining doc claims a project config is auto-seeded by `/bootstrap`.
