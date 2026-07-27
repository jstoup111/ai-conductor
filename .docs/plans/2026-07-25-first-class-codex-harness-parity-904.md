# Implementation Plan: First-Class Codex Harness Skills and Guidance (#904)

**Date:** 2026-07-25
**Design:** `.docs/specs/2026-07-25-first-class-codex-harness-parity-904.md`
**Architecture:** `.docs/decisions/adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation.md`
**Stories:** `.docs/stories/first-class-codex-harness-parity-904.md`
**Conflict check:** Clean as of 2026-07-25
**Complexity:** Medium — `.docs/complexity/2026-07-25-first-class-codex-harness-parity-904.md`

## Summary

This plan delivers #904 in 29 short TDD tasks across four independently testable seams: daemon
invocation first, installer/migration, durable/shared guidance, and final direct/Claude parity.
The task count is above the 20-task warning threshold (roughly 1–2.5 hours at the required 2–5
minute granularity), but it is not architectural expansion: 19 tasks are focused negative-path or
compatibility proofs around three small production changes.

## Technical Approach

- Keep lifecycle intent typed. A new pure `skill-invocation` module owns the exhaustive
  `StepName` → skill/arguments map and renders `/skill` for Claude, `$skill` for Codex, and the
  existing slash-compatible form for unknown providers. Engine-native sentinels remain explicit.
- Extend `executeProviderCandidates` with an optional candidate-local invocation-options factory.
  The loop resolves that factory immediately before each actual candidate and keeps static options
  for free-form/auxiliary callers. `DefaultStepRunner` supplies the factory only for skill-driven
  dispatch, including complexity, remediation, and rebase one-shots.
- Correct the Codex user discovery root to `~/.agents/skills`. Installer reconciliation is
  ownership-safe: exact current-harness symlinks may be refreshed/removed, while foreign links,
  files, and directories are preserved and reported. Recognized legacy `~/.codex/skills` links are
  migration inputs, never a second active catalog.
- Keep `skills/` and `HARNESS.md` canonical. `HARNESS.md` defines provider-neutral skill-reference
  notation, explicit host invocation forms, subagent terminology, and the fail-closed unsupported
  capability diagnostic. Only genuinely host-specific imperatives in affected skills are scoped;
  existing frontmatter, Claude pins, artifacts, and gates remain intact.
- Extend existing Bash and Vitest suites; add no package, service, schema, config key, port, or
  persistent runtime state. Live Codex discovery/direct parity is a final verify-only task in a
  credentialed operator environment and does not absorb #905 authentication/sandbox work.

## Prerequisites

- The approved #927 candidate loop and provider-local runtime/session architecture are present on
  the branch base.
- `src/conductor` dependencies are installed for Vitest/typecheck runs.
- The final live probe needs a credentialed Codex CLI. If the local environment still lacks #905
  readiness, run that probe in an already-ready operator environment; do not implement auth,
  sandbox, or approval behavior in #904.
- Do not edit or test legacy `bin/conduct`.

## Tasks

### Task runtime-01: Define provider-native semantic skill invocation
**Story:** ST-904-9 HP-1; ST-904-13 HP-1
**Type:** happy-path

**Steps:**
1. Write failing table tests for every `StepName`, expecting its skill name, preserved arguments,
   Claude slash form, and Codex dollar-mention form.
2. Run the focused test and verify the module/import fails (RED).
3. Implement the typed invocation descriptor map and pure renderer in
   `skill-invocation.ts`; move the semantic data out of `STEP_PROMPTS`.
4. Run the focused test and typecheck (GREEN).
5. Commit with message: `feat(conductor): render provider-native skill invocations`.

**Files:** `src/conductor/src/engine/skill-invocation.ts`; `src/conductor/test/engine/skill-invocation.test.ts`; `src/conductor/src/engine/step-runners.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.run`

**Dependencies:** none

### Task runtime-02: Preserve arguments and reject accidental fabricated skills
**Story:** ST-904-9 HP-1, NP-1; ST-904-8 HP-1
**Type:** negative-path

**Steps:**
1. Add failing cases for `architecture_review_as_built --as-built`, conduct subcommands, and
   engine-native/non-dispatched sentinel steps.
2. Run the focused test and verify argument/sentinel assertions fail (RED).
3. Make descriptors explicit for arguments and engine-native sentinels; keep the map exhaustive so
   a new `StepName` cannot silently omit its contract.
4. Run the focused test and typecheck (GREEN).
5. Commit with message: `test(conductor): lock skill arguments and native sentinels`.

