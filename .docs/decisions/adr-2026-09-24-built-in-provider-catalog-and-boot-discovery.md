# ADR: One built-in provider catalog, boot-time provider discovery, and Pi as a third built-in

**Date:** 2026-09-24
**Status:** APPROVED
**Approved:** James Stoup, 2026-09-24
**Deciders:** James Stoup (operator); composer session for jstoup111/ai-conductor#1884
**Scope:** Built-in `llm_provider` registration, the provider identity type, boot-time installation discovery, and the Pi adapter's dispatch and failure contract. Out of scope, owned by sibling intakes: Pi self-host isolation (#1887), containment (#1886), model selection (#1885), skills and context (#1888), cost telemetry (#1889), and e2e/smoke parity (#1890).

## Context

The engine registers two built-in providers by hand (`engine/plugin-loader.ts` `registerBuiltins`). About 60 production sites encode the pair directly. Some are `'claude' | 'codex'` unions. Others are `=== 'codex'` branches, keyed tables (`execution/child-environment.ts` env prefixes, `engine/provider-model-policy.ts` `BUILT_IN_PROVIDER_MODEL_POLICIES`, `engine/live-e2e-providers.ts`, the self-host volatile-state tables), or executable selection (`CODEX_EXECUTABLE`, read independently in `codex-provider.ts` and `step-runners.ts`). Adding a third provider means editing every one of these sites. Missing any site is a silent wrong-branch bug: a non-claude provider falls into a claude or codex default.

No LLM provider executable is checked at boot. A missing binary is discovered only at dispatch time, as exit 127 or ENOENT, and becomes `providerUnavailable` with run scope. So a daemon configured for an uninstalled provider boots, claims work, and fails or falls back per step. The `validateRegisteredProviderSelections` unknown-provider error (`engine/provider-selection.ts`) already fails fast at startup for a name nothing registered.

Pi (`@earendil-works/pi-coding-agent` 0.84.3) supports one-shot headless runs: `pi -p`, `--no-session`, and a JSONL event stream from `--mode json`.
- **Verified locally 2026-09-24:** `--version` prints `0.84.3`. An unknown `--model` exits 1 with plain stderr `Error: Model "…" not found. Use --list-models to see available models.` and emits no JSON event.
- **Unverified:** auth-failure and rate-limit output shapes.

Governing ADRs reused, not duplicated:
- adr-2026-07-24-provider-aware-step-execution-fresh-session-scope
- adr-2026-07-27-codex-never-resumes-a-harness-minted-session
- adr-2026-07-03-reactive-model-fallback-ladder
- adr-2026-07-04-auth-failure-park-and-poll
- adr-2026-07-30-provider-preparation-lifecycle-supervision
- adr-2026-08-24-one-dispatch-member-on-the-provider-contract
- adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope
- adr-2026-08-12-live-provider-coverage-from-plugin-registry
- adr-2026-09-05-gh-cli-version-floor-and-environment-gate (injectable, `assertRealExecAllowed`-guarded version probe)
- adr-2026-07-20-ci-fix-startup-preflight-and-error-classification, whose 2026-09-11 amendment forbids a Claude-only startup veto

## Options Considered

### Option A: Add Pi to each hardcoded site
- **Pros:** Smallest diff per site.
- **Cons:** It hardcodes three providers instead of two, so every later provider repeats the sweep. The operator rejected it.

### Option B: Pi as an external plugin
- **Pros:** No engine type changes.
- **Cons:** Plugins are excluded from readiness recovery (`provider-runtime.ts` `readinessFor` requires `builtIn`) and from self-host isolation. It fails #1884's fallback and classification outcomes and dead-ends #1887.

### Option C: One descriptor catalog with derived types and capability flags, plus boot discovery (chosen)
- **Pros:** A single source of truth. Adding a provider becomes one descriptor plus an adapter. Consumers narrow by capability, so an unsupported path refuses by name instead of mis-branching.
- **Cons:** A wide mechanical refactor of about 60 sites, and a stricter boot.

## Decision

D1. Add `execution/provider-catalog.ts` exporting `BUILT_IN_PROVIDERS`, a readonly descriptor table. It is the only place a built-in provider id is written. Each descriptor declares:
- `id`
- an adapter factory
- its executable (the default name and the override env var: `CODEX_EXECUTABLE` for codex, and new `CLAUDE_EXECUTABLE` and `PI_EXECUTABLE`)
- the version-probe argv
- its env-prefix namespace
- its provider-home variable and default home directory, where the provider has one
- its model policy
- capability flags

`BuiltInProviderId` is derived from the table's ids. `DEFAULT_PROVIDER` is a single named constant in the catalog. Every former `'claude' | 'codex'` union, `=== '<id>'` branch, and id-keyed table in production source becomes one of three things: a catalog lookup, a derived type, or a capability-narrowed type. No production file other than the catalog and each provider's own adapter module may name a built-in provider id literal. A structural test enforces this, with a named allowlist limited to user-facing display strings that the catalog supplies.

D2. Capability flags are explicit booleans with fail-closed defaults: an absent flag means unsupported. The flags cover the provider-specific behaviors the audit found:
- `readiness`
- `selfHost`
- `buildReviewContainment`
- `reviewPolicyCatalog`
- `supportsSessionResume` (always false, per adr-2026-07-27)
- `costSelfReporting`
- `writeFence`
- `nativeSchema`

