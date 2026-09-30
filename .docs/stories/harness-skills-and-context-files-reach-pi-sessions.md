**Status:** Accepted

# Stories: Harness skills and context files reach Pi sessions like other hosts

Technical track (no PRD). Requirements derive from issue jstoup111/ai-conductor#1888, the operator-confirmed scope boundary in `.docs/track/harness-skills-and-context-files-reach-pi-sessions.md`, the architecture review of the same stem, and adr-2026-09-24-built-in-provider-catalog-and-boot-discovery. Pi behavior cited below was verified on pi 0.84.3.

## Story 1: Pi step prompts invoke the skill with Pi's skill command

**Requirement:** TI-1. A Pi-dispatched skill step names its skill in the syntax Pi expands (`/skill:<name>`), declared by the Pi catalog descriptor.

As an operator running a build on Pi, I want each step's prompt to load its phase skill so that the step follows the same instructions a claude or codex dispatch of that step follows.

### Acceptance Criteria

#### Happy Path
- Given pi is the provider for the build step, when the step prompt is rendered, then its first line is `/skill:pipeline`.
- Given pi is the provider for a skill step with arguments such as architecture_review_as_built, when the step prompt is rendered, then its first line is `/skill:architecture-review --as-built` with the arguments after the skill name.
- Given pi is a build_review rubric or coverage-binding auxiliary candidate, when the auxiliary skill invocation is rendered, then it starts with `/skill:` followed by the auxiliary skill name.

#### Negative Paths
- Given claude or codex is the provider for any skill step, when the step prompt is rendered, then the first line is unchanged from before this feature (`/<name>` for claude, `$<name>` for codex).
- Given an engine-native step such as attribution_verify, when a skill invocation is rendered for pi, then rendering fails with the existing engine-native error and no Pi prompt is produced.
- Given a plugin provider id that is not in the built-in catalog, when a skill invocation is rendered for it, then the existing `/` default prefix is used and no Pi syntax leaks to it.

### Done When
- [ ] The Pi catalog descriptor declares `/skill:` as its invocation prefix, and a unit test asserts the rendered Pi prompt for the build step equals `/skill:pipeline`.
- [ ] Unit tests assert the rendered claude and codex prompts for the same steps are byte-identical to the pre-change output.

## Story 2: A Pi dispatch whose skill Pi cannot load is refused before spawning

**Requirement:** TI-2. Pi passes an unknown `/skill:<name>` through as plain chat and exits 0, so the engine confirms the named skill exists in a root Pi will load before it spawns Pi, and reports a miss with the same unresolved-skill-command classification a claude dispatch produces.

As an operator, I want a Pi step whose skill is not installed to fail visibly so that it never runs as an uninstructed chat that reports success.

### Acceptance Criteria

#### Happy Path
- Given the invoked skill's `SKILL.md` exists under `~/.agents/skills/<name>/`, when a Pi step dispatches, then Pi is spawned.
- Given `PI_CODING_AGENT_DIR` is set and the skill exists only under `$PI_CODING_AGENT_DIR/skills/<name>/`, when a Pi step dispatches, then Pi is spawned.
- Given `PI_CODING_AGENT_DIR` is unset and the skill exists only under `~/.pi/agent/skills/<name>/`, when a Pi step dispatches, then Pi is spawned.
- Given the skill exists only under the dispatch working directory's `.agents/skills/<name>/`, when a Pi step dispatches, then Pi is spawned.
- Given a Pi prompt whose first line does not start with `/skill:`, when it dispatches, then no skill-resolution check runs and Pi is spawned as before.

