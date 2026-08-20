# Architecture Review: Live daemon E2E tier covers only Claude — no real-agent Codex signal

**Date:** 2026-08-12
**Feature:** live-daemon-e2e-tier-covers-only-claude-no-real-ag (jstoup111/ai-conductor#1264)
**Tier:** Medium (lightweight mode — Sections 2 and 4 only; complexity assessed by `/conduct`,
domain integrity delegated to the TDD domain reviewer)
**Track:** technical (no PRD; acceptance criteria live in stories)
**Reviewed against:** `.docs/architecture/live-daemon-e2e-tier-covers-only-claude-no-real-ag.md`,
`.docs/track/live-daemon-e2e-tier-covers-only-claude-no-real-ag.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

Every claim below was read from the tree in this worktree on 2026-08-12.

| Check | Finding | Confidence |
|---|---|---|
| **Stack compatibility** | No new dependency. The live workflow **already installs the Codex CLI** — `npm install --global @anthropic-ai/claude-code @openai/codex` (`live-daemon-e2e.yml:52`). The binary the Codex leg needs is present on the runner today. | verified, 100% |
| **Prerequisites** | One: a `CODEX_API_KEY` repository secret. Verified 2026-08-12 the repository holds `CLAUDE_CODE_OAUTH_TOKEN`, `RELEASE_PR_APP_ID`, `RELEASE_PR_APP_PRIVATE_KEY` and zero variables. Operator has committed to adding it. | verified, 100% |
| **Provider seam** | Genuinely provider-neutral and requires no change: `provider-home.ts` maps `codex → CODEX_HOME` via `HOME_VARIABLE`, and `childEnv()` already strips ambient `CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `CLAUDE_CODE_OAUTH_TOKEN`. `CodexProvider` implements `resolveSelfHostExecutable` (`:174`), `prepareSelfHostAuth` emitting `CODEX_API_KEY` (`:178-186`), and `readiness` probing `codex doctor --json --summary` (`:188-211`). `step-command-preflight.ts` already accepts a `providerKey` and renders `$name` versus `/name`. | verified, 100% |
| **Capability seam** | **Not** provider-neutral. `smoke-capability.ts` resolves `credentialed` against a hardcoded `CLAUDE_CODE_OAUTH_TOKEN` in both `resolveAdvisorySmokeCapabilities` and `resolveGateSmokeCapabilities`. The union is closed and has no provider dimension. This is the real work, and it is the part the intake's hypothesis missed. | verified, 100% |
| **Matrix seam** | **Decorative.** `matrix: provider: [claude]` is never read: the credential-check step names `CLAUDE_CODE_OAUTH_TOKEN` directly and every leg runs the identical `npm run smoke`. Adding `codex` to the list without further change would run the Claude leg twice. | verified, 100% |
| **Integration surface** | Two third-party surfaces: the Codex CLI driven headlessly, and a new GitHub Actions secret. No production dispatch path changes. | verified, 100% |
| **Data implications** | None. No schema, no migration, no persisted state, no new `ConductorEvent` member, no new `.pipeline/*.jsonl` ledger. Per-provider outcomes ride the existing smoke ledger and GitHub step summary — no parallel channel. | verified, 100% |
| **Performance / cost risk** | Adds one live agent run per release-gated invocation. Bounded by the same `DAEMON_E2E_LIVE_TOKEN_CAP` mechanism (default 100 000) already applied per leg, with the observed total reported on success. Wall-clock is bounded by the existing 30-minute job timeout and the run body's own 20-minute test timeout; the matrix legs run in parallel with `fail-fast: false`, so the Codex leg does not extend the Claude leg's critical path. | verified, 95% |
| **Worktree isolation** | Unaffected. Each run provisions a throwaway home under `mkdtemp` and tears it down; nothing writes the checkout under test, preserving `adr-2026-08-04-live-tier-provisions-its-own-provider-home`'s copy-never-link guarantee. | verified, 95% |

**One concrete ordering constraint for the plan.** `CodexProvider` resolves its authentication
**in the constructor** — `this.authentication = this.selectAuthentication()` (`codex-provider.ts:169`),
which reads `process.env.CODEX_API_KEY`. The Codex leg must therefore guarantee the key is present
in `process.env` *before* it constructs the provider. A leg that constructs first and sets the
environment afterwards will silently fall through to `cached-login`, and
`prepareSelfHostAuth` will then attempt `copySelectedCodexLogin` from a `~/.codex/auth.json`
that does not exist on a runner. This is a plausible and near-invisible failure mode; it must be
an explicit task, not left to inference.

**A second concrete constraint.** `test/fixtures/live-provider-home.ts` currently defaults its
`ResolvedSelfHostProvider` to a hand-built Claude object whose `prepareSelfHostAuth` closes over
the Claude token. Parameterizing it must route through the real provider's `prepareSelfHostAuth`
rather than growing a second hand-built Codex object, or the leg will test a fixture's idea of
Codex auth instead of `CodexProvider`'s.

## Alignment

**Against APPROVED ADRs.**

- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` (which carries forward
  `adr-2026-08-04`'s capability model): **extended, not violated.** That model's premise is that a
  capability names *a fact about what a file needs*; "needs the Codex credential" is a distinct
  fact from "needs the Claude credential." Its stated forward intent — "the capability enum makes
  the tier splittable by cost later without revisiting any individual file" — is the axis this
  work splits along. The closed-enum property is preserved: the new members are enumerated, not
  free-form.
- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`: **respected.** Both legs assert
  terminal state, committed artifacts, and token cap. Codex is held to identical outcome
  assertions, never to a Codex-shaped script. Turn counts stay diagnostic.
- `adr-2026-08-04-live-tier-provisions-its-own-provider-home`: **reused unchanged.** The Codex leg
  consumes the same provisioning primitive; the ADR's own component table anticipated this
  ("Provider-neutral, so the reserved Codex leg is one entry plus a credential") and that half of
  the anticipation is correct.
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`: **partially falsified and amended
  in place.** Its "one entry plus one credential var" assertion does not survive contact with the
  capability and matrix layers. Per the accepted-artifact amendment rule, an additive note was
  added beside the original assertion; the original text is preserved verbatim.

**Against `CLAUDE.md` design principles.**

- *Deterministic where possible.* The coverage guard is the principle applied directly: the prior
  mechanism for keeping Codex covered was recorded intent in an ADR, a matrix entry, and a
  responsibility table — and Codex shipped uncovered anyway. A structural test fails at the moment
  of the mistake. This is also why gate enforcement is keyed to credential presence rather than to
  a follow-up ticket.
- *Extend the existing event spine; never add a parallel channel.* Satisfied by construction. No
  new observation channel is introduced: per-provider outcomes use the existing per-file smoke
  ledger (`emitSmokeOutcomeLedger`) and the existing `GITHUB_STEP_SUMMARY`. Nothing here is a
  `ConductorEvent` concern — the smoke tier is a CI harness outside the daemon's telemetry spine —
  so no spine member is added and no sidecar file is created.
- *Third-party calls are smoke-only in tests.* Satisfied and reinforced: the Codex leg is an
  opt-in smoke file under the existing capability gating, excluded from the default suite by the
  unchanged `vitest.config.ts` exclusion globs. The new coverage guard is hermetic — it enumerates
  a registry and asserts file existence, with no dispatch, no credential, and no spend — so it is
  correctly placed in the ordinary suite.

**Pattern consistency.** The per-provider descriptor manifest mirrors the repository's existing
habit of deriving checks from a single production enumeration source (`STEP_SKILL_INVOCATIONS`
drives the step-command preflight; `HOME_VARIABLE` drives home provisioning). It introduces no new
structural idiom.

**State management.** The gating state is derived, not stored: a leg is enforced exactly when its
credential is present. There is no `is_gating` flag, no persisted "proven" marker, and therefore no
way for a recorded state to drift out of agreement with reality.

**Security boundaries.** `CODEX_API_KEY` is a repository secret consumed only as a workflow `env`
value and forwarded by the provider's own `prepareSelfHostAuth` into a throwaway home. The engine
never reads or logs it — `provider-home.ts`'s comment records credential selection as a provider
concern, and this work does not change that. The existing `redactSafetyText` path is untouched.
**Condition C-3** below covers the one new exposure risk.

**Production DI defaults.** Not applicable — no production dependency injection changes.

## Wiring Surface

Design-time commitments for each new production surface (no `file:line` yet; the code does not
exist):

| New surface | Where it will be called from in production |
|---|---|
| Per-provider `credentialed:«provider»` capability members | Consumed by `resolveAdvisorySmokeFile` / `resolveGateSmokeFile` in `smoke-capability.ts`, which `smoke-runner.ts`'s `runSmoke` already calls for every discovered file. Reached in production by `npm run smoke` → `scripts/smoke.ts` → `runSmokeCli`. |
| Per-provider credential-variable mapping | Called from the same two resolution functions, replacing the current hardcoded `environment.CLAUDE_CODE_OAUTH_TOKEN` read. |
| Revised `assertGateCredentialedExecution` | Already called at the tail of `runSmoke` in gate mode; signature/semantics change, call site does not. |
| `LIVE_E2E_PROVIDERS` descriptor manifest | Read by the shared run body, by each per-provider smoke file, by the capability credential mapping, and by the new coverage guard. It is a test-tier module; its "production" entry point is `npm run smoke` and the ordinary `npm test` run for the guard. |
| Shared parameterized run body | Called by each `daemon-e2e-live-«provider».smoke.test.ts`, which the smoke config's `**/*.smoke.test.ts` glob discovers with no list to edit. |
| Provider-enumeration coverage guard | A structural test in the ordinary suite, discovered by `vitest.config.ts`'s default include. Runs on every PR. |
| Per-leg workflow credential check and smoke selection | Called by `live-daemon-e2e.yml`'s job steps, which `release.yml:124` invokes via `workflow_call`. |

**Early overlap scan (advisory, non-blocking).** `conduct-ts overlap-scan` over these paths
reports `src/conductor/src/engine/smoke-capability.ts` overlapping ~29 unmerged spec branches.
That result is **low-signal**: `smoke-capability.ts` is a recent file, so branches based on an
older main show the whole file as a difference. Two overlaps are worth a human glance before
`/plan` locks the task breakdown — `origin/spec/codex-readiness-distinguishes-unavailable-doctor-p`
(touches Codex readiness classification, which this leg depends on) and
`origin/spec/per-step-provider-routing-927` (touches provider selection). Neither blocks this
review.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `codex doctor` does not report ready on a GitHub runner with only `CODEX_API_KEY` and no cached login — no CI precedent exists in this repository | Integration | Medium | **High** | Gate enforcement is keyed to credential presence, so the leg cannot block a release before the secret lands (ADR decision 3). Condition **C-1**: a manual `workflow_dispatch` must be observed before a release consumes the leg. |
| Extracting the shared run body silently weakens an assertion on the release-gating Claude leg | Technical | Medium | High | Condition **C-2**: the extraction is assertion-preserving, and the file's existing ungated self-check cases must pass unchanged before and after. |
| Codex leg constructs `CodexProvider` before `CODEX_API_KEY` is in `process.env`, silently falling back to `cached-login` and failing on a missing `~/.codex/auth.json` | Technical | Medium | Medium | Explicit plan task for the ordering constraint; the leg should assert the resolved auth source is `api-key` rather than inferring it from a passing run. |
| A Codex failure surfaces as an opaque readiness error rather than the daemon-log-and-pipeline-state excerpt the Claude leg prints (desired outcome 3) | Knowledge | Medium | Medium | The existing `dumpPipelineDiagnostics` path is provider-agnostic and must be wired into the shared body, not duplicated per leg. Codex's `logReadinessDiagnostic` adds provider-specific detail on top. |
| Codex secret leaks into CI logs via a diagnostic or step summary | Security | Low | High | Condition **C-3**: the per-leg credential check and step summary must report presence/absence only, never the value; no new code path may log the resolved credential. |
| The Codex leg is flaky against a real agent, making releases intermittently red | Integration | Medium | Medium | `fail-fast: false` already isolates legs. The credential-keyed enforcement means a persistent problem can be de-gated by removing the secret — a visible, ledger-recorded action, not a silent one. |
| `test/structural/smoke-entry-point.test.ts`'s hardcoded capability map drifts from the new manifest | Technical | Medium | Low | Reconciliation is a named follow-up in `adr-2026-08-12-live-provider-coverage-from-plugin-registry`; should be a plan task, not a follow-up issue. |

## ADRs Created

Both were assessed against the structural prerequisite before drafting, and `.docs/decisions/`
was read for a governing ADR to reuse rather than duplicate.

- **`adr-2026-08-12-per-provider-live-smoke-legs`** — structural: revises component decomposition
  of the live tier (one file per provider over a shared body) and changes a release-gate
  invariant (`assertGateCredentialedExecution`). Not covered by an existing ADR:
  `adr-2026-08-07` establishes the capability model but says nothing about a provider dimension
  or per-provider gate enforcement.
- **`adr-2026-08-12-live-provider-coverage-from-plugin-registry`** — structural: establishes a new
  integration seam binding the test tier to the production plugin registry as its enumeration
  source. Separable from the first (the operator's rejected minimal scope would have shipped one
  without the other), which is why it is a second ADR rather than a clause of the first.

**Amended, not superseded:** `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` — an
additive note beside its falsified "one entry plus one credential var" assertion. Its actual
decisions (manual dispatch, reusable `workflow_call` gate, `require_credentials` semantics) are
unchanged and remain authoritative, so superseding it would be wrong.

No ADR was created for the shared-run-body extraction: it is implementation structure within a
single test module, not a system boundary, decomposition, integration pattern, data architecture,
or foundational technology decision.

## Conditions

**C-1 — Prove the Codex auth path before a release depends on it.** The Codex leg must be
observed green via `workflow_dispatch` at least once before a release-gated invocation counts it.
Discharged by the ADR's credential-keyed enforcement plus the operator's stated sequence; verified
at `/finish`.

**C-2 — The run-body extraction is assertion-preserving.** The Claude leg's observable assertions
(terminal state, task-trailered commit, touched fixture, metering, token cap, unmetered-step
allow-list) must be identical before and after. The file's existing ungated self-check cases,
which the `daemon-e2e-live-agent-tier` acceptance test runs in the ordinary suite, must pass
unchanged. Verified at code review.

**C-3 — No credential value reaches a log, summary, or diagnostic.** The per-leg credential
check and step summary report presence or absence only. Verified at code review.

**C-4 — The coverage guard must fail for the right reason.** It must fail when a registered
`llm_provider` has no live leg, and must **not** fail merely because a credential is absent.
A test proving both directions is required — a guard that passes vacuously is worse than none.

**C-5 — Documentation upkeep.** `docs/contributing/testing.md` (capability documentation) and the
live-tier operational documentation must record the per-provider capabilities and the
credential-keyed enforcement rule in the same PR. Required by this repository's documentation
convention.

## Blocking Issues

None. The one High-impact unverified assumption — Codex headless API-key auth on a runner — was
surfaced to the operator before any ADR was written, and the operator's decision of 2026-08-12
("advisory until proven, then flip") is implemented as credential-keyed enforcement so that the
assumption cannot block a release if it proves false. No APPROVED ADR is violated.
