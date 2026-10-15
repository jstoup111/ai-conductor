# Implementation Plan: Skill names resolve from frontmatter (Spec 1 of #885)

**Date:** 2026-10-14
**Design:** .docs/decisions/adr-2026-10-14-ac-prefixed-skill-names.md (APPROVED; Decisions 2, 3, 7) · .docs/architecture/namespace-harness-skill-and-agent-names-so-they-ca.md
**Stories:** .docs/stories/namespace-harness-skill-and-agent-names-so-they-ca.md
**Conflict check:** Clean as of 2026-10-14

## Summary

Every host-visible skill name the harness produces — built-in step dispatch on Claude, Codex and Pi, the build-review grader, rebase-regrade and rebase dispatches, the composer, monitor and prelude launches, operator-only `skillOverrides`, the self-host provider home, the Claude self-host sandbox, the live-tier preflight, and `bin/install` linking, `--check` (which install-freshness runs), ownership, reconcile and `--uninstall` — is read from the skill's frontmatter `name:` in the skill tree being served. Shipped `name:` values stay equal to their directories, so nothing visible changes; the `ac-` flip is follow-up intake jstoup111/ai-conductor#3233. Ten tasks.

## Technical Approach

- **One resolver.** A new `src/conductor/src/engine/skill-names.ts` exports `resolveSkillName(skillsRoot, dir)`: it reads `<skillsRoot>/skills/<dir>/SKILL.md`, returns the frontmatter `name:` or `<dir>` when the key is absent, and throws naming the path when the file is missing or its frontmatter block is unclosed. A `null` skills root returns `<dir>`. It has its own small reader (leading and closing `---` lines, CRLF tolerant, block parsed with the `js-yaml` dependency); the existing readers in `skill-resolver.ts` and `build-review-policy-claude.ts` serve other contracts and cannot distinguish an unclosed block.
- **Directory id vs host name.** `STEP_SKILL_INVOCATIONS`, `steps.ts` `skillName`, `OPERATOR_ONLY_SKILLS` and build-review rubric path loads keep directory ids. `renderSkillInvocation` takes a resolved name. `DefaultStepRunner` gains a `skillNameRoot: string | null` constructor option (the test seam): `daemon-cli.ts` passes the feature worktree when the daemon's self-host detection marks the project as self-host and `resolveHarnessRoot()` (module-relative, `install-freshness.ts`) otherwise; `index.ts` passes `resolveHarnessRoot()`. The runner uses that root for built-in steps, the build-review graders and their installed policy match, rebase-regrade, the legacy rebase resolver, and the worktree `skillOverrides` writer. The composer launcher, monitor and project prelude resolve against `resolveHarnessRoot()` through an optional injectable root. Custom and `parallel[].skill` steps keep their existing resolution.
- **Catalogs.** `self-host/provider-home.ts` copies each skill to `<home>/skills/<name>`; `self-host/sandbox-build-env.ts` builds `skills/` as one link per skill named `<name>` into the worktree's `skills/<dir>`; the live-tier preflight fixture (`test/fixtures/step-command-preflight.ts`) gains a source-tree argument and looks up `<home>/skills/<name>/SKILL.md`; Pi's existing `<root>/<name>/SKILL.md` lookup then works unchanged against name-keyed catalogs; `bin/install` keys linking, `--check`, `owned_skill_link`, the legacy Codex reconcile and `--uninstall` by a shell frontmatter reader, exiting 1 on an unclosed block. `install-freshness.ts` keeps delegating to `bin/install --check`.
- **Tests use a renamed fixture.** Each task proves behavior on a temp skill tree whose `name:` differs from its directory, plus an unchanged-output assertion on the shipped tree. Install tests follow `test/test_codex_skill_installation.sh` (isolated `HOME`, copied checkout, `readlink` listings).
- **Release metadata.** The release classifier flags every `bin/install` change as the "skill symlink targets" surface. This spec changes no shipped link name or target, so Task 9 commits `.docs/release-waivers/namespace-harness-skill-and-agent-names-so-they-ca.md` rather than an empty migration. New shell tests are registered in `test/shell_tests.manifest`.

## Prerequisites

- None.

## Tasks

