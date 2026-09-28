# Architecture Review: Engine-owned destructive-git guard for every provider and run mode (#1354)
**Date:** 2026-09-23
**Mode:** lightweight (tier M), pre-stories. Sections 2 (Feasibility) and 4 (Alignment) only.
**Stories reviewed:** none yet; the input is the technical-track scope in
`.docs/track/destructive-git-prevention-is-absent-in-self-host.md` and the design in
`.docs/architecture/destructive-git-prevention-is-absent-in-self-host.md`.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding | Confidence / basis |
|---|---|---|
| Stack compatibility | Needs only bash and the existing TypeScript engine. No new package. | 95%, verified: the asset pattern already exists in `git-hook-assets.ts` and `worktree-prepare.ts` `writeGitHooks` |
| Prerequisites | None. Worktree preparation already provisions `.pipeline/git-hooks/` fail-closed. | 95%, verified: `writeGitHooksAndWire` throws `preventive git hook installation failed` |
| Integration surface | Four areas: the engine asset and provisioning, both provider adapters' env construction, the operator hook script, and skill text (`tdd`). | 90%, verified by call-site trace |
| Data implications | None. No schema, ledger or persisted state. | 95% |
| Performance | One extra `exec` per agent `git` call. `rev-parse` runs only on destructive-shaped argv. | 85%, inferred |
| Worktree isolation | The guard is per worktree, with the common dir baked per repository. Nothing is shared, and there are no ports or services. | 95% |

**PATH reach, the load-bearing assumption:**
- **Claude:** the child env spreads `process.env`, so a prefix carries through. 90%, verified from
  source (`claude-provider.ts` `buildEnv`).
- **Codex, inheritance:** the default `shell_environment_policy` `inherit = all` builds the shell env
  from the process env, and `set` inserts explicit entries. 90%, verified against Codex source docs
  (`codex-rs/protocol/src/config_types.rs` `ShellEnvironmentPolicy`, via Context7).
- **Shell startup files:** the operator's interactive zsh startup prepends four entries ahead of an
  inherited prefix, and none of them contains a `git`. Verified on the operator's host, 2026-09-23.
  So the guard wins today, but other hosts may differ. Condition C1 turns this into an executable
  proof.

## Alignment

- **Governing ADRs honoured:**
  - adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts: a preventive control fails
    closed, and `block-destructive-git.sh` stays as early feedback.
  - adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation: child-only env, the
    same across providers and every dispatch shape, with the real `git` path resolved before any
    home override.
  - adr-2026-08-27-daemon-dispatcher-executor-seam: the daemon env is never mutated.
  - adr-2026-08-24-one-dispatch-member-on-the-provider-contract: one env-construction path per
    adapter.
  - adr-2026-07-11-attribution-abstain-or-loud: embedded asset, no dist.
- **adr-2026-07-03-post-rebase-force-with-lease:** its containment rule governs engine force call
  sites. The guard adds none. It allows agent lease pushes, which the operator confirmed on
  2026-09-23, and refuses every bare force.
- **adr-2026-09-11-github-operation-ownership D7:** the guard `exec`s the real `git` unchanged for
  allowed pushes, so it adds no new remote-write adapter. The D7 production-boundary audit must
  classify the guard as pass-through (condition C3).
- **New structural decision:** an engine-owned executable interposed on the agent process `PATH` is
  a new integration seam between the engine and provider child processes. No APPROVED ADR governs
  it, so adr-2026-09-23-engine-git-guard-on-agent-path records it.
- **Pattern basis:**
  - Provisioning follows the per-worktree preventive git-hook asset (stable symbols
    `writeGitHooks`, `PRE_COMMIT_HOOK`, `writeGitHooksAndWire`).
  - The traits to keep: embedded string asset, 0755 real file under `.pipeline/`, fail-closed on
    write, idempotent rewrite.
  - Allowed variation: it lives under `.pipeline/bin/` and is reached through `PATH`, not
    `core.hooksPath`.
  - The per-dispatch content-and-mode check follows `sessionHookNeedsRepair`.
- **Security boundaries:** the protection is against accidents, not adversaries. Absolute-path
  `git` and startup-file reordering stay documented limits, handed to #2693 and #1352.

## Wiring Surface

- **Guard asset** (a new exported constant beside the existing git-hook assets): written by
  worktree preparation's preventive-hook provisioning, which the daemon runner calls once per
  feature run, plus the quarantine-retry and autoresolve worktree paths.
- **Guard ensure-and-verify** (a new exported engine function): called from each provider adapter's
  child-env construction before launch, whenever the dispatch working directory is an
  engine-prepared worktree.
- **Child `PATH` prepend helper** (in the shared child-environment module): consumed by
  `ClaudeProvider` env building and `CodexProvider` invocation env, plus the Codex
  `shell_environment_policy.set` argument builder.
- **Operator hook fix:** `hooks/claude/block-destructive-git.sh`, already registered by
  `bin/install`. The registration does not change.
- **Skill text:** `skills/tdd/SKILL.md`, the counterfactual step. The `docs/reference/settings-and-hooks.md`
  control inventory records the guard.

`ai-conductor overlap-scan` over these paths reported: "No overlap detected; no open blockers."

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A shell startup file on another host puts a different `git` earlier than the guard | Technical | Low | High | Live smoke per provider (C1). Documented limit, with #2693 as the backstop. |
| The build_review containment profile does not mount the worktree's `.pipeline/bin`, so the prepended entry is dangling | Integration | Medium | Medium | C2: a test of the contained review launch that asserts `git` resolves to the guard. If it can't, the gap is documented instead. |
| The guard refuses a legitimate agent operation not found in the skill sweep | Technical | Medium | Medium | Scoped to the feature repository. `--ours`/`--theirs` and lease forms allowed. Every refusal names the safe alternative. |
| The release-gate path classifier flags the hook-script edit as hook wiring | Integration | Medium | Low | C4: the plan carries a waiver (content-only change, registration unchanged) or a migration block. |
| An agent-launched engine CLI later adds a refused git form | Technical | Low | Medium | A test asserts the known engine CLI git argv pass the guard. A future escape needs its own decision. |

## ADRs Created

- `adr-2026-09-23-engine-git-guard-on-agent-path` (APPROVED by the operator 2026-09-23).

## Conditions

- **C1.** An opt-in live smoke test per provider (Claude, Codex) proves an agent shell resolves `git`
  to the guard and a refused command is refused. The feature does not claim coverage for a provider
  whose smoke test has not passed.
- **C2.** The build_review contained launch is tested for guard resolution, or its gap is recorded in
  the control inventory.
- **C3.** Any existing GitHub-operation production-boundary audit treats the guard as a pass-through
  `exec`, not a new remote-write adapter.
- **C4.** The plan resolves the release-gate classification of the `hooks/claude/` edit.
- **C5.** `docs/reference/settings-and-hooks.md` records the guard as active for #1354, with every
  limit in ADR decision 10, as architecture-review-2026-08-07 condition 7 requires.
