# Components: Live daemon E2E tier covers only Claude — no real-agent Codex signal

**Last updated:** 2026-08-12
**Scope:** To-be view for `live-daemon-e2e-tier-covers-only-claude-no-real-ag`
(jstoup111/ai-conductor#1264, Tier M, technical track). Gives the live daemon E2E tier a
second real-agent leg for Codex by parameterizing the run body over a provider descriptor,
making the `credentialed` smoke capability provider-aware so each leg's verdict is
independent, and adding a coverage guard so a registered `llm_provider` cannot ship without
a live leg.

## As-is: one file, one capability, one provider

```mermaid
graph TD
    subgraph Runner["src/engine/smoke-runner.ts — resolution is per FILE"]
        Disc["discoverSmokeFiles()<br/>globs test/**/*.smoke.test.ts"]
        Parse["parseSmokeCapabilityDeclaration()<br/>reads ONE `const smokeCapability` per file"]
        Res["resolveAdvisorySmokeFile / resolveGateSmokeFile<br/>one capability ⇒ one outcome per file"]
        Ledger["emitSmokeOutcomeLedger()<br/>one ran/skipped/failed line per file"]
        Disc --> Parse --> Res --> Ledger
    end

    subgraph Cap["src/engine/smoke-capability.ts"]
        Set["SMOKE_CAPABILITIES = hermetic | toolchain | credentialed<br/>(closed union — NO provider dimension)"]
        Cred["credentialed resolution:<br/>environment.CLAUDE_CODE_OAUTH_TOKEN<br/>HARDCODED in both advisory and gate"]
        Gate["assertGateCredentialedExecution()<br/>needs ≥1 credentialed file to have run"]
        Set --> Cred --> Gate
    end

    subgraph File["test/engine/daemon-e2e-live.smoke.test.ts (671 lines)"]
        Decl["const smokeCapability = 'credentialed'"]
        Skip["shouldRun = which claude && CLAUDE_CODE_OAUTH_TOKEN"]
        Body["describe.skipIf(!shouldRun)('daemon E2E with real Claude provider')<br/>new ClaudeProvider() · executable: 'claude'<br/>providerKey: 'claude' · preflight(home, 'claude')"]
        Decl --> Skip --> Body
    end

    subgraph CI[".github/workflows/live-daemon-e2e.yml"]
        Matrix["matrix.provider = [claude]<br/>DECORATIVE — parameterizes nothing"]
        Check["credential check step<br/>reads only CLAUDE_CODE_OAUTH_TOKEN"]
        Cmd["every leg runs the SAME `npm run smoke`"]
        Matrix --> Check --> Cmd
    end

    Rel["release.yml:124-127<br/>require_credentials: true ⇒ SMOKE_MODE=gate"]

    Cmd --> Disc
    Parse --> Decl
    Res --> Cred
    Rel --> Matrix
    Gap["GAP: a second provider has nowhere to declare<br/>its own credential, so its absence would fail the<br/>shared file and MASK the Claude verdict"]
    Cred -.-> Gap
    Decl -.-> Gap
```

The intake's hypothesis — "an additive matrix entry plus a credential variable" — holds at the
`provider-home.ts` layer (already provider-neutral) but **not** at the capability layer: the
`credentialed` capability has no provider dimension, and the workflow matrix parameterizes
nothing today.

## To-be

```mermaid
graph TD
    subgraph Desc["Provider descriptor (NEW — the single enumeration source)"]
        Manifest["LIVE_E2E_PROVIDERS<br/>id · provider factory · binary name<br/>credential env var · selfHost executable · providerKey<br/>expected auth source (uniform assertion input)"]
    end

    subgraph Body["Shared run body (NEW — extracted, parameterized)"]
        Shared["runLiveDaemonE2E(descriptor)<br/>seed fixture · provision home · preflight<br/>meter tokens · runDaemon · assert terminal state<br/>IDENTICAL claim-to-finish path for every provider"]
    end

    subgraph Legs["Per-provider smoke FILES (NEW split — one capability each)"]
        Claude["daemon-e2e-live-claude.smoke.test.ts<br/>smokeCapability = 'credentialed:claude'"]
        Codex["daemon-e2e-live-codex.smoke.test.ts<br/>smokeCapability = 'credentialed:codex'"]
    end

    subgraph Cap2["src/engine/smoke-capability.ts (CHANGED)"]
        Set2["SMOKE_CAPABILITIES gains per-provider<br/>credentialed members (still a closed union)"]
        Map2["credential env var resolved PER PROVIDER<br/>claude → CLAUDE_CODE_OAUTH_TOKEN<br/>codex → CODEX_API_KEY"]
        Gate2["assertGateCredentialedExecution()<br/>(CHANGED — every credentialed:«provider»<br/>must have run, not merely one of them)"]
        Set2 --> Map2 --> Gate2
    end

    subgraph Runner2["src/engine/smoke-runner.ts (UNCHANGED shape)"]
        Res2["per-FILE resolution ⇒ per-PROVIDER verdict<br/>a missing CODEX_API_KEY fails ONLY the codex file"]
        Led2["one ledger line per provider leg"]
        Res2 --> Led2
    end

    subgraph Guard["test/structural/ (NEW coverage guard)"]
        Enum["enumerate registry llm_provider ids<br/>(plugin-loader.ts: claude, codex)"]
        Assert["assert each id has a live leg + capability entry<br/>⇒ a new provider CANNOT ship uncovered"]
        Enum --> Assert
    end

    subgraph CI2[".github/workflows/live-daemon-e2e.yml (CHANGED)"]
        M2["matrix.provider = [claude, codex]<br/>NOW LOAD-BEARING"]
        C2["per-leg credential check<br/>reads that leg's credential env var only"]
        S2["per-leg step summary + diagnostics parity"]
        R2["per-leg smoke selection<br/>(leg runs only its own provider's file)"]
        M2 --> C2 --> R2 --> S2
    end

    Manifest --> Shared
    Manifest --> Claude
    Manifest --> Codex
    Manifest --> Assert
    Manifest --> Map2
    Claude --> Shared
    Codex --> Shared
    Claude --> Res2
    Codex --> Res2
    Map2 --> Res2
    R2 --> Res2

    Home["src/engine/self-host/provider-home.ts<br/>(UNCHANGED — already maps CODEX_HOME)"]
    Prov["src/execution/codex-provider.ts<br/>(UNCHANGED — prepareSelfHostAuth · readiness ·<br/>resolveSelfHostExecutable already implemented)"]
    Pre["test/fixtures/step-command-preflight.ts<br/>(UNCHANGED — already takes providerKey)"]
    Fix["test/fixtures/live-provider-home.ts<br/>(CHANGED — provider-parameterized, not Claude-defaulted)"]

    Shared --> Fix --> Home
    Shared --> Prov
    Shared --> Pre

    Rel2["release.yml (UNCHANGED call shape)<br/>require_credentials: true ⇒ both legs fail-closed"]
    Rel2 --> M2
```

## Component responsibilities

| Component | Status | Responsibility |
|---|---|---|
| `LIVE_E2E_PROVIDERS` descriptor manifest | NEW | The single place a provider's live-leg facts live: id, provider construction, binary name, credential env var, self-host executable, `providerKey`. Every other component derives from it rather than repeating a literal `'claude'`. |
| Shared parameterized run body | NEW | Holds the seed/provision/preflight/meter/`runDaemon`/assert sequence exactly once, so both legs provably drive the same claim-to-finish path. Extracted from the existing 671-line file without changing its assertions. |
| `daemon-e2e-live-«provider».smoke.test.ts` | NEW (Claude leg is a split of the existing file) | One thin file per provider declaring that provider's capability. File granularity is what makes verdicts independent — see the ADR on why this is not an in-file loop. |
| `src/engine/smoke-capability.ts` | CHANGED | The closed capability union gains per-provider credentialed members; credential resolution maps each provider to its own env var in both advisory and gate mode; the gate assertion requires every declared provider leg to have run, not merely one credentialed file. |
| `src/engine/smoke-runner.ts` | UNCHANGED | Its existing per-file discovery, resolution, ledger, and failure recording already deliver per-provider isolation once the split exists. No new channel, no second runner. |
| Provider-enumeration coverage guard | NEW | Reads the registered `llm_provider` ids and fails when one has no live leg or no capability entry. This is the deterministic mechanism behind desired outcome 5 — not a prompt-level or review-time reminder. |
| `test/fixtures/live-provider-home.ts` | CHANGED | Stops defaulting to a Claude `ResolvedSelfHostProvider`; takes the descriptor's provider and credential so the same fixture provisions either home. |
| `src/engine/self-host/provider-home.ts` | UNCHANGED | Already provider-neutral: `HOME_VARIABLE` maps `codex → CODEX_HOME`, and `childEnv()` already strips ambient `CODEX_HOME`/`CLAUDE_CONFIG_DIR`/`CLAUDE_CODE_OAUTH_TOKEN`. |
| `src/execution/codex-provider.ts` | UNCHANGED | Already implements `resolveSelfHostExecutable`, `prepareSelfHostAuth` (emits `CODEX_API_KEY`), and `readiness`. The leg consumes these; it does not modify dispatch behavior. |
| `test/fixtures/step-command-preflight.ts` | UNCHANGED | Already accepts a `providerKey` and renders `$name` versus `/name` per provider. The Codex leg passes `'codex'`. |
| `.github/workflows/live-daemon-e2e.yml` | CHANGED | The matrix becomes load-bearing: each leg checks only its own credential, runs only its own provider's smoke file, and emits its own step summary and failure diagnostics. |
| `.github/workflows/release.yml` | UNCHANGED | Keeps calling the tier with `require_credentials: true`. Once `CODEX_API_KEY` exists as a repository secret, the Codex leg becomes a real fail-closed release gate alongside Claude. |

## Boundaries this work does not cross

- **No change to production dispatch.** Nothing in `plugin-loader.ts`, `step-runners.ts`, or
  either provider's `invoke` path changes. This is harness coverage, not runtime behavior.
- **No new assertion on agent behavior.** `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`
  still governs both legs: terminal state, committed artifacts, token cap. Codex is held to the
  same outcome assertions as Claude, never to a Codex-shaped script.
- **No second telemetry or reporting channel.** Per-provider outcomes ride the existing smoke
  ledger and the existing GitHub step summary. No sidecar file, no parallel log.
- **No general live-tier framework.** The extraction is scoped to the daemon E2E run body; it
  does not become a reusable harness for other smoke files (excluded by the operator's scope
  boundary).
- **No relaxation of the release gate.** The Claude leg keeps its current fail-closed behavior
  unchanged; the Codex leg is added at the same strictness rather than as a tolerated advisory.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-12 | Initial generation | To-be view for the Codex live-leg spec (#1264) |
| 2026-08-12 | Descriptor carries each provider's expected authentication source | Plan-update. Resolves the conflict-check oscillation between the provider-agnostic shared body and the Codex auth-source assertion: the assertion becomes uniform and descriptor-driven rather than a provider name test |