### Task 1: Frontmatter skill-name resolver
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/skill-names.test.ts` over a temp skill tree: `resolveSkillName(root, 'explore')` returns `ac-explore` when `skills/explore/SKILL.md` declares `name: ac-explore` (LF and CRLF files); returns `explore` when the frontmatter has no `name:` key; returns the directory when `root` is `null`; throws an error containing the `SKILL.md` path when the file is missing; throws an error containing the path when the frontmatter block is never closed. Also test `skillNameRootFor({ isSelfHost, worktreePath, harnessRoot })`: it returns `worktreePath` when `isSelfHost` is true and `harnessRoot` (possibly `null`) otherwise.
2. Verify RED.
3. Implement `src/conductor/src/engine/skill-names.ts` with its own small reader: match a leading `---` line, require a closing `---` line (CRLF tolerant), and parse the block with the `js-yaml` `load` the engine already depends on. Do not change `skill-resolver.ts` or `build-review-policy-claude.ts`: their readers serve other contracts (custom steps, review policy) and neither distinguishes an unclosed block. Export `skillNameRootFor` from the same module so every construction site (daemon runner closures, `daemon-deps.ts`, `index.ts`) chooses the root the same way.
4. Verify GREEN and commit.

**Done when:**
- [test] `resolveSkillName` in `src/conductor/src/engine/skill-names.ts` returns `ac-explore` for a fixture `skills/explore/SKILL.md` declaring `name: ac-explore` in both LF and CRLF files, and returns the directory name `explore` when the frontmatter has no `name:` key or the skills root is `null`, as asserted in `skill-names.test.ts`.
- [test] `resolveSkillName` throws an error containing the `SKILL.md` path when the file is missing, and throws an error containing the path when the frontmatter block is never closed.
- [test] `skillNameRootFor` returns the worktree path for a self-host project and the engine harness root (or `null`) otherwise.

**Files:** src/conductor/src/engine/skill-names.ts; src/conductor/test/engine/skill-names.test.ts

**Dependencies:** none

### Task 2: Built-in step dispatch renders the resolved name from the served tree
**Story:** 1
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/skill-invocation.test.ts`: `renderSkillInvocation` renders the resolved name it is given (`/ac-explore`, `$ac-explore`, `/skill:ac-explore`); over the shipped tree every built-in step's rendering for all three providers equals a snapshot of the pre-change rendering.
2. Write failing tests in a new `src/conductor/test/engine/step-runners-skill-name.test.ts` constructing `DefaultStepRunner` with the new `skillNameRoot` option (the injection seam): a root whose `explore` declares `ac-explore` renders `ac-explore`; a root lacking `name:` renders the directory; a missing or unclosed `SKILL.md` fails naming the step and the path with no invocation rendered; `skillNameRoot: null` renders directory names. In `src/conductor/test/engine/daemon-cli-skill-name-root.test.ts`, driving `runDaemonMode` with a mocked runner constructor, every runner construction passes the feature worktree as `skillNameRoot` for a self-host project (worktree `ac-explore`, harness root `explore` → only `ac-explore` appears) and `resolveHarnessRoot()`'s value otherwise, so a target-project `skills/explore/SKILL.md` is ignored. Add a `build-review-registry.test.ts` case that rubric file loading still reads `skills/<dir>/SKILL.md` by directory path under a renamed fixture.
3. Verify RED.
4. Implement: `renderSkillInvocation` in `src/conductor/src/engine/skill-invocation.ts` gains an optional third `resolvedName` argument defaulting to the descriptor's `skillName`, so callers owned by Tasks 5 and 7 keep compiling and rendering unchanged until they adopt it; `DefaultStepRunner` (`src/conductor/src/engine/step-runners.ts`) gains an optional `skillNameRoot: string | null` that defaults to `null` (directory names) when omitted, so existing constructions are unaffected, and resolves built-in step names with `resolveSkillName(skillNameRoot, skillName)`, wrapping resolver errors with the step name; the four inline `DefaultStepRunner` constructions in `runDaemonMode` (`src/conductor/src/daemon-cli.ts`) pass `skillNameRootFor({ isSelfHost, worktreePath, harnessRoot: await resolveHarnessRoot() })`; `src/conductor/src/index.ts` passes `await resolveHarnessRoot()`. Custom and `parallel[].skill` resolution and rubric path loads are unchanged.
5. Verify GREEN and commit.

**Done when:**
- [test] With a `skillNameRoot` whose `skills/explore/SKILL.md` declares `name: ac-explore`, the explore step renders invocations beginning `/ac-explore`, `$ac-explore` and `/skill:ac-explore` for claude, codex and pi, as asserted in `step-runners-skill-name.test.ts`.
- [test] With the shipped skill tree as `skillNameRoot`, every built-in step's rendered invocation for claude, codex and pi is identical to the pre-change rendering captured in `skill-invocation.test.ts`, a fixture for a built-in step without a `name:` key renders the directory name, and a runner constructed without `skillNameRoot` renders directory names.
- [test] A built-in step whose `SKILL.md` is missing, or whose frontmatter block is never closed, fails with an error naming the step and that `SKILL.md` path, and no invocation is rendered.
- [test] Every `DefaultStepRunner` construction in `runDaemonMode` gives a self-host dispatch the feature worktree as `skillNameRoot`, so it renders the worktree's `ac-explore` and never the engine harness root's `explore`; a non-self-host dispatch whose engine harness root declares `ac-explore` renders `ac-explore` and ignores a target-project `skills/explore/SKILL.md`, and a non-self-host dispatch whose engine harness root cannot be resolved (`resolveHarnessRoot()` returns `null`) renders the directory name, as asserted in `daemon-cli-skill-name-root.test.ts` and `step-runners-skill-name.test.ts`.
- [test] Under a renamed fixture, build-review rubric file loading reads `skills/<dir>/SKILL.md` by directory path and not a path built from the frontmatter name, as asserted in `build-review-registry.test.ts`.

**Files:** src/conductor/src/engine/skill-invocation.ts; src/conductor/src/engine/step-runners.ts; src/conductor/src/daemon-cli.ts; src/conductor/src/index.ts; src/conductor/test/engine/skill-invocation.test.ts; src/conductor/test/engine/step-runners-skill-name.test.ts; src/conductor/test/engine/daemon-cli-skill-name-root.test.ts; src/conductor/test/engine/build-review-registry.test.ts

**Dependencies:** Task 1

