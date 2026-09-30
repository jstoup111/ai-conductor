# Architecture Review: Pi runs stay contained despite Pi having no permission model (#1886)
**Date:** 2026-09-29
**Mode:** Lightweight (Tier M): §2 Feasibility and §4 Alignment
**Input:** explore output and the operator-confirmed scope in `.docs/track/pi-runs-stay-contained-despite-pi-having-no-permis.md` (technical track, no PRD)
**Verdict:** APPROVED WITH CONDITIONS

## Scope as reviewed

As the operator decided on 2026-09-29, Pi declares two capabilities and its unattended dispatches are hardened:

- `readOnlyReview` is declared. It is implemented as a tool allowlist plus a harness extension that adds a shell-free `git_read` tool.
- `nativeSchema` is declared. It is implemented as a terminating `submit_result` tool in the same extension. It was added during this review because the review found that `readOnlyReview` alone is inert (see Feasibility).
- Unattended dispatches get `-na` by default, with an opt-in through `llm_providers.pi.trust_project_files`.
- Pi gets the codex env treatment.
- Claim-audit correctness for Pi is covered by tests.

OS write-containment for every provider is out of scope and belongs to #2851.

## Feasibility

| Check | Finding | Confidence / basis |
|---|---|---|
| Stack compatibility | No new npm dependency. The extension is a dependency-free file that Pi loads through jiti (Pi `docs/extensions.md:179`). It uses a raw JSON schema, so it needs no `typebox` import. | 95%, verified in the docs and in `pi-ai/dist/utils/validation.js:280-308`, which has an explicit non-TypeBox branch |
| Explicit `-e` under `--no-extensions` | "Disable extension discovery (explicit -e paths still work)" | 98%, verified in `pi --help` (0.84.3) |
| `--tools` gates extension tools | "Applies to built-in, extension, and custom tools" | 98%, verified in `pi --help` |
| Structured output via a tool | Pi's own `examples/extensions/structured-output.ts` uses `terminate: true`. `--mode json` emits `tool_execution_start` with args and `tool_execution_end` with its result (`docs/json.md:49-51`). A validation failure throws back to the model. | 90%, verified in the docs and source. That a live model reliably calls the tool is inferred, and it is covered by the fail-closed rule in D16. |
| `-na` covers saved trust | Non-interactive modes honor a saved `trust.json` decision. `-na` overrides it for the run (`docs/security.md:18,29`). | 95%, verified in the docs |
| `readOnlyReview` alone is inert | Every rubric-contract invoke requests `nativeSchema` (`engine/step-runners.ts:809`). Without that capability, the member settles `native-schema-unsupported` (`engine/provider-execution.ts:378-386`). | 100%, verified in the code. This is why `nativeSchema` was added (operator decision). |
| Custom-policy laps need `reviewPolicyCatalog` | `preparedCandidateOperation` requires both `readOnlyReview` and `reviewPolicyCatalog` (`engine/step-runners.ts:3218-3230`), and the latter is owned by #1888 (open). | 100%, verified in the code. Pi serves custom laps only after #1888, while built-in rubric members and `architecture_review_as_built` gain Pi through `nativeSchema` now. |
| Claim audit | `PROVIDER_OS_SANDBOX` is derived from catalog `osSandbox` (`engine/self-host/environment-claim-audit.ts:87-89`), and Pi is `false` (`execution/provider-catalog.ts:158`). No code change is needed, only test coverage. | 100%, verified in the code |
| Prerequisites | `llm_providers.pi.trust_project_files` extends the `llm_providers` block that #1885 introduces (spec merged, build pending). #1885 also edits the Pi argv in `pi-provider.ts`. | Verified: #1885 plan Task 5 creates `llm_providers`. **Condition C1.** |
| Worktree isolation | No ports, DBs or shared state. The schema file goes in the existing engine-owned native-schema scratch home (`codex-provider.ts:650` precedent). | Verified |

## Alignment