**Files:** `src/conductor/src/engine/skill-invocation.ts`; `src/conductor/test/engine/skill-invocation.test.ts`

**Wired-into:** same as Task runtime-01

**Dependencies:** runtime-01

### Task runtime-03: Add candidate-local invocation options to provider execution
**Story:** ST-904-9 HP-2
**Type:** infrastructure

**Steps:**
1. Add a failing provider-execution test whose options factory records the preferred candidate and
   returns a candidate-specific prompt.
2. Run the focused test and verify the callback is absent (RED).
3. Add the optional typed factory to `ExecuteProviderCandidatesInput` and resolve its options inside
   the candidate loop immediately before `invokeProviderCandidate`.
4. Run provider-execution tests and typecheck (GREEN).
5. Commit with message: `feat(conductor): resolve invocation options per provider candidate`.

**Files:** `src/conductor/src/engine/provider-execution.ts`; `src/conductor/test/engine/provider-execution.test.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.runProviderAwareNormal`

**Dependencies:** none

### Task runtime-04: Re-resolve prompts across both fallback directions
**Story:** ST-904-9 HP-2, NP-2; ST-904-13 NP-2
**Type:** negative-path

**Steps:**
1. Add failing candidate-loop cases for Codex→Claude, Claude→Codex, and cached-unavailable first
   candidates, asserting exact per-attempt prompts and callback order.
2. Run the focused cases and verify the static prompt leaks to fallback (RED).
3. Correct callback placement/arguments so every live or cached candidate obtains its own options
   without changing warning, model, effort, session, or attempt metadata.
4. Run the provider-execution and #927 acceptance suites (GREEN).
5. Commit with message: `fix(conductor): isolate skill syntax across provider fallback`.

**Files:** `src/conductor/src/engine/provider-execution.ts`; `src/conductor/test/engine/provider-execution.test.ts`; `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`

**Wired-into:** same as Task runtime-03

**Dependencies:** runtime-03

### Task runtime-05: Adapt scalar step-runner dispatch
**Story:** ST-904-9 HP-1; ST-904-13 HP-1
**Type:** happy-path

**Steps:**
1. Add failing scalar-runner tests asserting Claude receives `/stories` and Codex receives
   `$stories`, with the same system prompt, model, effort, cwd, and session fields.
2. Run the focused cases and observe Codex receives slash syntax (RED).
3. Resolve the prompt from the runner's actual provider key before scalar autonomous/interactive
   invocation.
4. Run step-runner tests and typecheck (GREEN).
5. Commit with message: `feat(conductor): adapt scalar skill prompts by provider`.

**Files:** `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/step-runners.test.ts`; `src/conductor/src/engine/skill-invocation.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.run`

**Dependencies:** runtime-01

### Task runtime-06: Wire provider-aware normal lifecycle dispatch
**Story:** ST-904-9 HP-1, NP-1
**Type:** happy-path

**Steps:**
1. Add a failing table-driven runner test over every normally dispatched Codex-eligible lifecycle
   step, including argument-bearing steps.
2. Run the matrix and verify provider-aware Codex attempts still receive slash prompts (RED).
3. Have `runProviderAwareNormal` pass a candidate-local options factory using the semantic step
   resolver while preserving all non-prompt options.
4. Run step-runner, provider-routing, and typecheck suites (GREEN).
5. Commit with message: `feat(conductor): wire native skill syntax into lifecycle dispatch`.

**Files:** `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/step-runners.test.ts`; `src/conductor/src/engine/skill-invocation.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.runProviderAwareNormal`

**Dependencies:** runtime-02, runtime-03, runtime-05

### Task runtime-07: Adapt skill-driven one-shot branches only
**Story:** ST-904-9 HP-1, NP-1; ST-904-13 HP-2
**Type:** negative-path

**Steps:**
1. Add failing Codex/Claude cases for complexity, remediation, and rebase, plus regression cases for
   setup-fix, CI-fix, attribution, and build-review free-form prompts.
2. Run the focused tests and observe skill one-shots use slash syntax (RED).
3. Allow `executeProviderAwareOneShot` callers to opt into semantic skill adaptation; wire only
   complexity, remediation, and rebase, leaving arbitrary prompts byte-identical.
4. Run all step-runner tests and typecheck (GREEN).
5. Commit with message: `feat(conductor): adapt provider-aware skill one-shots safely`.

**Files:** `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/step-runners.test.ts`; `src/conductor/src/engine/skill-invocation.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.executeProviderAwareOneShot`