### Task 3: Auxiliary and legacy harness-skill dispatches resolve frontmatter names
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners-skill-name.test.ts` with a `skillNameRoot` where `build-review-security`, `rebase-regrade`, `rebase`, `conduct` and `pr` declare `ac-` names: the build-review security grader prompt begins with the provider prefix plus `ac-build-review-security` and its installed review policy is matched by `ac-build-review-security`; the rebase regrade prompt names `ac-rebase-regrade`; the legacy rebase resolver prompt is `/ac-rebase`; the legacy complexity assessment prompt is `/ac-conduct complexity`; the finish PR-prose dispatch names `/ac-pr` and `$ac-pr`. With the shipped tree, capture each prompt for both a claude and a codex `providerKey` and assert identity with the pre-change values.
2. Verify RED.
3. Implement in `src/conductor/src/engine/step-runners.ts`: the build-review grader and `REBASE_REGRADE_SKILL` prompts render `resolveSkillName(skillNameRoot, dir)` through `renderAuxiliarySkillInvocation`, and `resolveInstalledReviewPolicyCatalog` receives the resolved name; the two legacy rebase prompts keep their literal `/` prefix and become `/${resolved rebase}`; the two legacy complexity prompts become `/${resolved conduct} complexity`; the finish PR-prose text names `/${resolved pr}` and `$${resolved pr}`. Custom-skill auxiliary invocations are unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] With a renamed `skillNameRoot`, the build-review security grader, rebase regrade judgement, rebase resolver, legacy complexity assessment and finish PR-prose prompts name `ac-build-review-security`, `ac-rebase-regrade`, `/ac-rebase`, `/ac-conduct complexity` and `/ac-pr` with `$ac-pr` respectively, and the grader's installed review policy is matched by `ac-build-review-security`, as asserted in `step-runners-skill-name.test.ts`.
- [test] With the shipped tree, each of those prompts and the review-policy match is identical to its pre-change value for both a claude and a codex `providerKey`, including the literal `/rebase` legacy prompt.

**Files:** src/conductor/src/engine/step-runners.ts; src/conductor/test/engine/step-runners-skill-name.test.ts

**Dependencies:** Task 2

### Task 4: Pi resolves frontmatter-named catalog entries
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write tests in `src/conductor/test/execution/pi-provider.test.ts`: with a catalog whose entries are keyed by frontmatter name (an `ac-explore` entry holding the explore skill), a `/skill:ac-explore` first token resolves the explore skill and a `/skill:explore` first token does not; with the shipped tree the rendered build-step prompt is `/skill:pipeline` and resolves the pipeline skill.
2. Run them. Pi's existing lookup checks `<root>/<name>/SKILL.md` for the rendered name, so catalogs keyed by frontmatter name (Tasks 7 and 9) need no parser change; if a test fails, fix the lookup without parsing foreign skills' frontmatter.
3. Commit.

**Done when:**
- [test] With a catalog keyed by frontmatter name, the Pi provider resolves the explore skill for a `/skill:ac-explore` first token and does not resolve it for a `/skill:explore` first token, as asserted in `pi-provider.test.ts`.
- [test] With the shipped tree, the rendered Pi build-step prompt is `/skill:pipeline` and the Pi provider resolves it to the pipeline skill.

**Files:** src/conductor/test/execution/pi-provider.test.ts; src/conductor/src/execution/pi-provider.ts

**Dependencies:** Task 2

### Task 5: Composer, monitor and prelude launches use frontmatter names
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests with a renamed fixture declaring `ac-composer`, `ac-daemon-triage`, `ac-bootstrap` and `ac-assess`, injecting the harness root through each site's new optional `skillNameRoot` parameter: in `src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts` the launcher spawns `/ac-composer` (claude) and `$ac-composer` (codex), and its nesting refusals and codex ENOENT message name `/ac-composer` or `$ac-composer` and never `/composer` or `$composer`; in `src/conductor/test/engine/monitor/session.test.ts` the opening prompt carries `ac-daemon-triage`; in `src/conductor/test/engine/project-prelude.test.ts` the prelude invokes `ac-bootstrap` and `ac-assess`. Keep the existing shipped-tree assertions (codex argv exactly `$composer`).
2. Verify RED.
3. Implement in `src/conductor/src/engine/engineer-cli.ts` (launch prompt, refusal and ENOENT messages), `src/conductor/src/engine/monitor/session.ts` (`triageInvocation` takes the resolved name; its async caller resolves it) and `src/conductor/src/engine/project-prelude.ts`, each resolving against the engine harness root (`resolveHarnessRoot()`) by default.
4. Verify GREEN and commit.

**Done when:**
- [test] With a renamed fixture, the composer launcher, the monitor guided session and the project prelude invoke `ac-composer`, `ac-daemon-triage`, `ac-bootstrap` and `ac-assess` respectively, as asserted in `engineer-cli-launch-host.test.ts`, `monitor/session.test.ts` and `project-prelude.test.ts`.
- [test] With the shipped tree and codex selected, the composer launcher's argv is exactly one positional prompt `$composer`.
- [test] With a renamed fixture declaring `ac-composer`, the launcher's nesting refusal inside a Claude or Codex session and its codex ENOENT message name `/ac-composer` or `$ac-composer` and contain neither `/composer` nor `$composer`.

**Files:** src/conductor/src/engine/engineer-cli.ts; src/conductor/src/engine/monitor/session.ts; src/conductor/src/engine/project-prelude.ts; src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts; src/conductor/test/engine/monitor/session.test.ts; src/conductor/test/engine/project-prelude.test.ts

**Dependencies:** Task 2

### Task 6: Operator-only skillOverrides keyed by frontmatter name
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/worktree-prepare.test.ts` passing a renamed `skillNameRoot` where `daemon-triage` declares `name: ac-daemon-triage`: settings carry `skillOverrides['ac-daemon-triage'] === 'off'` and no `daemon-triage` key; an operator entry for another skill is preserved; an operator entry setting `ac-daemon-triage` to `on` becomes `off`. Add a `src/conductor/test/engine/daemon-deps.test.ts` case that the daemon's `prepareWorktree` dependency passes the self-host worktree (or engine harness root) as `skillNameRoot`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/worktree-prepare.ts`: `prepareWorktree` and the session-hook settings writer it reaches take an optional `skillNameRoot` (default `null`), keying each `OPERATOR_ONLY_SKILLS` override by `resolveSkillName(skillNameRoot, skill)` with merge-preserve; the production caller in `src/conductor/src/engine/daemon-deps.ts` passes `skillNameRootFor({ isSelfHost, worktreePath, harnessRoot: await resolveHarnessRoot() })`.
4. Verify GREEN and commit.

**Done when:**
- [test] With a renamed `skillNameRoot`, a dispatched worktree's settings `skillOverrides` sets `ac-daemon-triage` to `off` and contains no `daemon-triage` key, as asserted in `worktree-prepare.test.ts`.
- [test] An operator's existing `skillOverrides` entry for another skill is preserved unchanged, and an operator entry setting the operator-only skill's name to `on` is written as `off`.
- [test] The daemon's `prepareWorktree` dependency in `daemon-deps.ts` passes `skillNameRoot` from `skillNameRootFor`, so a self-host worktree whose `daemon-triage` declares `ac-daemon-triage` is prepared with `ac-daemon-triage` set to `off`.

**Files:** src/conductor/src/engine/worktree-prepare.ts; src/conductor/src/engine/daemon-deps.ts; src/conductor/test/engine/worktree-prepare.test.ts; src/conductor/test/engine/daemon-deps.test.ts

**Dependencies:** Task 2