A consumer that needs a capability receives a `ProviderWith<cap>` type. When handed a provider lacking the capability, it refuses with an error that names the provider, the missing capability, and the owning path. It never falls through to another provider's branch. Claude and codex declare exactly the capabilities they exercise today, so their behavior is unchanged.

D3. Boot-time discovery (`engine/provider-discovery.ts`) runs once, before `registerBuiltins`, in both boot paths: daemon `runDaemonMode` and CLI `registerCliBuiltins`. For each descriptor it:
1. Resolves the executable (the override env var, else `PATH`).
2. Runs the descriptor's version argv through an injected runner guarded by `assertRealExecAllowed`, the same shape as the gh version floor.

The result is an `installed` set plus a `missing` set with a reason: `not-found`, `not-executable`, `version-failed`, or `timeout`. Only installed descriptors are registered. Discovery emits one event on the existing event spine carrying both sets. It is a new `ConductorEvent` variant, not a side log.

D4. Configuration that names a known built-in id that is not installed, at run level, per step, or as any fallback-ladder entry, fails startup. The error names the provider, the config path, and the discovery reason, and it is worded distinctly from the existing unknown-provider error. A name that is neither a catalog id nor a registered plugin keeps today's unknown-provider error. This deliberately differs from the park-and-wait shape of the gh floor and credential gates. A missing provider binary is a static machine-configuration fault that no amount of waiting fixes. The operator classifies it as a bug fix with better UX, not a breaking change. It generalizes the Claude-only probe the ci-fix amendment removed, and does not reinstate it: the probe is catalog-driven and provider-neutral.

D5. The Pi adapter (`execution/pi-provider.ts`) implements only `invoke` (adr-2026-08-24). Each invocation runs `pi -p --no-session --mode json` with the prompt on stdin, so every call is a fresh session and `supportsSessionResume` is false. It parses the JSONL stream for the terminal assistant message and the cumulative `usage` field. It declares `lifecycleCapability.synchronousSpawnPermit` (adr-2026-07-30). Failure classification follows the codex adapter's precedence:
- ENOENT or exit 127 → `providerUnavailable`, run scope.
- The verified unknown-model stderr signature → `modelUnavailable`.
- Anchored auth and rate-limit signatures → `authFailure` / `rateLimited`. Auth is evaluated before model availability, per adr-2026-07-04.
- Any other non-zero exit → an ordinary step failure.

Signatures that are unverified at DECIDE time must be confirmed against real Pi output before they are anchored. Until confirmed, such a failure stays an unclassified step failure rather than being guessed into a signal.

D6. Pi's descriptor declares no `selfHost`, `buildReviewContainment`, `reviewPolicyCatalog`, `writeFence`, `nativeSchema`, `costSelfReporting`, or `readiness` capability. Those belong to #1885–#1889, which turn them on. Its model policy is a single-rung ladder that passes no `--model`, so Pi uses its own configured default. Its cost is `cost-unmetered` (adr-2026-07-27-cost-unmetered-is-a-first-class-state).

D7. `engine/live-e2e-providers.ts` is keyed by catalog ids. Per adr-2026-08-12, Pi gains a descriptor entry and a minimal credential-gated live smoke leg, so the registry-coverage test stays satisfied. That test enumerates the full catalog, not the providers discovered as installed on the test machine. Default-suite tests exercise Pi only through a fake subprocess.

D8. Order and scope of the startup check. Validation of configured provider names runs in two steps. First, a name that is a catalog id but was not discovered as installed raises the not-installed error. Only after that does the existing registered-provider validation raise unknown-provider for names that are neither a catalog id nor a registered plugin, and its available-names list shows installed providers only. Discovery and the fail-fast check run only at entry points that dispatch provider work: daemon start, `conduct` runs, and other subcommands that invoke a provider. Subcommands that never dispatch a provider do not probe executables and do not fail on missing ones. This covers, for example, `rate-card refresh`, `overlap-scan`, `render-diagrams`, and the `compose` registry and land primitives. It also covers any subcommand CI runs on a runner without provider CLIs. The default test suite never depends on which provider binaries the machine has installed.


> **Amended 2026-09-24 by #2735:** D2 and D6 name a `buildReviewContainment` capability. #2735
> (adr-2026-09-10-portable-build-review-policy D5.1–D5.5) retires bubblewrap review containment and
> replaces it with each provider's read-only review mode, which custom-policy build_review laps
> require. The flag is therefore named `readOnlyReview`: a provider declares it when its adapter maps
> the engine's read-only review option to a native read-only mode. Claude and Codex declare it; Pi
> does not. Its consumer is the custom-policy read-only review admission check, which now owns the
> refusal that `build-review-containment.ts` used to. Every other statement in D2 and D6 is
> unchanged.

## Consequences

- Adding a fourth provider is one descriptor plus one adapter. The structural test fails if a new id literal appears elsewhere.
- A daemon on a machine without a configured provider no longer boots. It prints an actionable error instead of failing per dispatch. Release note category: Fixed.
- `CLAUDE_EXECUTABLE` becomes a supported override, for symmetry with codex.
- Until #1885–#1889 land, Pi cannot be selected for steps that require the undeclared capabilities, and the refusal names the capability.