**Dependencies:** runtime-02, runtime-03, runtime-06

### Task runtime-08: Prove unattended boundary progression remains gate-controlled
**Story:** ST-904-10 HP-1, HP-2, NP-1, NP-2; ST-904-12 HP-2
**Type:** negative-path

**Steps:**
1. Add failing #904 acceptance cases that run two consecutive mocked Codex lifecycle steps, inspect
   exact skill mentions, and exercise a missing-artifact completion result.
2. Run the acceptance file and verify Codex syntax/progression assertions fail (RED).
3. Apply only the minimal runner integration corrections needed for provider-native consecutive
   dispatch; do not change artifact predicates.
4. Run the #904 acceptance file plus conductor artifact/gate suites (GREEN).
5. Commit with message: `test(conductor): prove unattended Codex lifecycle progression`.

**Files:** `src/conductor/test/acceptance/first-class-codex-harness-parity-904.acceptance.test.ts`; `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/artifacts.acceptance-specs.test.ts`

**Wired-into:** same as Task runtime-06

**Dependencies:** runtime-07

### Task install-01: Install the complete catalog in Codex's current user scope
**Story:** ST-904-1 HP-1, HP-2; ST-904-2 HP-1
**Type:** happy-path

**Steps:**
1. Update/add a failing real-installer fixture expecting every source skill and `HARNESS.md` under
   `$HOME/.agents/skills`, with no plugin or manual-copy setup.
2. Run the focused Bash test and verify it fails on the old location (RED).
3. Change the active Codex discovery constant and install loop to the documented user scope while
   retaining the Claude surface and source symlinks.
4. Run the focused installer test and `bash -n bin/install` (GREEN).
5. Commit with message: `feat(install): use Codex standalone skill discovery scope`.

**Files:** `bin/install`; `test/test_codex_skill_installation.sh`; `test/test_install_provider_readiness.sh`

**Wired-into:** `bin/install#install`

**Dependencies:** none

### Task install-02: Refresh stale current harness targets and catalog membership
**Story:** ST-904-3 HP-1, HP-2
**Type:** happy-path

**Steps:**
1. Add failing old→current checkout fixtures with changed, added, and removed supported skills.
2. Run the focused test and verify stale/current-catalog assertions fail (RED).
3. Reconcile exact harness-owned current-scope links to current sources and remove obsolete
   harness-owned names without touching foreign entries.
4. Run the focused test and installer syntax check (GREEN).
5. Commit with message: `feat(install): converge Codex catalog on current revision`.

**Files:** `bin/install`; `test/test_codex_skill_installation.sh`

**Wired-into:** `bin/install#install`

**Dependencies:** install-01

### Task install-03: Make repeated install and update idempotent
**Story:** ST-904-4 HP-1, NP-2
**Type:** negative-path

**Steps:**
1. Add failing fixtures that run install/update repeatedly and snapshot targets, entry counts, and
   unrelated content after each run.
2. Run the focused test and observe any duplicate/target churn (RED).
3. Make current-target and already-current branches explicit no-ops with deterministic counts.
4. Run repeated-operation tests (GREEN).
5. Commit with message: `test(install): enforce idempotent Codex skill updates`.

**Files:** `bin/install`; `test/test_codex_skill_installation.sh`

**Wired-into:** same as Task install-01

**Dependencies:** install-02

### Task install-04: Migrate only harness-owned legacy Codex entries
**Story:** ST-904-4 HP-2, NP-1
**Type:** happy-path

**Steps:**
1. Add a failing fixture with exact current-harness links in both `~/.codex/skills` and
   `~/.agents/skills`, asserting one active result after update.
2. Run the focused test and observe duplicate discovery remains (RED).
3. Add a legacy-scope reconciliation pass that removes only exact harness-owned skill and
   `HARNESS.md` links after the current target is established.
4. Run migration/idempotency tests (GREEN).
5. Commit with message: `feat(install): reconcile legacy Codex harness links`.

**Files:** `bin/install`; `test/test_codex_skill_installation.sh`

**Wired-into:** `bin/install#install`

**Dependencies:** install-01

### Task install-05: Preserve foreign links, files, and directories
**Story:** ST-904-3 NP-2; ST-904-4 NP-2
**Type:** negative-path

**Steps:**
1. Add failing current/legacy fixtures for a foreign symlink, regular file, non-empty directory,
   and foreign `HARNESS.md`, recording before/after hashes and link targets.
