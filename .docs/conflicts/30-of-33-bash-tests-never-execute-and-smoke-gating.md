# Conflict Check: Every bash test executes in CI or is removed (#1021)

**Date:** 2026-10-10
**Stories checked:** `.docs/stories/30-of-33-bash-tests-never-execute-and-smoke-gating.md` (Stories
1–5), against all 591 files in `.docs/stories/`, plus this feature's architecture review.
**ADR corpus:** repo-wide (347 ADR files).
- Examined: `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`,
  `adr-2026-08-04-classify-before-spend-release-smoke-gate`,
  `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization`,
  `adr-2026-08-12-per-provider-live-smoke-legs`,
  `adr-2026-09-28-skills-may-bundle-executable-helpers`, and
  `adr-2026-07-25-content-addressed-full-suite-proof`.
- Narrowed out: every other approved ADR. None governs `test/*.sh` execution, `ci.yml` job
  wiring, `ci-gate`, the smoke capability model, or `test/lint_shell.sh` enumeration.

Related story files found by subject search (`ci-gate`, `docs-only`, `lint_shell`,
`smokeCapability`, `test-execution-policy`, and the name of each orphan script):
- `a-docs-only-spec-landing-silently-breaks-main-via-.md` (open, #3151)
- `skip-full-ci-for-docs-only-changes.md`
- `no-release-time-smoke-or-eval-gate-releases-cut-wi.md`
- `daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`
- `ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-.md`
- `skills-may-bundle-executable-helpers.md`, `dead-src-conductor-bin-directory-lingers-after-int.md`
- Shipped stories citing orphan scripts: `off-tag-checkout-reports-up-to-date-forever-tagged.md`,
  `install-and-first-run-paths-give-misleading-or-mis.md`,
  `harness-skills-and-context-files-reach-pi-sessions.md`,
  `v1-0-cutover-remove-bin-conduct-make-the-ts-cli-ai.md`,
  `decide-the-daemon-engine-rename-before-the-v1-0-ta.md`,
  `remove-the-unattended-one-shot-inline-run-auto-the.md`, `s-tier-pipeline-knobs.md`

**Result:** 1 blocking and 1 degrading conflict, plus 1 advisory. All were resolved by the operator
on 2026-10-10 by editing this feature's own artifacts in place. The re-check is clean.

## Conflict: Credential exception in the review contradicts Story 2

**Stories involved:** Story 2 (this feature) vs this feature's architecture review (Alignment, Security)
**Files:** `.docs/stories/30-of-33-bash-tests-never-execute-and-smoke-gating.md` vs `.docs/decisions/architecture-review-2026-10-10-30-of-33-bash-tests-never-execute-and-smoke-gating.md`
**Type:** contradiction
**Severity:** blocking

**Description:** Story 2 says that none of `GH_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `CODEX_HOME` is visible to a script. The review cleared
those variables "unless a manifest entry names a need with a reason". An implementation honoring
that exception fails Story 2, and one satisfying Story 2 leaves the exception unimplementable.

**Resolution Options:**
1. Drop the exception from the review. Credentialed scripts belong in the opt-in smoke tier.
2. Add an exception criterion to Story 2.
3. Introduce a separate credentialed shell tier.

**Resolution (selected):** Option 1. The review now clears the variables unconditionally and
points credentialed work at the smoke tier, which
`adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` keeps out of `ci-gate`.

## Conflict: Docs-only `ci-gate` outcome overlaps with #3151's live-corpus job

**Stories involved:** Story 3 (this feature) vs #3151 Story 1 (live-corpus job on docs-only PRs)
**Files:** `.docs/stories/30-of-33-bash-tests-never-execute-and-smoke-gating.md` vs `.docs/stories/a-docs-only-spec-landing-silently-breaks-main-via-.md`
**Type:** overlap
**Severity:** degrading

**Description:** Story 3 said a docs-only PR skips `shell-tests` "and `ci-gate` still passes".
Under #3151, `ci-gate` on a docs-only PR also depends on the live-corpus job, so the criterion
over-claimed the outcome. Checked both ways: fully satisfying #3151 leaves Story 3's skip
behavior intact, and fully satisfying Story 3 leaves #3151's job intact. This is not an
oscillation. Both features edit `ci-gate`'s `needs` and result loop, which is a merge-order
concern only.

**Resolution Options:**
1. Reword Story 3 to claim only that the skipped `shell-tests` result does not, by itself, fail `ci-gate`.
2. Make Story 3 depend on #3151.

**Resolution (selected):** Option 1. Story 3's criterion is reworded in place.

## Advisory: Shipped stories cite orphan scripts

Seven shipped stories, plus `s-tier-pipeline-knobs.md`, cite scripts that are orphaned today
(`test_bin_update.sh`, `test_install_check_build_auth.sh`, `test_install_provider_readiness.sh`,
`test_ai_conductor_launcher.sh`, `test_codex_skill_installation.sh`, `test_examples_common_*.sh`,
`test_generate_model_table_wrapper.sh`). Story 4 already requires every deletion to name its
covering test. No contradiction. Resolution: architecture review condition C2 now defaults these
scripts to kept or fixed during triage.

## Pairwise notes (clean)

- `skip-full-ci-for-docs-only-changes.md` Stories 2a–2c (`ci-gate` always reports; skipped heavy
  jobs do not fail it; `ci-gate` is the designated aggregate): Story 3 adds one more heavy job under
  the same rules.
- `no-release-time-smoke-or-eval-gate-releases-cut-wi.md` (default run excludes smoke;
  `test-execution-policy.test.ts` keeps its exclusion message): Story 5 adds an assertion to that
  test without changing exclusion behavior or the smoke config.
- `daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md` and ADR 2026-08-02 D1 (live smoke absent
  from `ci-gate`): `shell-tests` runs no live provider, because Story 2 clears every credential.
- `skills-may-bundle-executable-helpers.md` and ADR 2026-09-28 D6: `test/lint_shell.sh`
  enumeration is unchanged. Story 1's classification covers only top-level `test/*.sh`.
- Within this feature, Stories 1 and 4 (every script classified; deletions keep children
  classified) and Stories 1 and 2 (`shell-runner` class; the runner reads only `shell-runner`
  entries) are compatible in both directions.