- **Governing ADRs reused, with no new ADR.** Provider capability flags and the Pi descriptor are governed by `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` (D2, D6). The review role's read-only-mode contract is governed by `adr-2026-09-10-portable-build-review-policy` D5.2–D5.5. The structural addition is harness code that runs inside a provider's runtime, recorded as an additive amendment to the catalog ADR: D15 (the asset), D16 (`nativeSchema`), D17 (`readOnlyReview`), and D18 (unattended hardening). The portable-policy ADR is not edited: D5.2 already admits any provider whose adapter maps the option to a native read-only mode, and D5.5's "provider's own mechanism" probe is satisfied by D17's Pi probe.
- **Pattern consistency.** The Pi read-only mode mirrors Claude's: a tool set and the same nine git subcommands (`claude-provider.ts:40-50`). The probe mirrors Claude's `--help` flag check (`engine/build-review-read-only-capability.ts:100-112`). The env treatment reuses `withDaemonSessionMarker` and `scrubTmuxEnvironment` from the codex adapter (`codex-provider.ts:1039-1053`). Capability flags stay catalog booleans, and no provider id literals are added outside the catalog.
- **Local pattern basis (structured output).** Codex's native-schema path is the precedent (`codex-provider.ts`, `nativeSchemaScratchHome`). Its role: engine-owned scratch holds the schema file handed to the provider. Material traits to keep: the engine owns the file, the adapter returns `finalStructuredResult`, and a missing structured result fails the invocation. Allowed variation: Pi receives the schema through an extension flag rather than a CLI schema option. Rediscovery hints: `nativeSchemaScratchHome`, `finalStructuredResult`, and `unsupportedNativeSchemaProviderResult`.
- **Security boundaries.** `git_read` is a new input boundary, since model-supplied argv reaches `git`. It must refuse options that write files or spawn programs (`--output`, `-O`/`--open-files-in-pager`, `--ext-diff`, `--textconv`, and any `-c`-style config injection), and run without a shell and with the pager neutralized. D5.3's input digest remains the backstop. **Condition C2.**
- **Diagram.** `.docs/architecture/pi-runs-stay-contained-despite-pi-having-no-permis.md` covers the components and the review sequence. It was updated for `submit_result`.
- **Domain integrity.** The `git_read` subcommand is a closed enum, not a free string. `trust_project_files` is a boolean with a single meaning, and there are no tri-state flags.

## Wiring Surface

| Surface | Production caller (design-time) |
|---|---|
| Pi descriptor `capabilities.readOnlyReview` / `nativeSchema` | Read by `requireProviderCapability`/`supportsProviderCapability` in build-review admission (`step-runners.ts` `preparedCandidateOperation`) and native-schema candidate filtering (`providerRuntimes.nativeSchemaCapabilityFor`). |
| Pi adapter read-only review argv, `-na`, env | Pi's `invoke`, reached through the provider-execution candidate dispatch for every Pi step. |
| Pi adapter `nativeSchemaCapability` + `finalStructuredResult` | Rubric-contract invoke (`step-runners.ts:809`) and `architecture_review_as_built` (`step-runners.ts:1187-1247`). |
| Harness Pi extension asset (`git_read`, `submit_result`) | Loaded by the `pi` process through the `-e` path the Pi adapter passes. Its source is a TS string constant in the engine bundle, so tsup ships it with no copy step, because `scripts/publish-engine.mjs` has no asset copy. It is materialized content-addressed under `~/.ai-conductor/pi/` (the `~/.ai-conductor/rate-card.json` precedent in `execution/rate-card.ts`) before each use by the adapter and the read-only probe. **Condition C3.** |
| Pi branch of `probeReadOnlyReviewCapability` | Existing daemon-start and config-load probe callers (`index.ts`, `daemon-cli.ts`). |
| Config key `llm_providers.pi.trust_project_files` | `CONFIG_CONSUMER_KEY_SETS` with consumer pi-provider, and the resolved config passed to the Pi adapter. |

Early overlap scan (`ai-conductor overlap-scan` over pi-provider.ts, provider-catalog.ts, build-review-read-only-capability.ts, engine/config.ts, types/config.ts): "No overlap detected; no open blockers." #1885's pending build is a spec dependency, not an open branch yet (C1).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A model ends a Pi review without calling `submit_result` | Integration | Medium | Medium | D16 fails the invocation, and the existing retry and fallback machinery handles it. The tool description says to call it last. |
| A git option not on the denylist writes or executes | Security | Low | High | Closed subcommand enum, no shell, a denylist covering the output, pager, ext-diff, textconv and config-injection families, a neutralized env, and D5.3 digest discard as the backstop. Tests cover each refused family. |
| Pi coerces arguments (`Value.Convert`) before `execute` | Integration | Low | Low | Engine re-validation of `finalStructuredResult` is unchanged. |
| A Pi flag or extension API change in a later version | Integration | Medium | Medium | The D17 probe checks the flags at daemon start. Default-suite tests fake the Pi subprocess. The asset is tested by loading it into a fake `ExtensionAPI` in-process. |
| Merge collision with #1885's argv changes | Integration | High (sequencing) | Low | C1: build after #1885. |

## ADRs Created

None. Amended: `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` (additive D15–D18, 2026-09-29, operator decision).

## Conditions

- **C1.** #1886 is `blocked_by` #1885. The plan assumes `llm_providers` and #1885's Pi argv (`--provider/--model/--thinking`) already exist on main.
- **C2.** `git_read` has negative-path tests for every refused option family and for a non-enum subcommand. It spawns `git` without a shell.
- **C3.** The extension asset ships inside the engine bundle as a source constant and is materialized to a content-addressed file verified before each use. It works from an installed engine and from a source checkout, and it never writes into the source tree.