2. Run the test and verify current overwrite/backup behavior violates preservation (RED).
3. Restrict Codex reconciliation to exact ownership proof; preserve and warn for every other entry
   without moving it to `.bak`.
4. Run the focused negative matrix (GREEN).
5. Commit with message: `fix(install): preserve operator-owned Codex skill content`.

**Files:** `bin/install`; `test/test_codex_skill_installation.sh`

**Wired-into:** `bin/install#install`

**Dependencies:** install-04

### Task install-06: Report missing, broken, stale, and duplicate Codex discovery
**Story:** ST-904-1 NP-1, NP-2; ST-904-3 NP-1; ST-904-4 NP-1
**Type:** negative-path

**Steps:**
1. Add failing `--check` fixtures for absent skills, broken links, stale harness-owned targets,
   non-symlink entries, and active+legacy duplicates.
2. Run the focused test and verify diagnostics/exit statuses are incomplete (RED).
3. Extend check mode to name the affected skill and location, count stale/duplicate results as
   failure, and preserve the existing selected-provider CLI readiness matrix.
4. Run the focused test and provider-readiness suite (GREEN).
5. Commit with message: `feat(install): diagnose Codex catalog drift and duplication`.

**Files:** `bin/install`; `test/test_codex_skill_installation.sh`; `test/test_install_provider_readiness.sh`

**Wired-into:** `bin/install#check_installation`

**Dependencies:** install-02, install-04, install-05

### Task install-07: Uninstall current and legacy links without claiming foreign content
**Story:** ST-904-3 NP-2; ST-904-4 HP-2
**Type:** negative-path

**Steps:**
1. Add failing uninstall fixtures containing owned and foreign entries in active and legacy scopes.
2. Run the test and verify owned legacy links remain or foreign links are at risk (RED).
3. Remove only exact harness-owned links from both scopes and warn/preserve every other entry.
4. Run install→update→uninstall and preservation matrices (GREEN).
5. Commit with message: `fix(install): make Codex uninstall ownership-safe`.

**Files:** `bin/install`; `test/test_codex_skill_installation.sh`; `test/test_install_worktree_guard.sh`

**Wired-into:** `bin/install#uninstall`

**Dependencies:** install-06

### Task install-08: Preserve provider selection and worktree refusal contracts
**Story:** ST-904-2 NP-2; ST-904-13 HP-1
**Type:** negative-path

**Steps:**
1. Update failing #901/worktree fixtures to assert `.agents/skills` for every provider selection and
   unchanged active/legacy Codex state on worktree refusal.
2. Run both existing suites and confirm stale path expectations fail (RED).
3. Adjust only test/install output and path enumeration needed for the new surface; retain CLI
   selection, advisory readiness, guard ordering, and Claude behavior.
4. Run both full Bash suites and `bash -n` (GREEN).
5. Commit with message: `test(install): preserve readiness and worktree guards for Codex skills`.

**Files:** `bin/install`; `test/test_install_provider_readiness.sh`; `test/test_install_worktree_guard.sh`; `test/test_codex_skill_installation.sh`

**Wired-into:** `bin/install#install, bin/install#guard_worktree_root`

**Dependencies:** install-01, install-07

### Task install-09: Preserve the self-host release and migration contract
**Story:** ST-904-4 HP-2; ST-904-13 HP-1, NP-1
**Type:** infrastructure

**Steps:**
1. Add a failing focused assertion that the current `[Unreleased]` Codex installation entry names
   `~/.agents/skills`, rejects `~/.codex/skills` as the active target, and retains a runnable
   `bash migration` block that invokes `bin/install --update`.
2. Run the focused installer/release-contract assertion and verify the stale active path fails
   (RED).
3. Correct only the existing Codex install/migration release entry so `bin/migrate` communicates
   and executes the ownership-safe current-scope reconciliation; do not add a general README/docs
   workstream or use a release waiver for this consumer-visible change.
4. Run the focused assertion, self-host release-gate/version-signal tests, `bin/migrate` syntax,
   and harness integrity (GREEN); record the actual version signal for finish-time operator
   approval without editing `VERSION` in BUILD.
5. Commit with message: `docs(release): migrate Codex skills to current discovery scope`.

**Files:** `CHANGELOG.md`; `test/test_codex_skill_installation.sh`

**Wired-into:** `bin/migrate#extract_migration_blocks, src/conductor/src/engine/self-host/release-gate.ts#runReleaseArtifactGate`

**Dependencies:** install-08