### Task 7: Self-host provider home and live-tier preflight keyed by frontmatter name
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/self-host/provider-home.test.ts` over a worktree renamed fixture: the skills catalog lists each skill under its frontmatter name, lists no operator-only skill (neither `ac-daemon-triage` nor `daemon-triage`), and has no entry named after a directory whose name differs; for an `agentsSkillsLink` provider, `.agents/skills` lists the same entries. In `src/conductor/test/fixtures/step-command-preflight.test.ts`, `assertStepCommandsResolve` given the new `sourceRoot` argument resolves each built-in step's name from the source tree and finds `<home>/skills/<name>/SKILL.md`, reporting no miss; when the provider home lacks the `ac-pipeline` entry it fails before dispatch naming `ac-pipeline`.
2. Verify RED.
3. Implement: `src/conductor/src/engine/self-host/provider-home.ts` adds `readdir` to the injected `ProviderHomeFs` seam, enumerates worktree skill directories through it, copies a directory without `SKILL.md` under its own name, and copies each skill to `<home>/skills/<resolveSkillName(worktree, dir)>`, pruning operator-only skills by directory id before copying; `src/conductor/test/fixtures/step-command-preflight.ts` takes `sourceRoot`, resolves names through `resolveSkillName(sourceRoot, dir)` and checks `<home>/skills/<name>/SKILL.md`, rendering through the Task 2 `renderSkillInvocation` resolved-name argument; the live end-to-end body in `live-daemon-e2e-build-step-never-runs-a-real-agent.acceptance.test.ts` and its preflight type pass the checkout under test as `sourceRoot`.
4. Verify GREEN and commit.

**Done when:**
- [test] `provisionProviderHome` over a worktree renamed fixture produces a skills catalog listing each skill under its frontmatter name, with no operator-only skill and no entry named after a directory whose frontmatter name differs, as asserted in `provider-home.test.ts`.
- [test] For a provider whose self-host shape links `.agents/skills`, the `.agents/skills` listing equals the skills catalog listing.
- [test] With `daemon-triage` declaring `name: ac-daemon-triage`, neither `ac-daemon-triage` nor `daemon-triage` exists in the prepared catalog.
- [test] `assertStepCommandsResolve` given a renamed source tree finds every built-in step's skill in the provider home under its frontmatter name and reports no missing command, and when the home lacks the `ac-pipeline` entry it fails before any dispatch naming `ac-pipeline`, as asserted in `step-command-preflight.test.ts`.
- The live end-to-end acceptance body calls the preflight with the checkout under test as `sourceRoot`, so the real live-tier run resolves frontmatter names rather than directory names.

**Files:** src/conductor/src/engine/self-host/provider-home.ts; src/conductor/test/engine/self-host/provider-home.test.ts; src/conductor/test/fixtures/step-command-preflight.ts; src/conductor/test/fixtures/step-command-preflight.test.ts; src/conductor/test/acceptance/live-daemon-e2e-build-step-never-runs-a-real-agent.acceptance.test.ts

**Dependencies:** Task 2

### Task 8: Claude self-host sandbox exposes per-skill frontmatter-named links
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/self-host/sandbox-build-env.test.ts`: provisioning over a worktree renamed fixture creates `skills/` as a real directory with one symlink per skill named by its frontmatter name and resolving to that worktree's `skills/<dir>`; replace the existing assertion that `skills` itself is a symlink.
2. Verify RED.
3. Implement in `src/conductor/src/engine/self-host/sandbox-build-env.ts`: add `readdir` to the injected `SandboxFs` seam, build `skills/` as a directory of per-skill links named by `resolveSkillName(worktree, dir)`, keep the missing-asset `SandboxProvisionError`, and update `sandboxLinkTargets` to enumerate every per-skill link target.
4. Verify GREEN and commit.

**Done when:**
- [test] Provisioning the Claude self-host sandbox over a worktree renamed fixture creates a `skills/` directory with one link per worktree skill, named by its frontmatter name and resolving to that worktree's `skills/<dir>`, as asserted in `sandbox-build-env.test.ts`.
- [test] With the shipped tree, the sandbox's `skills/` entries are named exactly as the worktree's skill directories, and `sandboxLinkTargets` returns every per-skill link target inside the worktree.

**Files:** src/conductor/src/engine/self-host/sandbox-build-env.ts; src/conductor/test/engine/self-host/sandbox-build-env.test.ts

**Dependencies:** Task 1

### Task 9: bin/install links skills under their frontmatter names
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing scenarios in a new `test/test_install_skill_names.sh` following `test/test_codex_skill_installation.sh` (isolated `HOME`, copied checkout, `readlink` listings), and register it in `test/shell_tests.manifest` beside `test_codex_skill_installation.sh`: a checkout where `skills/plan/SKILL.md` declares `name: ac-plan`; the shipped checkout compared against a listing captured from the pre-change installer; a `SKILL.md` with no `name:` key; a `SKILL.md` with an unclosed frontmatter block.
2. Verify RED.
3. Implement in `bin/install`: a `skill_frontmatter_name` shell function reads `name:` from the leading `---` block (falling back to the directory, failing on an unclosed block); the link loop links `<catalog>/<name>` for the Claude and Codex catalogs; an unclosed block is reported by path, that skill is not linked, and install exits 1 after the loop. Because the release classifier flags every `bin/install` change as the "skill symlink targets" surface, add `.docs/release-waivers/namespace-harness-skill-and-agent-names-so-they-ca.md` waiving `skill symlink targets`: shipped link names and targets are unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] In `test/test_install_skill_names.sh`, with `skills/plan/SKILL.md` declaring `name: ac-plan`, `bin/install` against empty catalogs leaves `~/.claude/skills/ac-plan` and `~/.agents/skills/ac-plan` resolving to that checkout's `skills/plan`.
- [test] With the shipped checkout, both catalogs hold exactly the same link names and targets as the listing captured from the pre-change installer.
- [test] A `SKILL.md` with no `name:` key is linked under its directory name.
- [test] A `SKILL.md` whose frontmatter block is never closed is reported by path, no entry is linked for it, and `bin/install` exits with status 1.
- `test/shell_tests.manifest` classifies `test_install_skill_names.sh`, and `.docs/release-waivers/namespace-harness-skill-and-agent-names-so-they-ca.md` waives `skill symlink targets`.

**Files:** bin/install; test/test_install_skill_names.sh; test/shell_tests.manifest; .docs/release-waivers/namespace-harness-skill-and-agent-names-so-they-ca.md