#### Negative Paths
- Given the invoked skill exists in none of the Pi skill roots, when a Pi step dispatches, then Pi is not spawned and the result carries the existing unresolved-skill-command classification naming the skill, with output listing every root searched.
- Given the skill exists only under the retired `$PI_HOME/skills/<name>/` location, when a Pi step dispatches, then the check does not count it as found and the dispatch is refused.
- Given the skill exists only under the working directory's `.pi/skills/<name>/`, which non-interactive Pi ignores for an untrusted project, when a Pi step dispatches, then the dispatch is refused.
- Given the skill directory exists but contains no `SKILL.md`, when a Pi step dispatches, then the dispatch is refused.
- Given a lifecycle step on Pi is refused for a missing skill and a further provider candidate is configured, when the step settles, then no other provider is invoked, no retry occurs, and the run halts mechanically naming the unresolved skill, exactly as for a claude unresolved command.
- Given a coverage-binding auxiliary member on Pi is refused for a missing skill, when the auxiliary executor settles that member, then it makes no further provider attempt and the recorded result keeps the unresolved-command classification.
- Given a Pi dispatch is refused for a missing skill, when the next Pi step of the same run dispatches a skill that does resolve, then Pi is spawned, because the refusal is not recorded as run-wide provider unavailability.
- Given a claude or codex dispatch, when its skill is missing from every Pi root, then no Pi skill-resolution check runs and the dispatch proceeds unchanged.

### Done When
- [ ] A Pi adapter test with an injected filesystem shows `execa` is never reached when the skill is absent from every root, and the returned result sets the unresolved-command classification with the skill name and does not set provider unavailability.
- [ ] The Pi catalog descriptor names `PI_CODING_AGENT_DIR` as its home variable, with `.pi/agent` as the default home under the user's home directory.

## Story 3: HARNESS.md behavioral rules reach every Pi session

**Requirement:** TI-3. A Pi session receives HARNESS.md in its system prompt, the way Claude receives it from its SessionStart hook, without relying on project prose.

As an operator, I want every Pi-dispatched step to carry the harness behavioral rules so that gates depending on HARNESS.md-following behave the same on Pi as on claude.

### Acceptance Criteria

#### Happy Path
- Given the installed skill catalog at `~/.agents/skills/HARNESS.md` resolves to a readable file, when a Pi step dispatches, then the Pi argv includes `--append-system-prompt` followed by that file's path.
- Given a project with neither `AGENTS.md` nor `CLAUDE.md`, when a Pi step dispatches, then HARNESS.md is still supplied through `--append-system-prompt`.

#### Negative Paths
- Given `~/.agents/skills/HARNESS.md` does not exist, when a Pi step dispatches, then Pi is not spawned and the result is a run-scope provider-unavailable failure, like a missing Pi executable, whose reason names HARNESS.md and tells the operator to run `bin/install`.
- Given `~/.agents/skills/HARNESS.md` is a dangling symlink to a removed checkout, when a Pi step dispatches, then Pi is not spawned and the same failure is returned.
- Given claude or codex is the provider, when a step dispatches, then its argv contains no `--append-system-prompt` added by this feature.

### Done When
- [ ] A Pi adapter test asserts the spawned argv contains `--append-system-prompt` with the resolved HARNESS.md path, and a separate test asserts no spawn when that path is missing or dangling.

## Story 4: Project-local skills load in non-interactive Pi sessions

**Requirement:** TI-4. A project's own `.agents/skills/` reach a Pi session without trusting the whole project.

As a maintainer of a project with repository-local skills, I want Pi steps to see those skills so that a Pi dispatch sees the same project skill set as a codex dispatch.

### Acceptance Criteria

#### Happy Path
- Given the dispatch working directory contains `.agents/skills/`, when a Pi step dispatches, then the Pi argv includes `--skill` followed by the absolute path of that directory.

#### Negative Paths
- Given the dispatch working directory has no `.agents/skills/` directory, when a Pi step dispatches, then the argv contains no `--skill` flag and the dispatch is not refused on that account.
- Given any Pi dispatch, when its argv is built, then it never contains `--approve` or `-a`, so project-local Pi extensions and settings stay untrusted.
- Given `.agents/skills` in the working directory is a regular file rather than a directory, when a Pi step dispatches, then no `--skill` flag is added for it.

### Done When
- [ ] Pi adapter tests assert the argv with and without a project `.agents/skills/` directory, and assert the absence of `--approve` in both.

## Story 5: Explicit-only harness skills stay explicit under Pi

**Requirement:** TI-5. Skills marked never-model-invocable keep that property when Pi is the host, and remain invocable by the engine's explicit skill command.

As the harness maintainer, I want explicit-only skills such as pipeline and conduct hidden from Pi's model-chosen skill list while the engine can still invoke them, so that Pi applies the same invocation policy as claude and codex.