### Task guidance-01: Generate current durable Codex guidance
**Story:** ST-904-5 HP-1
**Type:** happy-path

**Steps:**
1. Add a failing fixture that inspects fresh `AGENTS.md` guidance for the current harness reference
   and rejects the legacy discovery path.
2. Run the focused guidance test and verify it fails (RED).
3. Correct the AGENTS template and bootstrap's fresh-project contract to reference the documented
   Codex scope and shared harness instructions.
4. Run the focused test and harness integrity suite (GREEN).
5. Commit with message: `feat(bootstrap): generate current Codex harness guidance`.

**Files:** `templates/AGENTS.md.template`; `skills/bootstrap/SKILL.md`; `test/test_codex_guidance_contract.sh`

**Wired-into:** `skills/bootstrap/SKILL.md#repository-guidance-step`

**Dependencies:** none

### Task guidance-02: Preserve and idempotently append existing AGENTS content
**Story:** ST-904-5 HP-2, NP-1, NP-2
**Type:** negative-path

**Steps:**
1. Add failing existing-content, repeated-run, and failed-write guidance fixtures with exact
   before/after assertions.
2. Run the focused test and verify preservation/idempotency contracts are absent (RED).
3. Make bootstrap instructions require create-or-append behavior, one reference, atomic/no-partial
   failure, and an actionable file-named diagnostic.
4. Run the focused guidance and integrity tests (GREEN).
5. Commit with message: `fix(bootstrap): preserve existing Codex repository guidance`.

**Files:** `skills/bootstrap/SKILL.md`; `templates/AGENTS.md.template`; `test/test_codex_guidance_contract.sh`

**Wired-into:** same as Task guidance-01

**Dependencies:** guidance-01

### Task guidance-03: Keep Claude and Codex project guidance non-contradictory
**Story:** ST-904-6 HP-1, HP-2, NP-1, NP-2
**Type:** negative-path

**Steps:**
1. Add failing mixed-provider fixtures that compare both templates/references, inject a host-syntax
   contradiction, and cover one-present/one-missing guidance.
2. Run the focused test and verify contradiction detection/partial refresh fails (RED).
3. Scope each host's invocation instructions while pointing both files at the same workflow/gate
   contract and preserving independent operator content.
4. Run mixed guidance and integrity tests (GREEN).
5. Commit with message: `test(bootstrap): enforce mixed-provider guidance consistency`.

**Files:** `templates/AGENTS.md.template`; `templates/CLAUDE.md.template`; `skills/bootstrap/SKILL.md`; `test/test_codex_guidance_contract.sh`

**Wired-into:** `skills/bootstrap/SKILL.md#repository-guidance-step`

**Dependencies:** guidance-02

### Task contracts-01: Define shared host invocation and unsupported-capability rules
**Story:** ST-904-7 HP-1, HP-2; ST-904-11 HP-2; ST-904-12 HP-1, HP-2, NP-1, NP-2
**Type:** infrastructure

**Steps:**
1. Add failing integrity fixtures requiring semantic skill-reference notation, native `/` and `$`
   invocation mapping, shared gate invariance, and the provider/capability/recovery diagnostic.
2. Run the focused integrity fixture and verify the contract is missing (RED).
3. Add provider-neutral rules to `HARNESS.md`, including fail-closed behavior before incompatible
   work and explicit handling for supported-but-different capabilities.
4. Regenerate/check the model table if the generated region is touched and run integrity tests
   (GREEN).
5. Commit with message: `feat(harness): define shared Claude and Codex host contracts`.

**Files:** `HARNESS.md`; `test/test_harness_integrity.sh`; `test/test_provider_skill_contracts.sh`

**Wired-into:** `bin/install#install, skills/bootstrap/SKILL.md#repository-guidance-step`

**Dependencies:** none

### Task contracts-02: Scope bootstrap, conduct, and engineer host behavior
**Story:** ST-904-7 HP-2; ST-904-8 HP-1, NP-1, NP-2
**Type:** negative-path

**Steps:**
1. Add failing provider-contract cases for legacy Codex paths, Claude-only launcher/session claims,
   `/quit`, and host-specific interactive instructions in the three skills.
2. Run the focused audit and verify it identifies unscoped imperatives (RED).
3. Rewrite common behavior provider-neutrally and explicitly scope true Claude/Codex differences;
   keep native persistent-session launching deferred to #759 and leave `bin/conduct` untouched.
4. Run provider-contract and harness-integrity tests (GREEN).
5. Commit with message: `fix(skills): scope bootstrap and control-plane host behavior`.