**Dependencies:** none

### Task 10: bin/install check, ownership, reconcile and uninstall use frontmatter names
**Story:** 7
**Story:** 8
**Type:** negative-path

**Steps:**
1. Add failing scenarios to `test/test_install_skill_names.sh` over a renamed checkout: `--check` with frontmatter-named links exits 0; with only directory-named links it reports each missing frontmatter-named link by name and exits non-zero; with one catalog missing only `ac-plan` it reports `ac-plan` missing for that catalog; `--uninstall` removes every frontmatter-named harness link and leaves a foreign entry unchanged. Add an `src/conductor/test/engine/install-freshness.test.ts` case that a zero `--check` exit is fresh and a non-zero exit is stale.
2. Verify RED.
3. Implement in `bin/install`: the `--check` loops, `owned_skill_link`, the legacy Codex reconcile and the `--uninstall` loop key each skill by `skill_frontmatter_name`. `install-freshness.ts` keeps delegating to `--check`.
4. Verify GREEN and commit.

**Done when:**
- [test] Over a renamed checkout whose catalogs hold frontmatter-named links, `bin/install --check` exits 0, and install-freshness maps that exit to fresh, as asserted in `test_install_skill_names.sh` and `install-freshness.test.ts`.
- [test] With only directory-named links, `bin/install --check` reports every missing frontmatter-named link by name and exits non-zero, and install-freshness maps that exit to stale.
- [test] With one catalog missing only the `ac-plan` link, `bin/install --check` reports `ac-plan` missing for that catalog and exits non-zero.
- [test] `bin/install --uninstall` over catalogs holding a renamed checkout's frontmatter-named harness links and a foreign skill entry removes every frontmatter-named harness link and leaves the foreign entry unchanged.

**Files:** bin/install; test/test_install_skill_names.sh; src/conductor/test/engine/install-freshness.test.ts

**Dependencies:** Task 9

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3
   │          ├─────▶ Task 4
   │          ├─────▶ Task 5
   │          ├─────▶ Task 6
   │          └─────▶ Task 7
   └────▶ Task 8