### Acceptance Criteria

#### Happy Path
- Given a shipped skill whose `SKILL.md` frontmatter carries `disable-model-invocation: true`, when a Pi step invokes it explicitly with `/skill:<name>`, then the resolution check finds it and Pi is spawned.
- Given the skill invocation-policy integrity check, when it runs over the shipped catalog, then every explicit-only skill still carries the `disable-model-invocation: true` frontmatter that Pi honors.

#### Negative Paths
- Given the skill-resolution check, when it evaluates an explicit-only skill, then it does not refuse the dispatch because of the `disable-model-invocation` key.
- Given a shipped explicit-only skill with its `disable-model-invocation: true` line removed, when the invocation-policy integrity check runs, then it fails naming that skill.

### Done When
- [ ] A Pi adapter test resolves and spawns an explicit-only fixture skill carrying `disable-model-invocation: true`.
- [ ] The existing invocation-policy mutation test still fails on a removed `disable-model-invocation` line.

## Story 6: bin/install accepts Pi as a selected provider

**Requirement:** TI-6. `bin/install --providers` accepts `pi`, reports its readiness, verifies it under `--check`, and is idempotent without disturbing the claude and codex catalog links.

As an operator, I want to select Pi at install time so that the installer tells me whether Pi is ready and keeps the skill catalog Pi reads in place.

### Acceptance Criteria

#### Happy Path
- Given `pi` is on PATH and `pi --version` exits 0, when `bin/install --providers pi` runs, then it completes successfully and the installer's own readiness report shows Pi as ready, independent of the engine catalog's runtime readiness capability.
- Given `pi` is on PATH, when `bin/install --providers claude,codex,pi` runs, then all three are reported and the install completes successfully.
- Given the interactive provider chooser, when it is shown, then Pi appears as a selectable built-in provider.
- Given `pi` is on PATH and the install already ran with `--providers pi`, when `bin/install --check --providers pi` runs, then it exits 0.
- Given a completed `bin/install --providers pi`, when it runs a second time, then no skill or HARNESS.md link under `~/.claude/skills` or `~/.agents/skills` is created, removed, or repointed.

#### Negative Paths
- Given `pi` is not on PATH, when `bin/install --providers pi` runs, then the install still completes and prints an advisory that Pi is not installed.
- Given `pi` is not on PATH, when `bin/install --check --providers pi` runs, then it exits non-zero naming Pi as the missing provider.
- Given an unsupported value such as `--providers foo`, when `bin/install` runs, then it is rejected before any readiness check with an error listing Claude, Codex, and Pi as the supported built-in providers.
- Given existing `~/.claude/skills` and `~/.agents/skills` link sets from a claude and codex install, when `bin/install --providers pi` runs, then the listing of both directories with link targets is identical before and after.
- Given the daemon freshness check, when it runs `bin/install --check` without `--providers`, then its result is unchanged by this feature.

### Done When
- [ ] `test/test_install_provider_readiness.sh` covers `pi` in the accepted-provider, missing-CLI advisory, and strict `--check` cases.
- [ ] A catalog idempotence test shows the `~/.claude/skills` and `~/.agents/skills` link listings are identical across a repeat `--providers pi` install.

## Story 7: Pi's build_review refusal names the intake that owns it

**Requirement:** TI-7. The review-policy capability stays unsupported for Pi, and its refusal points at the open follow-up intake instead of this one.

As an operator whose build_review candidate ladder includes Pi, I want the refusal to name the intake that will deliver Pi review support so that I am not sent to a closed issue.

### Acceptance Criteria

#### Happy Path
- Given pi is a build_review candidate, when the lap checks the review-policy catalog capability, then the refusal message names intake #2852.

#### Negative Paths
- Given pi is a build_review candidate, when the lap runs, then Pi is still refused before spawning and the ladder proceeds exactly as before this feature.
- Given claude or codex is a build_review candidate, when the lap runs, then review-policy discovery and dispatch are unchanged.

### Done When
- [ ] The provider-catalog test asserts the review-policy capability owner is `#2852` and that the Pi descriptor still does not declare the capability.