**Files:** `skills/bootstrap/SKILL.md`; `skills/conduct/SKILL.md`; `skills/engineer/SKILL.md`; `test/test_provider_skill_contracts.sh`

**Wired-into:** `bin/install#install`

**Dependencies:** contracts-01, guidance-01

### Task contracts-03: Make review and assessment delegation host-native
**Story:** ST-904-7 HP-2; ST-904-8 HP-1, NP-1, NP-2
**Type:** negative-path

**Steps:**
1. Add failing contract fixtures for unscoped `Agent tool`, Claude model names, and delegation
   requirements in assess, architecture-review, and code-review.
2. Run the audit and verify it fails on the current host assumptions (RED).
3. Express delegation through the selected host's available subagent facility, scope Claude model
   choices, and preserve agent limits, fresh-context review, outputs, veto/gate behavior, and the
   merged #946 `BATCH_AFFECTED_TESTS` evaluator-input contract without restating that policy.
4. Run provider-contract, model-pin, pipeline-policy-contract, and harness-integrity tests (GREEN).
5. Commit with message: `fix(skills): make review delegation provider-scoped`.

**Files:** `skills/assess/SKILL.md`; `skills/architecture-review/SKILL.md`; `skills/code-review/SKILL.md`; `test/test_provider_skill_contracts.sh`; `test/test_skill_pipeline_contract.sh`; `test/test_harness_integrity.sh`

**Wired-into:** `bin/install#install`

**Dependencies:** contracts-01

### Task contracts-04: Make build-cycle delegation host-native
**Story:** ST-904-7 HP-2; ST-904-8 HP-1, NP-1, NP-2
**Type:** negative-path

**Steps:**
1. Add failing contract fixtures for Claude Task/Agent tools, hardcoded model identities, and
   provider-specific subagent instructions in pipeline and TDD.
2. Run the focused audit and verify the current instructions fail (RED).
3. Introduce provider-neutral dispatch wording with explicitly scoped host mechanics while
   preserving RED/DOMAIN/GREEN, commit, review, rework-budget, evidence gates, and #946's rule
   that batch verification and its evaluator share one named `BATCH_AFFECTED_TESTS` union with a
   full-suite fallback only when scope is indeterminate.
4. Run provider-contract, TDD/pipeline policy-contract, and integrity tests (GREEN).
5. Commit with message: `fix(skills): preserve build gates across host delegation`.

**Files:** `skills/pipeline/SKILL.md`; `skills/tdd/SKILL.md`; `test/test_provider_skill_contracts.sh`; `test/test_skill_pipeline_contract.sh`; `test/test_harness_integrity.sh`

**Wired-into:** `bin/install#install`

**Dependencies:** contracts-01

### Task contracts-05: Scope finish and retrospective delegation
**Story:** ST-904-7 HP-2; ST-904-8 HP-1, NP-1, NP-2
**Type:** negative-path

**Steps:**
1. Add failing contract fixtures for host-only subagent/model/interaction wording in finish and
   retro.
2. Run the audit and observe unscoped host assumptions (RED).
3. Use host-neutral delegation/interaction terms and explicit provider scopes without changing
   finish choices, verification requirements, retro outputs, or memory follow-ups.
4. Run provider-contract and harness-integrity tests (GREEN).
5. Commit with message: `fix(skills): scope finish and retro host mechanics`.

**Files:** `skills/finish/SKILL.md`; `skills/retro/SKILL.md`; `test/test_provider_skill_contracts.sh`

**Wired-into:** `bin/install#install`

**Dependencies:** contracts-01

### Task contracts-06: Enforce deterministic provider-contract boundaries
**Story:** ST-904-7 NP-1, NP-2; ST-904-8 HP-1, NP-1, NP-2; ST-904-13 NP-1
**Type:** negative-path

**Steps:**
1. Add failing fixtures for each high-risk category: invocation, model, tool, delegation,
   interaction, unbalanced host scope, and a shared gate removed inside a compatibility edit.
2. Run the contract suite and verify each fixture fails for the intended reason (RED).
3. Complete the scoped audit/checker with balanced host markers, narrow imperative rules, the
   semantic slash-reference legend, and preservation of current frontmatter/reference/model checks.
4. Run all positive/negative fixtures, generated model check, and harness integrity (GREEN).
5. Commit with message: `test(harness): enforce provider-compatible shared skills`.

