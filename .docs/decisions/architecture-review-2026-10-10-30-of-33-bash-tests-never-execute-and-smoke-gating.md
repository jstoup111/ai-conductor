# Architecture Review: Every bash test executes in CI or is removed
**Date:** 2026-10-10
**Mode:** Lightweight (Tier M), pre-stories. Sections: Feasibility, Alignment, Wiring Surface, Risks.
**Inputs:** `.docs/track/30-of-33-bash-tests-never-execute-and-smoke-gating.md`,
`.docs/complexity/30-of-33-bash-tests-never-execute-and-smoke-gating.md`,
`.docs/architecture/30-of-33-bash-tests-never-execute-and-smoke-gating.md` (intake #1021)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility.** The design needs nothing new. It uses bash, GitHub Actions on
  `ubuntu-latest`, and the existing Vitest suite. The integrity job already installs `shellcheck`
  and `ripgrep` (`.github/workflows/ci.yml` apt step). The new job needs the same apt step, because
  `test_bin_migrate_approval.sh`, `test_bin_migrate_multi_version_jump.sh` and others skip silently
  without `rg` (`bin/install` comment, verified 95%).
- **Prerequisites.** Each orphan needs a one-time triage. At authoring, 67 `test/*.sh` scripts
  exist, and about 30 are executed by CI or `test_harness_integrity.sh`. That count came from a
  reference sweep of every script name across `.github/`, `test/`, `bin/` and `src/conductor/`,
  confirmed against the integrity script's `bash "…"` invocations. Confidence that the orphan set
  is roughly 37 is 85%. A few scripts are invoked only by an orphan runner
  (`run_examples_acceptance_specs.sh`, `run_first_class_codex_harness_parity_904_acceptance.sh`,
  `run_browsable_documentation_site_acceptance.sh`), which makes them transitive orphans. Pass/fail
  state is **unverified**: the scripts were deliberately not run during DECIDE because installer
  tests may write `$HOME`. Some are self-described RED-phase specs whose expected failures may be
  stale (`test_rtk_hook_reinit.sh` header). The triage must record pass/fail evidence for each one.
- **Integration surface.** The feature touches `test/`, `.github/workflows/ci.yml`,
  `test/test_harness_integrity.sh`, and one Vitest structural test. The only engine source change
  exports the smoke declaration parser from `src/engine/smoke-runner.ts`. Its runtime behavior is
  unchanged.
- **Data implications.** None. No schema, state file or event change.
- **Performance risk.** The new CI job's wall time is the sum of the kept scripts' runtimes, and
  some installer scripts invoke the real `bin/install`. Condition C6 bounds it.
- **Worktree isolation.** Satisfied by design. The per-script sandbox gives each run its own
  `HOME`, `TMPDIR`, `XDG_*` directories and global git config, so two worktrees or two scripts
  never share operator state. 65 of the 67 scripts already reference `HOME=` or `mktemp`. Two
  (`test_bin_migrate_blocks.sh`, `test_rtk_hook_reinit.sh`) show neither, though the latter
  documents a throwaway `$HOME` through `test_helpers.sh`. The runner-level sandbox is the
  backstop either way.

## Alignment

- **Governing ADRs.** No APPROVED ADR covers shell-test execution, and this design takes no
  structural decision: it adds a test tier inside existing CI. The smoke ADRs
  (`adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`,
  `adr-2026-08-12-per-provider-live-smoke-legs`) define the closed `smokeCapability` model. This
  feature only asserts declarations already required by that model, and changes neither the union
  nor the runner semantics. `adr-2026-09-28-skills-may-bundle-executable-helpers` D6 keeps
  `test/lint_shell.sh` as the shell-validation enumerator. This feature does not alter it.
- **Pattern consistency.** The integrity check follows the existing numbered-check pattern,
  catalogued in `docs/contributing/validation.md`. The CI job follows the existing job shape,
  including the `changes` docs-only skip and registration in `ci-gate`.
- **Smoke guard placement (operator-confirmed).** The `smokeCapability` assertion lives in
  `src/conductor/test/structural/test-execution-policy.test.ts`. That test already proves, through
  real Vitest discovery, that the default suite excludes smoke files. The assertion reuses the
  declaration parser in `src/engine/smoke-runner.ts` (`parseSmokeCapabilityDeclaration`, currently
  module-private), so there is exactly one grammar for the declaration.
- **Single source of truth for classification (condition C1).** The design draws the "invoked by
  integrity" class as an inferred category. Inferring it by matching strings against
  `test_harness_integrity.sh` is the over-mechanization the Design Principles warn about. Every
  script's class is therefore declared explicitly in the committed manifest. The guard verifies
  each declaration mechanically, so the classification itself is never inferred.
- **State.** Each script's class is a closed enumeration, not a set of booleans.
- **Security.** The sandbox must not hand ambient credentials to the scripts. The runner clears
  `GH_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and
  `CODEX_HOME` unconditionally (condition C4). A script that needs real credentials belongs in the
  opt-in smoke tier, which `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` keeps out
  of `ci-gate`.
- **Diagram accuracy.** The feature diagram reflects the operator-confirmed placement (change log
  row 2).

### Focused local pattern basis

- **Role:** precedent for a gate that refuses an empty or unknown file set.
- **Precedent:** `test/lint_shell.sh` (`collect_scripts`, `--list`, exit 2 on empty enumeration) and
  integrity check 1b's refusal to report success on zero scripts.
- **Traits to preserve:** the enumeration is computed rather than hand-listed; an empty enumeration
  is a failure, not a pass; a failure names the offending files.
- **Allowed variation:** the new guard enumerates only top-level `test/*.sh`. It may share or
  mirror `lint_shell.sh`'s enumeration helper.
- **Rediscovery hints:** `test/lint_shell.sh` `collect_scripts`; `test/test_lint_shell_enumeration.sh`.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| Shell-test manifest (committed) | Read by `test/run_shell_tests.sh` and by the new integrity guard |
| `test/run_shell_tests.sh` | New `shell-tests` job in `.github/workflows/ci.yml`, registered in `ci-gate` `needs` and its result loop |
| Orphan classification check | A new numbered check inside `test/test_harness_integrity.sh` (CI `integrity` job; self-host `test_suite`) |
| `smokeCapability` declaration assertion | `test/structural/test-execution-policy.test.ts`, run by the existing `conductor` job's `npm test` |
| Exported declaration parser | `src/engine/smoke-runner.ts` (existing caller) plus the structural test |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Many orphans fail today (stale RED specs, rotted fixtures), making triage larger than M | Technical | Medium | Medium | C2: a broken script whose behavior is already covered elsewhere is deleted, not repaired; repair only unique coverage |
| An installer script writes the CI runner's or a developer's real `$HOME` | Security/Data | Low | High | C4: runner-level sandbox; integrity guard requires every manifest entry to run through the runner |
| New CI job adds wall time to every PR | Performance | Medium | Low | C6: job runs in parallel with existing jobs; per-script timeout |
| "Integrity-invoked" declaration drifts from the integrity script | Technical | Low | Medium | C1: guard verifies each declared integrity invocation exists |
| Deleting scripts removes coverage silently | Knowledge | Medium | Medium | C2: each deletion records the replacing coverage or the obsolescence reason in the PR/plan |

## ADRs Created

None. No uncovered structural decision. A new CI job and a test manifest are test infrastructure
inside the existing CI boundary. The smoke capability model is governed by the existing APPROVED
smoke ADRs and is not changed.

## Conditions

- **C1 — Explicit classification.** Every top-level `test/*.sh` appears exactly once in the
  committed manifest. Its class is one of `shell-runner` (executed by `run_shell_tests.sh`),
  `integrity` (executed by `test_harness_integrity.sh`), `invoked-by:<script>` (executed by a
  named parent that is itself non-orphan), or `sourced-helper` (sourced, never executed), and
  every non-`shell-runner` entry carries a reason. The guard fails on:
  - a script missing from the manifest;
  - a manifest entry with no file;
  - an `integrity` entry the integrity script does not invoke;
  - an `invoked-by` parent that does not reference the child, or is itself orphaned;
  - an empty enumeration.
- **C2 — Triage evidence.** Each current orphan is dispositioned as kept, fixed or deleted, with
  pass/fail evidence. A deletion records either the existing test that covers the behavior or why
  the behavior no longer exists. No script is ever manifested as expected-to-fail. A script cited
  by an accepted story's acceptance criteria or Done-When defaults to kept or fixed. Those scripts
  include `test_bin_update.sh`, `test_install_check_build_auth.sh`,
  `test_install_provider_readiness.sh`, `test_ai_conductor_launcher.sh`,
  `test_codex_skill_installation.sh`, `test_examples_common_*.sh` and
  `test_generate_model_table_wrapper.sh`.
- **C3 — Repo-local scope.** This is harness-repository test infrastructure. No `HARNESS.md`,
  shipped `skills/` or consumer-facing change.
- **C4 — Sandbox contract.** For each script, the runner creates and removes its own `HOME`,
  `TMPDIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME` and `GIT_CONFIG_GLOBAL`, and
  unconditionally clears the provider and GitHub credential variables listed under Alignment. Exit status
  propagates: any failing script fails the run, and every failure is named.
- **C5 — CI registration.** The `shell-tests` job honors the `changes` docs-only skip, installs
  `shellcheck`/`ripgrep` the same way the integrity job does, and is added to `ci-gate` `needs`
  and its result loop.
- **C6 — Bounded runtime.** Each script runs under a per-script timeout, and the timeout failure
  names the script.

## Early overlap scan

Advisory: run `ai-conductor overlap-scan --files test/test_harness_integrity.sh
.github/workflows/ci.yml src/conductor/test/structural/test-execution-policy.test.ts
src/conductor/src/engine/smoke-runner.ts docs/contributing/validation.md` before `/plan`.
