# Architecture Review: Self-host builds isolate and fingerprint Pi operator state (Medium — lightweight)

**Date:** 2026-10-03
**Stories reviewed:** none yet (pre-stories, technical track); input is the explore decision and
scope boundary in `.docs/track/self-host-builds-isolate-and-fingerprint-pi-operat.md` and intake
jstoup111/ai-conductor#1887
**Verdict:** APPROVED

No new ADR. The governing ADRs are reused:
`adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` gains an additive amendment (D23–D26),
because its D6 and the #1886/#1889 amendments state that Pi declares no `selfHost`.
`adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` §3 is applied
unchanged.

## Governing ADR conflict found and resolved

The first approach the operator chose was A: an opaque copy of the whole `~/.pi/agent/auth.json`,
the same as Codex. It violates adr-2026-07-26 §3. That section allows only "the selected native
credential artifact" and fails closed when it cannot be exposed without unrelated state. Pi's
`auth.json` holds every provider's credential: five entries on the operator's machine on
2026-10-03. A Codex `auth.json` holds a single login, which is why the same mechanism is compliant
for Codex. The operator was shown the conflict and chose approach C, a Pi-resolved single
credential (amendment D25), which complies without amending §3.

## Feasibility

- **Capability gate exists.** `requireProviderCapability(id, 'selfHost')` already refuses Pi by
  name, citing `PROVIDER_CAPABILITY_OWNERS.selfHost = '#1887'`. Flipping the flag widens
  `SelfHostProviderId` automatically. ✅ (verified, `execution/provider-catalog.ts`)
- **Home lifecycle is provider-neutral.** `provisionProviderHome`, `acquireScratchHome`,
  `releaseScratchHome` and `sweepScratch` are keyed by provider id only, with no claude/codex
  branches. The worktree skills copy and operator-only pruning already apply. ✅ (verified,
  `engine/self-host/provider-home.ts`, `provider-scratch.ts`)
- **Pi home relocation.** Pi honors `PI_CODING_AGENT_DIR`; the catalog already declares it as Pi's
  `homeVariable`, with `.pi/agent` as the default home. ✅ (verified, catalog plus pi.dev docs per
  the intake)
- **Single-credential resolution.** `pi auth print-api-key --provider <p>` returns the
  provider's key, exit 0, for `openrouter`. It left the live Pi home byte-identical: no file
  added, removed or changed outside `sessions/`. ✅ (verified 2026-10-03, pi 1.0.0)
- **Provider known at preparation time.** `ProviderCandidate` carries the resolved `model`
  before `prepareCandidateSelfHost` runs, and D13 makes every Pi dispatch carry a
  `provider/model` id. ✅ (verified, `engine/provider-execution.ts`). Each fallback-ladder rung
  and candidate re-prepares its own home. ✅ (inferred, ~85%, from `prepareCandidateSelfHost`
  being invoked per candidate index; the plan carries a task that pins this with a test.)
- **One-entry file shape.** Existing operator entries use `{ "type": "api_key", "key": "…" }`,
  which is Pi's native form. ✅ (verified)
- **Extension providers.** `llama.cpp` and `qoder` return "Unknown provider", exit 1, because
  extensions/packages register them. The throwaway home loads no extensions, so they are refused
  at setup under every option. ✅ (verified)
- **Pi churn.** Dispatches run `--no-session`, so live-home churn comes from operator sessions
  (`sessions/`) and Pi's model cache (`models-store.json`, observed changing on 2026-10-03).
  ✅ (verified)