**Files:** `test/test_provider_skill_contracts.sh`; `test/test_harness_integrity.sh`; `HARNESS.md`; `skills/assess/SKILL.md`; `skills/architecture-review/SKILL.md`; `skills/bootstrap/SKILL.md`; `skills/code-review/SKILL.md`; `skills/conduct/SKILL.md`; `skills/engineer/SKILL.md`; `skills/finish/SKILL.md`; `skills/pipeline/SKILL.md`; `skills/retro/SKILL.md`; `skills/tdd/SKILL.md`

**Wired-into:** `test/test_harness_integrity.sh#provider_contract_checks`

**Dependencies:** contracts-02, contracts-03, contracts-04, contracts-05

### Task contracts-07: Make install-freshness diagnostics provider-complete
**Story:** ST-904-8 HP-1; ST-904-13 HP-2
**Type:** negative-path

**Steps:**
1. Add failing install-freshness assertions for both active discovery locations and native rebase
   invocation examples without changing stale-install control flow.
2. Run the focused test and verify the diagnostic is Claude-only (RED).
3. Update diagnostics/comments to name Claude and Codex surfaces and host-native skill mentions;
   preserve prompt, daemon failure, relink, and worktree-root behavior.
4. Run install-freshness/self-host tests and typecheck (GREEN).
5. Commit with message: `fix(conductor): report provider-complete skill installation drift`.

**Files:** `src/conductor/src/engine/install-freshness.ts`; `src/conductor/test/engine/install-freshness.test.ts`; `src/conductor/test/engine/self-host/relink-smoke.test.ts`

**Wired-into:** `src/conductor/src/engine/install-freshness.ts#ensureInstallFresh`

**Dependencies:** install-01, contracts-01

### Task verify-01: Prove direct Codex discovery and workflow parity
**Story:** ST-904-1 HP-1, HP-2; ST-904-2 HP-1, NP-1; ST-904-11 HP-1, HP-2, NP-1, NP-2
**Type:** happy-path

**Steps:**
1. Run the real installer against an isolated user scope or sanctioned installed main checkout and
   launch a credentialed Codex session with no plugin/preamble.
2. Verify Codex enumerates the complete catalog once and loads one representative skill plus linked
   resource.
3. Invoke that skill directly and through the daemon test harness; compare required artifacts and
   gate evidence while allowing host-native wording.
4. Run a deliberately incomplete direct invocation fixture and verify the same gate rejects it.
5. Record an evidence-only commit with `Task: verify-01` and the live result; do not add auth or
   sandbox code if the environment is not ready.

**Files:** none

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** install-09, guidance-03, contracts-06, runtime-08

### Task verify-02: Run full Claude, Codex, installer, and routing regression evidence
**Story:** ST-904-13 HP-1, HP-2, NP-1, NP-2; all stories regression closure
**Type:** refactor

**Steps:**
1. Run Bash syntax, Codex installer/guidance/provider-contract suites, and the complete harness
   integrity suite.
2. Run focused invocation, provider-execution, step-runner, install-freshness, #902, #927, and #904
   Vitest suites.
3. Run `npm run typecheck` and the full conductor test suite.
4. Verify no diff touches `bin/conduct`, no Claude prompt/model/session contract regressed, and no
   current or legacy test expectation still treats `~/.codex/skills` as active.
5. Record an evidence-only commit with `Task: verify-02` and exact passing commands.

**Files:** none

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** runtime-08, install-09, guidance-03, contracts-07, verify-01

## Task Dependency Graph

```text
Daemon-first runtime:
runtime-01 → runtime-02 → runtime-05 → runtime-06 → runtime-07 → runtime-08
                   runtime-03 → runtime-04 ────────┘
                         └──────────────→ runtime-06

Installer:
install-01 → install-02 → install-03
     └─────→ install-04 → install-05 → install-06 → install-07 → install-08 → install-09
                    install-02 ────────────┘

Guidance and shared contracts:
guidance-01 → guidance-02 → guidance-03
contracts-01 → contracts-02 ─┐
             → contracts-03 ─┤
             → contracts-04 ─┼→ contracts-06
             → contracts-05 ─┘
install-01 + contracts-01 → contracts-07

Final evidence:
runtime-08 + install-09 + guidance-03 + contracts-06 → verify-01
runtime-08 + install-09 + guidance-03 + contracts-07 + verify-01 → verify-02
```

## Integration Points

- After `runtime-08`: daemon-selected Codex can cross skill-driven lifecycle boundaries with
  candidate-local syntax while existing artifact gates remain authoritative.
