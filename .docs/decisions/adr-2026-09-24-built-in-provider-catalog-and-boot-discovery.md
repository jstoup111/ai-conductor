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

> **Amended 2026-09-28 by #1007:** The bare `ai-conductor compose` launcher is a consumer of this
> catalog. It stops spawning a hardcoded `claude`. D1 through D8 are unchanged; the decisions below
> add to them.
>
> D9. The launched session is an operator-hosted agent session under ADR-008. It is not engine
> provider dispatch, so adr-2026-08-24-one-dispatch-member-on-the-provider-contract's single
> `invoke` member does not govern it, and the adapters are not changed. D2 gains an
> `interactiveLaunch` capability, with the same fail-closed default: a descriptor
> that omits it is unsupported. A descriptor that declares it also supplies two things. The first is
> the argv for an interactive session that opens a named skill, optionally followed by an idea. Claude
> uses `--permission-mode «mode»` and `/«skill» [idea]`. Codex takes one positional initial prompt,
> `$«skill» [idea]`, and adds no sandbox or approval overrides, so the operator's own Codex
> configuration governs the session. The second is the env var names that mark a process already
> running inside that host's session: `CLAUDECODE` for Claude, and `CODEX_THREAD_ID` and `CODEX_SESSION_ID` for Codex. Claude
> and Codex declare the capability. Pi does not, so launching Pi is refused with the D2 refusal,
> naming the provider, `interactiveLaunch`, and #1007.
>
> D10. Launcher host selection takes the first source that is present:
> - an explicit `--provider «id»` flag;
> - the first entry of the provider selection that the launching directory's merged configuration
>   (user level plus project level) resolves for the `explore` step, whether it is a single value or
>   a fallback ladder. That selection is the step-level pin when one is present and the run-level
>   `llm_provider` otherwise, resolved through the existing provider-selection resolver.
> - `DEFAULT_PROVIDER`.
>
> `explore` is used because the composer session opens with it and hosts the whole DECIDE loop.
> Without this rule, a project that pins DECIDE to one host while its run-level ladder prefers
> another would launch the wrong host. An interactive, human-driven session never falls back to a
> later ladder entry. A name that is not a catalog id keeps today's unknown-provider error. The flag
> is accepted identically under the `compose` verb and its deprecated `engineer` alias.
>
> D11. The launcher does not run D3 boot discovery; D8's non-probing rule for `compose` still
> holds. It resolves only the selected host's executable through `resolveProviderExecutable`. A
> spawn failure because the executable is missing becomes an explicit error naming the provider,
> the executable, its override env var, and the in-session alternative (`/composer` or
> `$composer`). Before resolving a host, the launcher checks the session markers of every descriptor
> that declares `interactiveLaunch`. When it finds one, it refuses to nest. It tells the operator to
> run that host's in-session invocation, rendered with the host's own skill-invocation prefix.