- **Containment interplay.** `verifyLiveBoundary` relaxes only the live-checkout surface under
  proven containment; provider-state drift always fails. Outcome 4 ("an operator edit to Pi
  config while a proven-contained dispatch runs behaves the same as for claude/codex today")
  therefore means it halts, with no new code path. ✅ (verified,
  `engine/self-host/live-boundary.ts` `verifyLiveBoundary`)
- **Worktree isolation.** No ports, databases or shared services. Homes live under the feature
  worktree's `.daemon/scratch`. ✅

## Alignment

- **Catalog ADR D1/D2.** `conductor.ts` still selects the isolation path with
  `provider.homeVariable === 'CODEX_HOME'`, `selectedAuthPaths` with a ternary, and Claude-only
  preflights with `preferredBuildProvider !== CODEX_PROVIDER`. `provider-home.ts` does the same
  for the `.agents/skills` link and `childEnv()`, and `live-boundary.ts` picks volatile lists by
  `environmentPrefix`. Under these, Pi would silently take Claude's branches: the build-token and
  `~/.claude` credential preflights, and a `.credentials.json` auth exclusion. That is the
  mis-branching D2 forbids. D24 moves the shape into the catalog. ✅
- **Symmetric isolation ADR §3.** The throwaway home holds only worktree-owned skills and the
  selected credential. It holds no operator settings, extensions, packages, trust list or sessions.
  ✅ (with D25)
- **Leak-detector caveat (live-boundary.ts header).** Pi's volatile list excludes only observed
  churn. `settings.json`, `trust.json`, `extensions/` and `npm/` stay fingerprinted, matching the
  precedent of Claude's `settings.json` and Codex's `config.toml`. ✅
- **Machinery over prompt.** The exhaustive volatile-list table (D24) turns "a provider with no
  volatile list halts every build", the failure class the intake cites, into a compile error. ✅
- **Event spine.** No new channel. Existing `self_host_boundary_fingerprint` and containment
  events carry Pi. Setup refusal uses the existing `ProviderSetupUnavailableError` path. ✅
- **Security boundary.** The key reaches only a mode-0600 file inside the throwaway home. It is
  never put in argv; the `ProviderHomeEnvironment.args` contract already forbids credential
  material. Diagnostics pass through `redactSafetyText`. ✅

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| Pi descriptor `selfHost: true` and the catalog self-host shape fields | Read by `prepareCandidateSelfHost` in `engine/conductor.ts`, by `provisionProviderHome` (`engine/self-host/provider-home.ts`) and by `fingerprintLiveBoundary` (`engine/self-host/live-boundary.ts`); all are reached from the daemon's candidate dispatch through `executeProviderCandidates` |
| `PiProvider.prepareSelfHostAuth` / `resolveSelfHostExecutable` | Wired through `engine/provider-runtime.ts`'s self-host seam into `provisionProviderHome`'s auth hook, the same as Codex |
| Pi entry in the exhaustive provider-state volatile table | `fingerprintLiveBoundary` → `verifyLiveBoundary` in each candidate's teardown |
| Catalog-derived child-env scrub (every provider-home variable plus declared extras) | `ThrowawayProviderHome.childEnv()` → `SelfHostInvocation.env` for every isolated candidate |
| Claude-only preflight selection (build token, operator credentials) | `runSelfHostStep` preflight block in `engine/conductor.ts` |

Advisory overlap scan over these paths: "No overlap detected; no open blockers."

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A Pi upgrade makes `print-api-key` write to the live home (for example a changelog stamp in `settings.json`) inside the fingerprint window | Integration | Low | Medium | Verified byte-identical on 1.0.0. The halt names the file, so recovery is a documented volatile-list widening with evidence |
| An OAuth-only built-in provider: `print-api-key` may not return a usable key | Integration | Medium | Low | Refused at setup with the provider named; a bearer-token path is out of scope |
| Pi reads `$HOME/.agents/skills` before `PI_CODING_AGENT_DIR/skills`, so operator-installed skills (live-checkout symlinks) can shadow worktree skills in a Pi self-build | Technical | Medium | Medium | Out of scope by operator boundary (Balanced excludes HOME-relative skills isolation). Recorded for follow-up intake; not a credential or state leak |
| The table-izing refactor changes Claude/Codex behavior | Technical | Low | High | Shape values reproduce today's branches exactly; existing Claude/Codex self-host tests stay green; the plan adds a parity test per provider |

## ADRs Created

None. Amended: `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` (D23–D26, additive,
operator-approved in this DECIDE session).

## Conditions

None.