- After `install-09`: normal install/update/check/uninstall exposes one current Codex catalog,
  preserves foreign/current/legacy operator content, and carries the executable self-host
  migration/release evidence required for the discovery-scope change.
- After `guidance-03` + `contracts-06`: direct Claude and Codex sessions share one workflow source
  with explicit host mechanics and deterministic drift checks.
- After `verify-02`: all four seams are proven together without changing legacy `bin/conduct`,
  #905 auth/sandbox behavior, #906 usage accounting, or #759 session launching.

## Acceptance-Criterion Coverage

| Story criterion | Task(s) |
|---|---|
| ST-904-1 HP-1 | install-01, verify-01 |
| ST-904-1 HP-2 | install-01, verify-01 |
| ST-904-1 NP-1 | install-06 |
| ST-904-1 NP-2 | install-06 |
| ST-904-2 HP-1 | install-01, verify-01 |
| ST-904-2 NP-1 | verify-01 |
| ST-904-2 NP-2 | install-08 |
| ST-904-3 HP-1 | install-02 |
| ST-904-3 HP-2 | install-02 |
| ST-904-3 NP-1 | install-06 |
| ST-904-3 NP-2 | install-05, install-07 |
| ST-904-4 HP-1 | install-03 |
| ST-904-4 HP-2 | install-04, install-07, install-09 |
| ST-904-4 NP-1 | install-04, install-06 |
| ST-904-4 NP-2 | install-03, install-05 |
| ST-904-5 HP-1 | guidance-01 |
| ST-904-5 HP-2 | guidance-02 |
| ST-904-5 NP-1 | guidance-02 |
| ST-904-5 NP-2 | guidance-02 |
| ST-904-6 HP-1 | guidance-03 |
| ST-904-6 HP-2 | guidance-03 |
| ST-904-6 NP-1 | guidance-03 |
| ST-904-6 NP-2 | guidance-03 |
| ST-904-7 HP-1 | contracts-01 |
| ST-904-7 HP-2 | contracts-01, contracts-02, contracts-03, contracts-04, contracts-05 |
| ST-904-7 NP-1 | contracts-06 |
| ST-904-7 NP-2 | contracts-06 |
| ST-904-8 HP-1 | runtime-02, contracts-02, contracts-03, contracts-04, contracts-05, contracts-06, contracts-07 |
| ST-904-8 NP-1 | contracts-02, contracts-03, contracts-04, contracts-05, contracts-06 |
| ST-904-8 NP-2 | contracts-02, contracts-03, contracts-04, contracts-05, contracts-06 |
| ST-904-9 HP-1 | runtime-01, runtime-06, runtime-07 |
| ST-904-9 HP-2 | runtime-03, runtime-04 |
| ST-904-9 NP-1 | runtime-02, runtime-06, runtime-07 |
| ST-904-9 NP-2 | runtime-04 |
| ST-904-10 HP-1 | runtime-08 |
| ST-904-10 HP-2 | runtime-08 |
| ST-904-10 NP-1 | runtime-08 |
| ST-904-10 NP-2 | runtime-08 |
| ST-904-11 HP-1 | verify-01 |
| ST-904-11 HP-2 | contracts-01, verify-01 |
| ST-904-11 NP-1 | verify-01 |
| ST-904-11 NP-2 | verify-01 |
| ST-904-12 HP-1 | contracts-01 |
| ST-904-12 HP-2 | contracts-01, runtime-08 |
| ST-904-12 NP-1 | contracts-01, contracts-06 |
| ST-904-12 NP-2 | contracts-01, contracts-06 |
| ST-904-13 HP-1 | runtime-01, runtime-05, install-08, verify-02 |
| ST-904-13 HP-2 | runtime-07, contracts-07, verify-02 |
| ST-904-13 NP-1 | contracts-06, verify-02 |
| ST-904-13 NP-2 | runtime-04, verify-02 |

## Verification

- [x] Preconditions validated: Accepted stories have happy/negative paths and conflict-check is clean.
- [x] Every happy and negative criterion maps to at least one task.
- [x] Negative paths have explicit focused tasks rather than a generic cleanup task.
- [x] Tasks are scoped to 2–5 minute RED→GREEN increments; 29 tasks trigger the documented warning
      but remain below the 41-task hard stop.
- [x] Dependencies are explicit and acyclic.
- [x] Every new production surface derives a `Wired-into:` contract from the approved architecture.
- [x] Ordinary project documentation is absent from the task list.
- [x] Legacy `bin/conduct`, #905, #906, and #759 implementation are excluded.
