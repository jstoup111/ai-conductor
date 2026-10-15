**Status:** Accepted

# Stories: Skill names resolve from frontmatter (Spec 1 of `ac-` namespacing)

Track: technical. Source: jstoup111/ai-conductor#885 and `adr-2026-10-14-ac-prefixed-skill-names` Decisions 2, 3 and 7 (APPROVED). In this spec every shipped `skills/<dir>/SKILL.md` keeps `name: <dir>`, so no visible name changes. "Built-in step" means a step in the engine's step-to-skill table; custom steps and `parallel[].skill` steps keep their existing resolution. "Engine harness root" means the harness checkout the running engine module resolves as its own location. A "renamed fixture" below is a test skill tree in which a skill's frontmatter `name:` differs from its directory (for example `skills/explore/` declaring `name: ac-explore`).

## Story 1: Step dispatch renders the frontmatter name on every provider

**Requirement:** TI-1 — the engine reads host-visible names from frontmatter (ADR D2).

As the conductor engine, I want each step invocation to name the skill as its frontmatter declares so that a later rename of `name:` needs no engine change.

### Acceptance Criteria

#### Happy Path

- Given a renamed fixture where `skills/explore/SKILL.md` declares `name: ac-explore`, when the engine renders the explore step for claude, codex and pi, then the invocations begin with `/ac-explore`, `$ac-explore` and `/skill:ac-explore` respectively.
- Given the shipped skill tree, when the engine renders every built-in step that has a skill invocation for claude, codex and pi, then each rendered invocation is identical to the invocation rendered before this change.
- Given a renamed fixture where `build-review-security`, `rebase-regrade`, `rebase`, `conduct` and `pr` declare `ac-` names, when the engine dispatches the build-review security grader, the rebase regrade judgement, the rebase resolver, the legacy complexity assessment and the finish PR-prose step, then each prompt names the `ac-` skill and the grader's installed review policy is matched by its `ac-` name.

#### Negative Paths

- Given a fixture `SKILL.md` for a built-in step whose frontmatter has no `name:` key, when the engine renders that step, then the invocation uses the skill's directory name.
- Given a built-in step whose skill directory has no `SKILL.md` in the skill tree being served, when the engine renders that step, then it fails with an error naming the step and the missing `SKILL.md` path and renders no invocation.
- Given a fixture `SKILL.md` whose frontmatter block is never closed, when the engine renders that skill's step, then it fails with an error naming that `SKILL.md` path and renders no invocation.
- Given a renamed fixture, when the engine loads a build-review rubric file, then it reads `skills/<dir>/SKILL.md` by directory path and not a path built from the frontmatter name.

### Done When

- [ ] Rendering tests over a renamed fixture assert the frontmatter name for claude, codex and pi.
- [ ] A table-wide test over the shipped tree asserts every rendered invocation equals the pre-change invocation.

## Story 2: Each dispatch reads the skill tree it serves

**Requirement:** TI-2 — self-host dispatch reads the feature worktree; other dispatch reads the engine harness root (ADR D2, D7).

As a self-host build, I want names read from the worktree skill tree my dispatch copies so that a feature that renames a skill dispatches the names its own catalog declares.

### Acceptance Criteria

#### Happy Path

- Given a self-host dispatch whose worktree `skills/explore/SKILL.md` declares `name: ac-explore` while the engine harness root declares `name: explore`, when the explore step is dispatched, then the invocation names `ac-explore`.
- Given a non-self-host dispatch whose engine harness root declares `name: ac-explore` while the target project has no `skills/` tree, when the explore step is dispatched, then the invocation names `ac-explore`.

#### Negative Paths

- Given a self-host dispatch whose worktree and engine harness root declare different names for the same skill, when the step is dispatched, then the engine harness root's name does not appear in the invocation.
- Given a non-self-host dispatch whose target project contains a `skills/explore/SKILL.md` declaring a different name, when the built-in explore step is dispatched, then the invocation uses the engine harness root's name and ignores the project's file.
- Given a non-self-host dispatch where the engine harness root cannot be resolved, when a built-in step is dispatched, then the invocation uses the skill's directory name.

