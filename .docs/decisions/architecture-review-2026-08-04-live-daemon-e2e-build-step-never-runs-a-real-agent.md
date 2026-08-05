# Architecture Review: Live daemon E2E build step never runs a real agent

**Date:** 2026-08-04
**Feature:** live-daemon-e2e-build-step-never-runs-a-real-agent (jstoup111/ai-conductor#1311)
**Tier:** M (lightweight mode — Feasibility and Conditions only)
**Track:** technical
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | **Clear.** No new dependency and no new subsystem. Both provisioning primitives, the `InvokeOptions.selfHost` transport, and the command registry all exist and are exercised by the self-host build path today. |
| Prerequisites | **None blocking merge.** `CLAUDE_CODE_OAUTH_TOKEN` is already provisioned and proven — run 30965346463 made real API calls costing ~$0.365. Unlike #1259, this feature adds no credential. |
| Integration surface | **Three, all existing.** The live smoke's provider construction (`daemon-e2e-live.smoke.test.ts:217,252-258`), `ClaudeProvider`'s result classification (`claude-provider.ts:429-467,685-700`), and a read-only consumer of `STEP_SKILL_INVOCATIONS` (`skill-invocation.ts:11-54`). The workflow file itself is unchanged. |
| Data implications | **None.** No schema, no migration, no persisted state. The provisioned home is a throwaway removed under `finally`. |
| Performance risk | **Negative cost.** The preflight is filesystem-only and replaces a ~$0.36 grader dispatch as the way this failure is discovered. `DAEMON_E2E_LIVE_TOKEN_CAP` (default 100000) still bounds the run. |
| Worktree isolation | **Improved.** The fixture stops depending on ambient `~/.claude` state, so two concurrent runs — and a run from a worktree with edited skills — no longer read the same global catalog. |
| Release-surface impact | **No migration block required.** Nothing touches `bin/conduct` CLI, hook wiring, `settings.json` schema, or skill symlink targets. The provider classification is reader-visible behavior and warrants `Release-Disposition: note`, category Fixed. |

**Verified claims** (basis: read at the reviewed HEAD, plus the observed workflow run)

- Step `build` maps to `skillName: 'pipeline'` and renders as the literal prompt
  `/pipeline`. `skill-invocation.ts:28,56-66`. *Verified, 99%.*
- `live-daemon-e2e.yml:48-55` installs only `@anthropic-ai/claude-code`; no workflow
  in `.github/` runs `bin/install` or `bin/setup`. *Verified, 99%.*
- `ClaudeProvider.buildEnv:738-745` returns `undefined` unless `selfHost.env` is set,
  and the smoke supplies no self-host wiring (`daemon-e2e-live.smoke.test.ts:217,252-258`),
  so the child inherits the bare runner environment. *Verified, 98%.*
- `classifyCompletion:685-700` computes `success` from the exit code alone (plus
  credit/session checks), so an "Unknown command" answer that exits 0 is reported as a
  **successful** invocation. *Verified, 97%.*
- `tokenUsage` — and therefore `numTurns` — is populated only inside the
  `usageRaw && input_tokens && output_tokens` branch (`claude-provider.ts:438-458`).
  The failing envelope reported zero of both, so `numTurns` never reached
  `InvokeResult`. `num_turns` must be read from the parsed envelope. *Verified, 95%.*
- `provisionProviderHome` **copies** the `skills/` asset rather than linking it, for the
  documented reason that a live link lets provider warmup writes land back inside the
  source tree (`provider-home.ts:145-151`); for Codex it links `.agents/skills` into the
  copy, not the worktree (`:166-171`). It reads no operator state file, installs no
  settings and no hooks, and fails closed with `ProviderHomeProvisionError` on a missing
  asset (`:140-144`). *Verified, 97%.* This is why it, not the sandbox, is the chosen
  primitive.
- `provisionSandboxBuildEnv` symlinks `<root>/skills` (`sandbox-build-env.ts:125,176-186`)
  and reads the operator's live `~/.claude.json` through `provisionTrustState`
  (`:201-210,260-297`). Both are correct for a self-host build and wrong for this fixture.
  *Verified, 96%.*
- `provider-home.ts`'s `childEnv():100-108` deletes `CLAUDE_CODE_OAUTH_TOKEN`, so a
  token-authenticated leg must have the credential supplied explicitly by the caller
  rather than inherited. *Verified, 97%.*
- A step absent from `STEP_SKILL_INVOCATIONS` dispatches as `` `/${step}` `` — the raw
  state key (`step-runners.ts:546-548`) — and this repository declares two such custom
  steps in `.ai-conductor/config.yml:114-125`. The registry is therefore not the only
  enumeration source. *Verified, 98%.*
- The tier's skip predicate is evaluated at `describe.skipIf` (`:210`) from `shouldRun`
  (`:103-105`), so anything executed at module scope runs before it. *Verified, 98%.*
- `ProviderExecutionContext` requires `configuredProviders`, `runtimes`, and `sessions`
  (`provider-execution.ts:218-235`), so injecting `prepareCandidateSelfHost` through
  `DefaultStepRunner`'s options is not free. *Verified, 99%.*
- `install-freshness.ts:1-15` already names this failure class, and its guard runs at
  `daemon-cli.ts:704` — an entry point this fixture bypasses by calling `runDaemon()`
  as a library. *Verified, 95%.*
- The credential, the CLI, and `--dangerously-skip-permissions` all work on the runner:
  the same failing run's `build_review` step completed a real 3-turn dispatch costing
  $0.3645. *Verified from the observed run, 95%.*

**Assumptions surfaced**

- **A-1 (inferred, 90%) — a throwaway `CLAUDE_CONFIG_DIR` whose `skills/` is a symlink
  makes `/pipeline` resolve for `claude --print` with the prompt on stdin.** Basis:
  `conductor.ts:2477-2484` does exactly this for every self-host build, and those
  builds run. *Impact if wrong:* the chosen mechanism does not work at all and the
  feature falls back to provisioning the runner's `$HOME` via `bin/install`.
  *Confirm:* one real dispatch, first thing — see C-1.
- **A-2 (inferred, 85%) — a config dir with no `.claude.json` does not block the
  dispatch.** The chosen primitive writes no trust state at all, so the home is
  untrusted by construction. Basis for believing it is fine: the same run's
  `build_review` dispatched successfully against the runner's equally trust-free ambient
  environment, and `--dangerously-skip-permissions` is always set for `build`
  (`step-runners.ts:733-741`). *Impact if wrong:* the build wedges on denied tools and
  produces the same empty diff, i.e. the symptom does not change and the cause is newly
  ambiguous. *Fix if wrong:* seed a minimal trust file in the fixture's OWN home — do not
  reach for `provisionSandboxBuildEnv`'s propagate-only reader, which would reintroduce
  the ambient-state dependence this design rejects. *Confirm:* the first live run, C-1.
- **A-3 (inferred, 80%) — the smoke can supply `selfHost` by decorating the provider,
  reusing the file's existing `TokenMeter` pattern, rather than constructing a full
  `ProviderExecutionContext`.** *Impact if wrong:* the plan must build a context with
  `runtimes`, `sessions`, and `configuredProviders` — materially more setup, but no
  change to any decision here. *Confirm:* cheap, at the first implementation task.
- **A-4 (inferred, 80%) — `num_turns === 0` conjoined with a `result` naming the exact
  dispatched command is both sufficient and safe as a discriminator.** *Impact if
  wrong (false positives):* ordinary agent prose could be misclassified as an
  environment failure, which would be worse than the bug being fixed. *Mitigation:*
  negative-path coverage is mandatory (C-2), and the provider half can be narrowed or
  dropped without losing outcomes 1-2, which the preflight carries.
- **A-5 (inferred, 75%) — the four static source assertions at
  `daemon-e2e-live-agent-tier.acceptance.test.ts:42-109` still hold.** They regex the
  smoke's source text, including asserting the *absence* of certain tokens. The design
  deliberately preserves `new ClaudeProvider()` and the outcome-only assertion block,
  but a provisioning helper could still trip a pattern. *Impact if wrong:* the ordinary
  suite goes red. *Confirm:* re-read that file while implementing; do not assume.

## Conditions

- **C-1 (blocking further build, cheap).** Confirm A-1 and A-2 with a single real
  dispatch before implementing the preflight or the provider classification. The whole
  feature rests on "a provisioned home makes the command resolve"; one run settles it,
  and discovering it late wastes the rest of the work. If A-2 fails, seed trust in the
  fixture's own home — do not widen `provisionTrustState`'s propagate-only rule, which
  exists so a sandbox never fabricates an operator grant.
- **C-2 (blocking merge).** Capture one real unresolved-command envelope from a live
  run and pin it as the fixture for the provider classification's unit tests. Do not
  hand-author the shape — the observed envelope already contradicts the intuitive guess
  (`subtype: "success"`, `is_error: false`). Negative-path coverage must include an
  ordinary successful dispatch whose prose mentions an unknown command, and a
  legitimate zero-turn result that is not a resolution failure.
- **C-3 (blocking merge, no plan task).** `docs/contributing/testing.md:75-100` and its
  row at `:296` state the live tier's prerequisites as "the `claude` binary and the
  `CLAUDE_CODE_OAUTH_TOKEN` secret". That becomes incomplete once the fixture owns its
  provider home, and the local-run instructions change meaning. This repository routes
  human-facing documentation through its `maintain-documentation` custom step, so this
  carries no plan task but is required before the PR is complete.
- **C-4 (sequencing, informational).** #1259's implementation wires `release.yml` to
  call this workflow fail-closed (`.docs/plans/no-release-time-smoke-or-eval-gate-releases-cut-wi.md:398-412`).
  Its spec PR #1310 is already merged, so the daemon may build it. That gate must not
  reach `main` before this feature ships, or every release blocks. The dependency is
  recorded on #1311 and in PR #1310's body; no code change here enforces it.
- **C-5 (scope guard).** Do not add a `schedule` trigger, a `pull_request` trigger, or
  an entry in `ci-gate`'s `needs`. The tier's trigger contract is fixed by
  `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` and this feature has no
  reason to touch it.
- **C-6 (blocking the provider classification, from conflict-check C2).** Before Task 15
  lands, establish empirically whether this repository's own config-declared custom steps
  — `maintain-documentation` and `release-disposition` — currently resolve when dispatched.
  They are absent from `STEP_SKILL_INVOCATIONS`, so they dispatch as their raw state key
  (`step-runners.ts:546-548`), and their skills live under `.agents/skills/`. If they
  resolve, nothing further is needed. If they do not, they are producing silent zero-turn
  successes today, and the classification would convert that into a hard failure on every
  self-host SHIP tail. Surfacing a real defect is the right outcome, but not as an
  uncontrolled side effect of a test fix: fix the dispatch or scope the classification, and
  say which in the PR. Plan Task 14a carries this.
- **C-7 (ordering, from conflict-check C1).** Provisioning and the preflight must execute
  inside the tier's existing `describe.skipIf` case, never at module scope, or every
  uncredentialed advisory run turns red and #1259's gate misreads it as a smoke regression.

## Architectural alignment

Consistent with the repository's stated design principle — the fix is machinery, not
prompt discipline: a filesystem precondition and a provider-boundary classification,
both deterministic, replacing a failure that was previously discovered by an LLM grader
complaining about a symptom. Consistent with the test-isolation policy: the tier remains
an explicitly named, opt-in smoke excluded from the default suite. Consistent with
`adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`: no assertion is added on agent
wording, dispatch count, or turns as an outcome.