> **Amended 2026-09-29 by #1885 (operator decision, James Stoup, composer DECIDE):** D6's
> sentence "Its model policy is a single-rung ladder that passes no `--model`, so Pi uses its own
> configured default" no longer holds. Pi now runs every step on an operator-configured model.
> Every other statement in D1–D11 is unchanged. Three decisions are added:
>
> **D12.** No new capability flag is added. Every built-in adapter already receives the resolved
> model and effort, so a flag would have no consumer. The Pi adapter passes the canonical Pi model id as
> `--provider <provider> --model <model>`, splitting it at the first `/`: the model part may itself
> contain `/` and `:`, as in `cline/google/gemma-4-31b-it:free`. It maps the harness effort to
> `--thinking` one-to-one (`low|medium|high|xhigh|max`) and never appends a `:thinking` suffix.
> Verified locally 2026-09-29 against pi 0.84.3: `--provider X --model Y` and `--model X/Y` resolve
> to the same provider and model, and an unknown provider exits 1 with `Unknown provider "…"`.
> With an explicit provider, an unknown model id is passed through to the upstream API rather
> than rejected by Pi.
>
> **D13.** Pi's built-in model policy ships no model ids. When pi appears anywhere in configuration
> (run-level `llm_provider`, a step's `llm_provider` or candidate ladder, or a build-review policy),
> `llm_providers.pi.model`, `llm_providers.pi.model_escalation_order` and
> `llm_providers.pi.model_fallback_ladder` are all required, and config validation fails naming
> each missing key. `llm_providers.pi.model` is Pi's native default: it is used by every Pi
> dispatch that has no step-level Pi model, including pi as a fallback candidate (per
> adr-2026-07-24's native-defaults-on-fallback rule). A Pi dispatch never falls through to
> `FALLBACK_MODEL`. Config load checks only the id's syntax: a non-empty provider segment, a `/`,
> a non-empty model segment, and no whitespace. On the provider-dispatching entry points of D8, and
> only after D3 discovery finds Pi installed, boot runs `pi --list-models` once through an
> injected runner guarded by `assertRealExecAllowed`. It then fails startup when a configured Pi
> id names a provider or a model absent from that listing, with distinct errors naming the id, the
> config path, and the step. Every configured Pi id is probed: step models, `llm_providers.pi.model`,
> and every escalation and ladder entry. Default-suite tests fake the runner.
>
> **D14.** D5's classification list gains a precedence rule for an exit-0 stream. When Pi's
> terminal assistant message has `stopReason: "error"`, the invocation fails and carries Pi's
> `errorMessage` rather than returning a successful empty result. Verified 2026-09-29: a missing API
> key ends with exit 0, `stopReason: "error"`, `errorMessage: "No API key for provider: cline"`. It
> stays an unclassified step failure until #2718 anchors the auth and rate-limit signatures.

> **Amended 2026-09-29 by #1886 (operator decision, James Stoup, composer DECIDE):** D6 lists
> `readOnlyReview` (renamed from `buildReviewContainment` by #2735) and `nativeSchema` among the
> capabilities Pi does not declare. Pi now declares both. Every other statement in D1–D14 is
> unchanged; in particular Pi still declares no `selfHost`, `reviewPolicyCatalog`, `writeFence`,
> `costSelfReporting`, `readiness`, or `interactiveLaunch`, and `osSandbox` stays `false`. OS write
> containment for unattended dispatches of any provider is out of scope and belongs to #2851. Four
> decisions are added. Pi facts below were verified locally 2026-09-29 against pi 0.84.3
> (`pi --help`, `docs/extensions.md`, `docs/json.md`, `docs/security.md`, and
> `pi-ai/dist/utils/validation.js`).
>
> **D15.** The harness ships one Pi extension as an engine asset. Its source is a string constant
> compiled into the engine bundle, since the engine build has no mechanism for copying non-TypeScript
> assets. The engine materializes it as a content-addressed file,
> `~/.ai-conductor/pi/harness-extension-«sha256 prefix».ts`. It writes atomically when the file is
> absent or its bytes differ from the constant, and re-verifies the bytes before every use. Pi loads
> it only through an explicit `-e «absolute asset path»`. The engine never writes it into `~/.pi` or
> a project `.pi/`. The file imports nothing,
> so it resolves no packages from the harness install. It registers its CLI flags with
> `pi.registerFlag` and registers a tool only when that tool's flag is present, so loading it with
> no harness flag registers no tools. Pi documents that explicit `-e` paths still load under
> `--no-extensions`, and that `--tools` applies to extension tools.
>
> **D16.** Pi declares `nativeSchema`. When an invocation carries a native output schema, the
> adapter writes the schema into the engine-owned native-schema scratch home and passes the
> extension a flag naming that file. The extension registers a `submit_result` tool whose
> `parameters` are that raw JSON schema and whose `execute` returns the arguments in `details`
> with `terminate: true`. This is Pi's documented structured-output pattern
> (`examples/extensions/structured-output.ts`). Pi validates tool arguments against a raw JSON
> schema and returns a validation error to the model on a mismatch, so the model can correct
> itself within the session. The adapter takes `finalStructuredResult` from the `details` of the
> last successful `submit_result` `tool_execution_end` event in the `--mode json` stream. An
> invocation that ends without one is a failed invocation naming the missing structured result,
> never a success. The engine's existing parse and validation of `finalStructuredResult` is
> unchanged.
>
> **D17.** Pi declares `readOnlyReview`. For the engine's read-only review option the adapter adds
> `--no-extensions`, `-na`, `--tools` naming only `read,grep,find,ls,git_read` (plus
> `submit_result` when D16 applies), `-e` for the D15 asset, and the flag that registers
> `git_read`. Pi's `bash`, `edit` and `write` tools are therefore unavailable, and no project or
> operator-global extension loads. `git_read` never runs a shell. It takes a subcommand from the
> same fixed read-only set Claude's read-only review admits (`show`, `diff`, `log`, `ls-tree`,
> `ls-files`, `cat-file`, `rev-parse`, `blame`, `grep`) plus an argv array. It refuses any argument
> that makes git write a file or run another program (output-file, pager, external-diff and
> textconv options), and it runs `git` with the pager and external-diff environment neutralized.
> adr-2026-09-10-portable-build-review-policy D5.3's input digest still detects and discards a
> lap if a write lands anyway. Read-only availability (that ADR's D5.5) is established by Pi's own
> mechanism: `pi --help` exits 0 and lists `--tools`, `--no-extensions`, `--extension` and
> `--no-approve`, and the D15 asset exists and is readable. A custom-policy lap still requires
> `reviewPolicyCatalog`, so Pi serves custom-policy laps only after #1888 turns it on.
>
> **D18.** Every unattended Pi invocation passes `-na`, so project-local `.pi/` settings,
> packages and extensions never load, even when `~/.pi/agent/trust.json` holds a saved trust
> decision for the directory. The operator can deliberately enable them for ordinary steps with
> `llm_providers.pi.trust_project_files: true` (boolean, default `false`). That key never
> applies to a read-only review invocation, which keeps D17's `-na`. Operator-global `~/.pi`
> extensions keep loading on ordinary steps, as operator-installed Claude plugins do. The Pi
> subprocess env gets the same daemon treatment as the codex adapter: the daemon-session marker is
> set, and the tmux variables are scrubbed. The harness launches no interactive Pi session (D9),
> so interactive operator use of Pi is unaffected.

> **Amended 2026-10-02 by #1889 (operator decision, James Stoup, composer DECIDE):** D5 says the
> adapter parses "the cumulative `usage` field", and D6 says Pi's cost is `cost-unmetered` and that
> `costSelfReporting` belongs to #1889. Both D5 and D6 statements are falsified. Pi 0.84.3 emits no
> top-level `usage` on any JSON-mode event. The `pi-agent-core` event union carries usage only on
> `message_end.message`, an `AssistantMessage`, as `message.usage`. That usage is per LLM call, not
> cumulative. Its `input` is fresh-only, with `cacheRead` and `cacheWrite` split out. It includes
> `cost.total`, which Pi computes from its model registry. The message also names the model that
> ran in `message.provider` and `message.model`. These facts were verified locally on 2026-10-02
> against `pi-ai/dist/types.d.ts` (`Usage`, `AssistantMessage`), `pi-agent-core/dist/types.d.ts`
> (the agent event union), `pi-ai/dist/models.js` (`calculateCost`) and
> `pi-ai/dist/api/openai-responses-shared.js` (fresh-input normalization). Every other statement in
> D1–D18 is unchanged, except the #1886 amendment's clause that Pi "still declares no
> `costSelfReporting`", which D22 replaces. Pi still declares no `selfHost`,
> `reviewPolicyCatalog`, `writeFence`, `readiness` or `interactiveLaunch`. Four decisions are added.
>
> **D19.** A **usage-bearing message** is a `message_end` event whose `message.role` is `assistant` or
> `toolResult` and whose `message.usage` carries finite numeric `input` and `output`. Only
> `message_end` counts. `message_start`, `message_update`, `turn_end` and `agent_end` repeat the same
> message and its usage, and are never summed. Pi's usage is the sum of `message.usage` over the
> run's usage-bearing messages. `input` maps to `TokenUsage.input`, `output` to `output`,
> `cacheRead` to `cacheRead`, `cacheWrite` to `cacheCreation`, and `reasoning`, when present, to
> `reasoningOutput`. The count of assistant `message_end` events maps to `numTurns`. When there is no
> usage-bearing message, or the summed `input`, `output`, `cacheRead` and `cacheWrite` are all zero,
> the adapter returns no `TokenUsage` at all. Pi reports all-zero usage on a failed turn (captured
> live 2026-10-02). It never zero-fills usage, so the dispatch is `unmetered` per
> adr-2026-07-27-cost-unmetered-is-a-first-class-state D6. A failed invocation (non-zero exit, or an
> error stop under D14) also returns no `TokenUsage`, as it does today. Pi itself totals usage the
> same way, per message (`pi-coding-agent/dist/core/usage-totals.js`).
>
> **D20.** A Pi dispatch's cost resolves in fixed precedence, all-or-nothing per dispatch. Here a
> message's **model that ran** is `message.provider` plus `message.responseModel` when present,
> else `message.model`, which is the key Pi's own usage totals use. Only usage-bearing messages with
> non-zero tokens need a price; a zero-token message contributes nothing.
> (a) When every such message reports a finite, positive `cost.total`, `TokenUsage.costUsd` is
> their sum and `costSource` is `'provider'`.
> (b) Otherwise, when every such message is an assistant message whose model that ran (the bare
> model part, without the provider) is priced by the committed rate card
> (adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot D1, extended here from
> codex to Pi), `costUsd` is the sum of `applyRateCard` over those messages and `costSource` is
> `'rate-card'`.
> (c) Otherwise `costUsd` stays absent and the dispatch is `cost-unmetered`. A `toolResult` message
> names no model, so if Pi gives it no price the dispatch falls to (c).
> A Pi `cost.total` of zero alongside non-zero tokens means Pi had no price for that model, so it is
> treated as absent, never as a real $0. A dispatch never sums a partial cost over only the messages
> that were priced. Pi's figure is reported by Pi from its own price list, as Claude Code's
> `total_cost_usd` is. It reuses `costSource: 'provider'`; a distinct label for Pi-computed figures
> is out of scope.
>
> **D21.** `TokenUsage` gains one optional field, `attributedModel`: the `provider/model` id of the
> model that ran (D20) on the last assistant usage-bearing message that names both a provider and a
> model. It is set whenever Pi's usage is present and some assistant message named both, including on
> a `cost-unmetered` dispatch, and is absent otherwise. Under D20(b) each message is priced by its own model that ran, so one unpriced
> message leaves the whole dispatch `cost-unmetered`. The field is additive under
> adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates D1. Existing consumers, including
> the cost rollup's `event.model` dimension and the committed `## Cost` block, are unchanged. Claude
> and codex do not set it. Consequently the cost rollup's per-step `model` dimension and the exported
> OTel `model` label for a Pi dispatch remain the requested model, and `attributedModel` is read from
> the persisted event when the model that ran is needed.
>
> **D22.** Pi declares `costSelfReporting`, and `PROVIDER_CAPABILITY_OWNERS` drops its
> `costSelfReporting: '#1889'` entry. The flag's only consumer, `COST_SELF_REPORTING_PROVIDERS`,
> excludes the provider from the `rate-card refresh` model list. Pi's built-in policy ships no model
> ids (D13), so that list is unchanged. D20's adapter-level rate-card fallback does not depend on
> the flag.
## Consequences

- Adding a fourth provider is one descriptor plus one adapter. The structural test fails if a new id literal appears elsewhere.
- A daemon on a machine without a configured provider no longer boots. It prints an actionable error instead of failing per dispatch. Release note category: Fixed.
- `CLAUDE_EXECUTABLE` becomes a supported override, for symmetry with codex.
- Until #1885–#1889 land, Pi cannot be selected for steps that require the undeclared capabilities, and the refusal names the capability.