### Done When

- [ ] Dispatch tests cover self-host and non-self-host resolution with diverging fixture names.

## Story 3: Pi resolves skills by frontmatter name

**Requirement:** TI-3 — Pi first-token parsing matches frontmatter names (ADR D2).

As the Pi provider, I want the rendered first token matched against frontmatter names so that a renamed skill resolves under Pi.

### Acceptance Criteria

#### Happy Path

- Given a renamed fixture catalog where `explore` declares `name: ac-explore`, when the Pi provider parses a prompt whose first token is `/skill:ac-explore`, then it resolves the explore skill.
- Given the shipped skill tree, when the Pi provider parses the rendered build-step prompt, then the prompt is `/skill:pipeline` and it resolves the pipeline skill as before.

#### Negative Paths

- Given a renamed fixture catalog where `explore` declares `name: ac-explore`, when the Pi provider parses a prompt whose first token is `/skill:explore`, then it does not resolve the explore skill.

### Done When

- [ ] Pi provider tests cover the renamed-fixture match, the directory-name non-match, and the unchanged shipped build-step prompt.

## Story 4: Named launches resolve the frontmatter name

**Requirement:** TI-4 — composer launcher, monitor triage and project prelude read frontmatter names (ADR D2).

As an operator, I want the composer, monitor and prelude launches to name skills as their frontmatter declares so that they keep working when names change.

### Acceptance Criteria

#### Happy Path

- Given a renamed fixture declaring `ac-composer`, `ac-daemon-triage`, `ac-bootstrap` and `ac-assess`, when the composer launcher, the monitor guided session and the project prelude start their skills, then they invoke `ac-composer`, `ac-daemon-triage`, `ac-bootstrap` and `ac-assess` respectively.
- Given the shipped skill tree with codex selected, when the composer launcher spawns, then the argv is exactly one positional prompt `$composer` as before.

#### Negative Paths

- Given a renamed fixture declaring `ac-composer`, when the launcher refuses to nest inside a Claude or Codex session or reports a codex ENOENT failure, then the message names `/ac-composer` or `$ac-composer` and never `/composer` or `$composer`.

### Done When

- [ ] Launcher, monitor and prelude tests cover a renamed fixture and the unchanged shipped names.

## Story 5: Operator-only suppression is keyed by frontmatter name

**Requirement:** TI-5 — dispatched worktrees disable operator-only skills under their frontmatter names (ADR D2).

As the engine preparing a dispatched worktree, I want the operator-only skill disabled under the name the host sees so that a renamed `daemon-triage` stays suppressed.

### Acceptance Criteria

#### Happy Path

- Given a renamed fixture where `daemon-triage` declares `name: ac-daemon-triage`, when a dispatched worktree's settings are written, then `skillOverrides` sets `ac-daemon-triage` to `off`.
- Given an operator's existing `skillOverrides` entry for another skill, when the engine writes the worktree settings, then that entry is preserved unchanged.

#### Negative Paths

- Given a renamed fixture where `daemon-triage` declares `name: ac-daemon-triage`, when a dispatched worktree's settings are written, then `skillOverrides` has no `daemon-triage` key.
- Given an operator's existing `skillOverrides` entry sets the operator-only skill's name to `on`, when the engine writes the worktree settings, then that entry is `off`.

### Done When

- [ ] Worktree-prepare tests cover the renamed key, operator-entry preservation and the forced `off`.

## Story 6: The self-host catalog is keyed by frontmatter name

**Requirement:** TI-6 — the self-host provider home and sandbox expose each skill under its frontmatter name (ADR D3).

As a self-host build, I want my throwaway skill catalog keyed by frontmatter name so that the host sees the same names the engine dispatches.