Task 9 ──▶ Task 10
```

## Integration Points

- After Tasks 2-3: every built-in and auxiliary harness-skill dispatch, self-host and not, renders frontmatter names.
- After Tasks 7-8: self-host catalogs carry the same names the engine dispatches.
- After Tasks 9-10: a real `bin/install` links, checks and uninstalls catalogs keyed by frontmatter name.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-14-ac-prefixed-skill-names#D1 | no-change | none | Delivered by follow-up intake jstoup111/ai-conductor#3233 per Decision 7; this spec keeps every shipped `name:` equal to its directory. |
| adr-2026-10-14-ac-prefixed-skill-names#D2 | task | task-1, task-2, task-3, task-4, task-5, task-6 | Every `DefaultStepRunner` construction in `runDaemonMode` gives a self-host dispatch the feature worktree as `skillNameRoot`, so it renders the worktree's `ac-explore` and never the engine harness root's `explore`; a non-self-host dispatch whose engine harness root declares `ac-explore` renders `ac-explore` and ignores a target-project `skills/explore/SKILL.md`, and a non-self-host dispatch whose engine harness root cannot be resolved (`resolveHarnessRoot()` returns `null`) renders the directory name, as asserted in `daemon-cli-skill-name-root.test.ts` and `step-runners-skill-name.test.ts`. |
| adr-2026-10-14-ac-prefixed-skill-names#D3 | task | task-7, task-8, task-9, task-10 | Provisioning the Claude self-host sandbox over a worktree renamed fixture creates a `skills/` directory with one link per worktree skill, named by its frontmatter name and resolving to that worktree's `skills/<dir>`, as asserted in `sandbox-build-env.test.ts`. |
| adr-2026-10-14-ac-prefixed-skill-names#D4 | no-change | none | Bare-link reconcile is delivered by follow-up intake jstoup111/ai-conductor#3233 per Decision 7; this spec renames no link. |
| adr-2026-10-14-ac-prefixed-skill-names#D5 | no-change | none | Collision reporting is delivered by follow-up intake jstoup111/ai-conductor#3233 per Decision 7; this spec creates no `ac-` name. |
| adr-2026-10-14-ac-prefixed-skill-names#D6 | no-change | none | Reference rewrites, integrity enforcement and the consumer migration are delivered by follow-up intake jstoup111/ai-conductor#3233 per Decision 7. |
| adr-2026-10-14-ac-prefixed-skill-names#D7 | task | task-2, task-9 | With the shipped skill tree as `skillNameRoot`, every built-in step's rendered invocation for claude, codex and pi is identical to the pre-change rendering captured in `skill-invocation.test.ts`, a fixture for a built-in step without a `name:` key renders the directory name, and a runner constructed without `skillNameRoot` renders directory names. |
| adr-2026-06-30-sandbox-build-isolation#D1 | task | task-8 | Provisioning the Claude self-host sandbox over a worktree renamed fixture creates a `skills/` directory with one link per worktree skill, named by its frontmatter name and resolving to that worktree's `skills/<dir>`, as asserted in `sandbox-build-env.test.ts`. |
| adr-2026-06-30-sandbox-build-isolation#D2 | existing | none | `ThrowawaySandbox.teardown()` in `src/conductor/src/engine/self-host/sandbox-build-env.ts` removes the sandbox once (`tornDown` guard, `force: true`); this spec changes only how `skills/` entries are named. |
| adr-2026-06-30-sandbox-build-isolation#D3 | no-change | none | The sandbox no longer copies operator credentials (later self-host work authenticates without a credential copy); this spec touches no credential handling. |
| adr-2026-06-30-sandbox-build-isolation#D4 | no-change | none | `sandbox-build-env.ts` now writes an engine-owned empty `settings.json` rather than a retargeted copy; this spec touches no settings handling. |
| adr-2026-06-30-sandbox-build-isolation#D5 | no-change | none | The per-skill links this spec adds resolve only into the build worktree's `skills/<dir>`, never to a global-config target; credentials and settings remain copies. |
| adr-2026-06-30-sandbox-build-isolation#D6 | existing | none | `sandbox-build-env.ts` throws `SandboxProvisionError` for a missing worktree asset and removes the partial sandbox; Task 8 keeps the missing-asset failure unchanged. |
| adr-2026-06-30-sandbox-build-isolation#D7 | existing | none | The sandbox `env()` returns a child environment with `CLAUDE_CONFIG_DIR` pointed at the sandbox and never mutates the parent env; untouched by this spec. |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a renamed fixture where `skills/explore/SKILL.md` declares `name: ac-explore`, when the engine renders the explore step for claude, codex and pi, then the invocations begin with `/ac-explore`, `$ac-explore` and `/skill:ac-explore` respectively. | 2 | "With a `skillNameRoot` whose `skills/explore/SKILL.md` declares `name: ac-explore`, the explore step renders invocations beginning `/ac-explore`, `$ac-explore` and `/skill:ac-explore` for claude, codex and pi, as asserted in `step-runners-skill-name.test.ts`." | diff-local |
| Story 1 happy: Given the shipped skill tree, when the engine renders every built-in step that has a skill invocation for claude, codex and pi, then each rendered invocation is identical to the invocation rendered before this change. | 2 | "With the shipped skill tree as `skillNameRoot`, every built-in step's rendered invocation for claude, codex and pi is identical to the pre-change rendering captured in `skill-invocation.test.ts`, a fixture for a built-in step without a `name:` key renders the directory name, and a runner constructed without `skillNameRoot` renders directory names." | diff-local |
| Story 1 happy: Given a renamed fixture where `build-review-security`, `rebase-regrade`, `rebase`, `conduct` and `pr` declare `ac-` names, when the engine dispatches the build-review security grader, the rebase regrade judgement, the rebase resolver, the legacy complexity assessment and the finish PR-prose step, then each prompt names the `ac-` skill and the grader's installed review policy is matched by its `ac-` name. | 3 | "With a renamed `skillNameRoot`, the build-review security grader, rebase regrade judgement, rebase resolver, legacy complexity assessment and finish PR-prose prompts name `ac-build-review-security`, `ac-rebase-regrade`, `/ac-rebase`, `/ac-conduct complexity` and `/ac-pr` with `$ac-pr` respectively, and the grader's installed review policy is matched by `ac-build-review-security`, as asserted in `step-runners-skill-name.test.ts`." | diff-local |
| Story 1 negative: Given a fixture `SKILL.md` for a built-in step whose frontmatter has no `name:` key, when the engine renders that step, then the invocation uses the skill's directory name. | 1, 2 | "With the shipped skill tree as `skillNameRoot`, every built-in step's rendered invocation for claude, codex and pi is identical to the pre-change rendering captured in `skill-invocation.test.ts`, a fixture for a built-in step without a `name:` key renders the directory name, and a runner constructed without `skillNameRoot` renders directory names." | diff-local |
| Story 1 negative: Given a built-in step whose skill directory has no `SKILL.md` in the skill tree being served, when the engine renders that step, then it fails with an error naming the step and the missing `SKILL.md` path and renders no invocation. | 2 | "A built-in step whose `SKILL.md` is missing, or whose frontmatter block is never closed, fails with an error naming the step and that `SKILL.md` path, and no invocation is rendered." | diff-local |
| Story 1 negative: Given a fixture `SKILL.md` whose frontmatter block is never closed, when the engine renders that skill's step, then it fails with an error naming that `SKILL.md` path and renders no invocation. | 2 | "A built-in step whose `SKILL.md` is missing, or whose frontmatter block is never closed, fails with an error naming the step and that `SKILL.md` path, and no invocation is rendered." | diff-local |
| Story 1 negative: Given a renamed fixture, when the engine loads a build-review rubric file, then it reads `skills/<dir>/SKILL.md` by directory path and not a path built from the frontmatter name. | 2 | "Under a renamed fixture, build-review rubric file loading reads `skills/<dir>/SKILL.md` by directory path and not a path built from the frontmatter name, as asserted in `build-review-registry.test.ts`." | diff-local |
| Story 2 happy: Given a self-host dispatch whose worktree `skills/explore/SKILL.md` declares `name: ac-explore` while the engine harness root declares `name: explore`, when the explore step is dispatched, then the invocation names `ac-explore`. | 2 | "Every `DefaultStepRunner` construction in `runDaemonMode` gives a self-host dispatch the feature worktree as `skillNameRoot`, so it renders the worktree's `ac-explore` and never the engine harness root's `explore`; a non-self-host dispatch whose engine harness root declares `ac-explore` renders `ac-explore` and ignores a target-project `skills/explore/SKILL.md`, and a non-self-host dispatch whose engine harness root cannot be resolved (`resolveHarnessRoot()` returns `null`) renders the directory name, as asserted in `daemon-cli-skill-name-root.test.ts` and `step-runners-skill-name.test.ts`." | diff-local |
| Story 2 happy: Given a non-self-host dispatch whose engine harness root declares `name: ac-explore` while the target project has no `skills/` tree, when the explore step is dispatched, then the invocation names `ac-explore`. | 2 | "Every `DefaultStepRunner` construction in `runDaemonMode` gives a self-host dispatch the feature worktree as `skillNameRoot`, so it renders the worktree's `ac-explore` and never the engine harness root's `explore`; a non-self-host dispatch whose engine harness root declares `ac-explore` renders `ac-explore` and ignores a target-project `skills/explore/SKILL.md`, and a non-self-host dispatch whose engine harness root cannot be resolved (`resolveHarnessRoot()` returns `null`) renders the directory name, as asserted in `daemon-cli-skill-name-root.test.ts` and `step-runners-skill-name.test.ts`." | diff-local |
| Story 2 negative: Given a self-host dispatch whose worktree and engine harness root declare different names for the same skill, when the step is dispatched, then the engine harness root's name does not appear in the invocation. | 2 | "Every `DefaultStepRunner` construction in `runDaemonMode` gives a self-host dispatch the feature worktree as `skillNameRoot`, so it renders the worktree's `ac-explore` and never the engine harness root's `explore`; a non-self-host dispatch whose engine harness root declares `ac-explore` renders `ac-explore` and ignores a target-project `skills/explore/SKILL.md`, and a non-self-host dispatch whose engine harness root cannot be resolved (`resolveHarnessRoot()` returns `null`) renders the directory name, as asserted in `daemon-cli-skill-name-root.test.ts` and `step-runners-skill-name.test.ts`." | diff-local |
| Story 2 negative: Given a non-self-host dispatch whose target project contains a `skills/explore/SKILL.md` declaring a different name, when the built-in explore step is dispatched, then the invocation uses the engine harness root's name and ignores the project's file. | 2 | "Every `DefaultStepRunner` construction in `runDaemonMode` gives a self-host dispatch the feature worktree as `skillNameRoot`, so it renders the worktree's `ac-explore` and never the engine harness root's `explore`; a non-self-host dispatch whose engine harness root declares `ac-explore` renders `ac-explore` and ignores a target-project `skills/explore/SKILL.md`, and a non-self-host dispatch whose engine harness root cannot be resolved (`resolveHarnessRoot()` returns `null`) renders the directory name, as asserted in `daemon-cli-skill-name-root.test.ts` and `step-runners-skill-name.test.ts`." | diff-local |
| Story 2 negative: Given a non-self-host dispatch where the engine harness root cannot be resolved, when a built-in step is dispatched, then the invocation uses the skill's directory name. | 2 | "Every `DefaultStepRunner` construction in `runDaemonMode` gives a self-host dispatch the feature worktree as `skillNameRoot`, so it renders the worktree's `ac-explore` and never the engine harness root's `explore`; a non-self-host dispatch whose engine harness root declares `ac-explore` renders `ac-explore` and ignores a target-project `skills/explore/SKILL.md`, and a non-self-host dispatch whose engine harness root cannot be resolved (`resolveHarnessRoot()` returns `null`) renders the directory name, as asserted in `daemon-cli-skill-name-root.test.ts` and `step-runners-skill-name.test.ts`." | diff-local |
| Story 3 happy: Given a renamed fixture catalog where `explore` declares `name: ac-explore`, when the Pi provider parses a prompt whose first token is `/skill:ac-explore`, then it resolves the explore skill. | 4 | "With a catalog keyed by frontmatter name, the Pi provider resolves the explore skill for a `/skill:ac-explore` first token and does not resolve it for a `/skill:explore` first token, as asserted in `pi-provider.test.ts`." | diff-local |
| Story 3 happy: Given the shipped skill tree, when the Pi provider parses the rendered build-step prompt, then the prompt is `/skill:pipeline` and it resolves the pipeline skill as before. | 4 | "With the shipped tree, the rendered Pi build-step prompt is `/skill:pipeline` and the Pi provider resolves it to the pipeline skill." | diff-local |
| Story 3 negative: Given a renamed fixture catalog where `explore` declares `name: ac-explore`, when the Pi provider parses a prompt whose first token is `/skill:explore`, then it does not resolve the explore skill. | 4 | "With a catalog keyed by frontmatter name, the Pi provider resolves the explore skill for a `/skill:ac-explore` first token and does not resolve it for a `/skill:explore` first token, as asserted in `pi-provider.test.ts`." | diff-local |
| Story 4 happy: Given a renamed fixture declaring `ac-composer`, `ac-daemon-triage`, `ac-bootstrap` and `ac-assess`, when the composer launcher, the monitor guided session and the project prelude start their skills, then they invoke `ac-composer`, `ac-daemon-triage`, `ac-bootstrap` and `ac-assess` respectively. | 5 | "With a renamed fixture, the composer launcher, the monitor guided session and the project prelude invoke `ac-composer`, `ac-daemon-triage`, `ac-bootstrap` and `ac-assess` respectively, as asserted in `engineer-cli-launch-host.test.ts`, `monitor/session.test.ts` and `project-prelude.test.ts`." | diff-local |
| Story 4 happy: Given the shipped skill tree with codex selected, when the composer launcher spawns, then the argv is exactly one positional prompt `$composer` as before. | 5 | "With the shipped tree and codex selected, the composer launcher's argv is exactly one positional prompt `$composer`." | diff-local |
| Story 4 negative: Given a renamed fixture declaring `ac-composer`, when the launcher refuses to nest inside a Claude or Codex session or reports a codex ENOENT failure, then the message names `/ac-composer` or `$ac-composer` and never `/composer` or `$composer`. | 5 | "With a renamed fixture declaring `ac-composer`, the launcher's nesting refusal inside a Claude or Codex session and its codex ENOENT message name `/ac-composer` or `$ac-composer` and contain neither `/composer` nor `$composer`." | diff-local |
| Story 5 happy: Given a renamed fixture where `daemon-triage` declares `name: ac-daemon-triage`, when a dispatched worktree's settings are written, then `skillOverrides` sets `ac-daemon-triage` to `off`. | 6 | "With a renamed `skillNameRoot`, a dispatched worktree's settings `skillOverrides` sets `ac-daemon-triage` to `off` and contains no `daemon-triage` key, as asserted in `worktree-prepare.test.ts`." | diff-local |
| Story 5 happy: Given an operator's existing `skillOverrides` entry for another skill, when the engine writes the worktree settings, then that entry is preserved unchanged. | 6 | "An operator's existing `skillOverrides` entry for another skill is preserved unchanged, and an operator entry setting the operator-only skill's name to `on` is written as `off`." | diff-local |
| Story 5 negative: Given a renamed fixture where `daemon-triage` declares `name: ac-daemon-triage`, when a dispatched worktree's settings are written, then `skillOverrides` has no `daemon-triage` key. | 6 | "With a renamed `skillNameRoot`, a dispatched worktree's settings `skillOverrides` sets `ac-daemon-triage` to `off` and contains no `daemon-triage` key, as asserted in `worktree-prepare.test.ts`." | diff-local |
| Story 5 negative: Given an operator's existing `skillOverrides` entry sets the operator-only skill's name to `on`, when the engine writes the worktree settings, then that entry is `off`. | 6 | "An operator's existing `skillOverrides` entry for another skill is preserved unchanged, and an operator entry setting the operator-only skill's name to `on` is written as `off`." | diff-local |
| Story 6 happy: Given a worktree renamed fixture, when the self-host provider home is prepared, then its skills catalog lists each skill under its frontmatter name and lists no operator-only skill. | 7 | "`provisionProviderHome` over a worktree renamed fixture produces a skills catalog listing each skill under its frontmatter name, with no operator-only skill and no entry named after a directory whose frontmatter name differs, as asserted in `provider-home.test.ts`." | diff-local |
| Story 6 happy: Given a provider whose self-host shape links `.agents/skills`, when the provider home is prepared, then `.agents/skills` lists the same entries as the skills catalog. | 7 | "For a provider whose self-host shape links `.agents/skills`, the `.agents/skills` listing equals the skills catalog listing." | diff-local |
| Story 6 happy: Given the Claude self-host sandbox over a worktree renamed fixture, when it is provisioned, then it exposes each worktree skill under its frontmatter name as a link resolving to that worktree's `skills/<dir>`. | 8 | "Provisioning the Claude self-host sandbox over a worktree renamed fixture creates a `skills/` directory with one link per worktree skill, named by its frontmatter name and resolving to that worktree's `skills/<dir>`, as asserted in `sandbox-build-env.test.ts`." | diff-local |
| Story 6 happy: Given a provider home prepared over a worktree renamed fixture, when the live-tier preflight checks the built-in step commands, then it finds each step's skill under its frontmatter name and reports no missing command. | 7 | "`assertStepCommandsResolve` given a renamed source tree finds every built-in step's skill in the provider home under its frontmatter name and reports no missing command, and when the home lacks the `ac-pipeline` entry it fails before any dispatch naming `ac-pipeline`, as asserted in `step-command-preflight.test.ts`." | diff-local |
| Story 6 negative: Given a worktree renamed fixture, when the self-host provider home is prepared, then no entry is named after a skill directory whose frontmatter name differs from it. | 7 | "`provisionProviderHome` over a worktree renamed fixture produces a skills catalog listing each skill under its frontmatter name, with no operator-only skill and no entry named after a directory whose frontmatter name differs, as asserted in `provider-home.test.ts`." | diff-local |
| Story 6 negative: Given the operator-only `daemon-triage` skill declaring `name: ac-daemon-triage`, when the provider home is prepared, then neither `ac-daemon-triage` nor `daemon-triage` exists in its catalog. | 7 | "With `daemon-triage` declaring `name: ac-daemon-triage`, neither `ac-daemon-triage` nor `daemon-triage` exists in the prepared catalog." | diff-local |
| Story 6 negative: Given a provider home over a renamed fixture that lacks the skill whose frontmatter name is `ac-pipeline`, when the live-tier preflight runs, then it fails before any dispatch naming `ac-pipeline`. | 7 | "`assertStepCommandsResolve` given a renamed source tree finds every built-in step's skill in the provider home under its frontmatter name and reports no missing command, and when the home lacks the `ac-pipeline` entry it fails before any dispatch naming `ac-pipeline`, as asserted in `step-command-preflight.test.ts`." | diff-local |
| Story 7 happy: Given a renamed harness tree and catalogs holding a link under each skill's frontmatter name, when `bin/install --check` runs, then it exits 0 and install-freshness reports the install fresh. | 10 | "Over a renamed checkout whose catalogs hold frontmatter-named links, `bin/install --check` exits 0, and install-freshness maps that exit to fresh, as asserted in `test_install_skill_names.sh` and `install-freshness.test.ts`." | diff-local |
| Story 7 negative: Given a renamed harness tree and catalogs holding only directory-named links, when `bin/install --check` runs, then it reports every missing frontmatter-named link by name and exits non-zero, and install-freshness reports the install stale. | 10 | "With only directory-named links, `bin/install --check` reports every missing frontmatter-named link by name and exits non-zero, and install-freshness maps that exit to stale." | diff-local |
| Story 7 negative: Given one catalog missing only the link for the skill named `ac-plan`, when `bin/install --check` runs, then it reports `ac-plan` missing for that catalog and exits non-zero. | 10 | "With one catalog missing only the `ac-plan` link, `bin/install --check` reports `ac-plan` missing for that catalog and exits non-zero." | diff-local |
| Story 8 happy: Given a checkout whose `skills/plan/SKILL.md` declares `name: ac-plan`, when `bin/install` runs against empty catalogs, then `~/.claude/skills/ac-plan` and `~/.agents/skills/ac-plan` resolve to that checkout's `skills/plan`. | 9 | "In `test/test_install_skill_names.sh`, with `skills/plan/SKILL.md` declaring `name: ac-plan`, `bin/install` against empty catalogs leaves `~/.claude/skills/ac-plan` and `~/.agents/skills/ac-plan` resolving to that checkout's `skills/plan`." | diff-local |
| Story 8 happy: Given the shipped checkout, when `bin/install` runs against empty catalogs, then both catalogs hold exactly the same link names and targets as before this change. | 9 | "With the shipped checkout, both catalogs hold exactly the same link names and targets as the listing captured from the pre-change installer." | diff-local |
| Story 8 negative: Given a `SKILL.md` with no `name:` key, when `bin/install` runs, then that skill is linked under its directory name. | 9 | "A `SKILL.md` with no `name:` key is linked under its directory name." | diff-local |
| Story 8 negative: Given catalogs holding a renamed checkout's frontmatter-named harness links and a foreign skill entry, when `bin/install --uninstall` runs, then every frontmatter-named harness link is removed and the foreign entry remains unchanged. | 10 | "`bin/install --uninstall` over catalogs holding a renamed checkout's frontmatter-named harness links and a foreign skill entry removes every frontmatter-named harness link and leaves the foreign entry unchanged." | diff-local |
| Story 8 negative: Given a `SKILL.md` whose frontmatter block is never closed, when `bin/install` runs, then it reports that file by path, links no entry for it, and exits with status 1. | 9 | "A `SKILL.md` whose frontmatter block is never closed is reported by path, no entry is linked for it, and `bin/install` exits with status 1." | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work beyond its focused scope
- [x] Every task has a `Done when:` block of 2-5 falsifiable checks
- [x] Dependencies are explicit and acyclic
- [x] Plan review sweeps cross-task fixture interference at Medium tier