### Acceptance Criteria

#### Happy Path

- Given a worktree renamed fixture, when the self-host provider home is prepared, then its skills catalog lists each skill under its frontmatter name and lists no operator-only skill.
- Given a provider whose self-host shape links `.agents/skills`, when the provider home is prepared, then `.agents/skills` lists the same entries as the skills catalog.
- Given the Claude self-host sandbox over a worktree renamed fixture, when it is provisioned, then it exposes each worktree skill under its frontmatter name as a link resolving to that worktree's `skills/<dir>`.
- Given a provider home prepared over a worktree renamed fixture, when the live-tier preflight checks the built-in step commands, then it finds each step's skill under its frontmatter name and reports no missing command.

#### Negative Paths

- Given a worktree renamed fixture, when the self-host provider home is prepared, then no entry is named after a skill directory whose frontmatter name differs from it.
- Given the operator-only `daemon-triage` skill declaring `name: ac-daemon-triage`, when the provider home is prepared, then neither `ac-daemon-triage` nor `daemon-triage` exists in its catalog.
- Given a provider home over a renamed fixture that lacks the skill whose frontmatter name is `ac-pipeline`, when the live-tier preflight runs, then it fails before any dispatch naming `ac-pipeline`.

### Done When

- [ ] Provider-home and sandbox tests assert exact catalog listings over a renamed fixture.
- [ ] Live-tier preflight tests resolve step commands by frontmatter name.

## Story 7: Install checks expect frontmatter-named links

**Requirement:** TI-7 — `bin/install --check`, which install-freshness runs, compares shipped skills against links named by frontmatter (ADR D3).

As the daemon, I want the install check to expect each skill's link under its frontmatter name so that a stale install is detected after a rename.

### Acceptance Criteria

#### Happy Path

- Given a renamed harness tree and catalogs holding a link under each skill's frontmatter name, when `bin/install --check` runs, then it exits 0 and install-freshness reports the install fresh.

#### Negative Paths

- Given a renamed harness tree and catalogs holding only directory-named links, when `bin/install --check` runs, then it reports every missing frontmatter-named link by name and exits non-zero, and install-freshness reports the install stale.
- Given one catalog missing only the link for the skill named `ac-plan`, when `bin/install --check` runs, then it reports `ac-plan` missing for that catalog and exits non-zero.

### Done When

- [ ] Install-check tests cover fresh, directory-named-only and single-missing catalogs over a renamed tree, and an install-freshness test maps the check's exit status to fresh and stale.

## Story 8: bin/install links skills under their frontmatter names

**Requirement:** TI-8 — `bin/install` names each link by frontmatter (ADR D3).

As an operator, I want install to link each skill under its frontmatter name so that the host catalog name always matches the name the engine dispatches.

### Acceptance Criteria

#### Happy Path

- Given a checkout whose `skills/plan/SKILL.md` declares `name: ac-plan`, when `bin/install` runs against empty catalogs, then `~/.claude/skills/ac-plan` and `~/.agents/skills/ac-plan` resolve to that checkout's `skills/plan`.
- Given the shipped checkout, when `bin/install` runs against empty catalogs, then both catalogs hold exactly the same link names and targets as before this change.

#### Negative Paths

- Given a `SKILL.md` with no `name:` key, when `bin/install` runs, then that skill is linked under its directory name.
- Given catalogs holding a renamed checkout's frontmatter-named harness links and a foreign skill entry, when `bin/install --uninstall` runs, then every frontmatter-named harness link is removed and the foreign entry remains unchanged.
- Given a `SKILL.md` whose frontmatter block is never closed, when `bin/install` runs, then it reports that file by path, links no entry for it, and exits with status 1.

### Done When

- [ ] Install tests cover a renamed checkout, the unchanged shipped checkout, the missing-name fallback and the malformed frontmatter refusal.
