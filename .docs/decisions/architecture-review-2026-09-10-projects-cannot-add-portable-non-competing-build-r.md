# Architecture Review: Portable, non-competing build review policy

**Date:** 2026-09-10
**Mode:** Full pre-stories review, product track / Large tier
**Inputs:** Approved PRD with FR-1–FR-17; six operator-approved architecture diagrams; confirmed scope and approach A
**Stories / plan:** Not yet authored; this pass grades the approved requirements.
**Technical verdict:** APPROVED WITH CONDITIONS
**Operator gate:** Approved by James Stoup on 2026-09-10, including the containment and policy-compatibility trade-offs in `adr-2026-09-10-portable-build-review-policy`. Required adjacent ADR amendments are applied; the remaining conditions govern stories and BUILD.

## Executive assessment

The selected approach is feasible using the current TypeScript/Node engine and existing provider, rubric, and case/effect machinery. Three extensions are essential: bind discovery and cache operations to the actual prepared candidate; adapt installed policy content into the read-only review role; and make the existing adjudicator express consistency and decision escalation on every custom-policy execution path.

The largest operator-visible trade-off is containment. The first proposed backend supports custom-policy laps on Linux with a verified bubblewrap boundary. Other platforms fail explicitly until they have equivalent containment. Built-in-only projects retain their existing execution path while receiving the effective-policy cache correction. The private Kotlin example could not be read because GitHub requires organization SSO; compatibility with that specific package is unverified and is not silently assumed.

## Feasibility

| Concern | Finding and design consequence |
|---|---|
| Stack | Existing Node filesystem, hashing, subprocess, provider invocation, and typed result machinery suffice. No new hosted service, database, model provider, or lifecycle step is required. |
| Installed discovery | Codex's locally generated protocol defines `skills/list` with paths, enabled state, plugin ownership, and errors. Claude's installed-plugin JSON exposes enabled state, scope, version, and installation path. Normalize these through provider adapters; do not share raw host formats. |
| Candidate preparation | `executeAuxiliaryProviderCandidates` reaches actual-candidate preparation inside the shared candidate loop. Introduce a typed operation there; preserve existing supervision and teardown rather than a second fallback implementation. |
| Read-only execution | Current transports are not a read-only review boundary. The proposal adds an explicit custom-review capability and requires a two-sided probe. A disposable local probe verified that bubblewrap denied modifying its read-only sentinel. This does not prove full provider integration; integration acceptance remains required. |
| Policy compatibility | Standard instruction/resource skills can be adopted under an explicit review role without source edits. Required runtime actions unavailable in that role fail; no claim of universal compatibility with arbitrary automation. |
| State | Extend current evidence, cache, case, and effect formats. Legacy cache entries miss lazily; existing built-in accepted risk and legacy remediation parse behavior remain. Persisted custom descriptors outlive current configuration membership. |
| Integration breadth | Configuration, provider preparation/transports, source/policy materialization, result identity, caching, adjudication, both conductor modes, event consumers, and docs are affected. This is correctly Large. |
| Performance | Catalog reads and content hashing add local I/O. Bound package enumeration and reviewer/adjudicator context. Disabled rubrics skip discovery; cache hits skip judgment. Preserve capped fan-out and avoid an all-pairs conflict model fan-out. |
| Worktree isolation | Runtime material and evidence belong to the feature; reviewer scratch belongs to a candidate. No global plugin changes, shared writable review state, service ports, or database namespaces are introduced. |

## Complexity

One coherent Large feature is retained because policy identity and aggregate authority are jointly necessary for correctness. Splitting implementation into independent authorities or shipping custom findings before adjudication would violate the approved outcome. Plan tasks should separate parsers, candidate lifecycle integration, evidence/cache, read-only execution, and aggregate routing while keeping each boundary's tests with its owner. The existing adjudication implementation is reused, not rebuilt.

## Alignment and governing decisions

| Governing decision | Application / required resolution |
|---|---|
| `adr-2026-08-22-build-review-opt-in-rubric-container` | Preserve default-off built-in, retired-key behavior, empty PASS, and no rubric plan growth. Amend closed catalog membership explicitly. |
| `adr-2026-08-21-engine-identity-in-build-review-cache-key` | Preserve engine stamp and distinct miss causes; amend harness-root/once-per-dispatch policy identity to actual-candidate complete bundle identity. |
| `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` | Keep fresh sessions, native candidate settings, fallback eligibility, and candidate-local credentials. |
| `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` | Retain the sole `invoke` member. Review options and metadata operations do not add another model-dispatch API. |
| `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` | One shared policy contract with host-owned discovery/invocation seams. Full resolved content delivery is limited to build review; ordinary lifecycle token rendering remains. |
| `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` | Reuse one `remediate`, complete prior cases, exact operator dispositions, mixed content/infrastructure handling, suppression, and bounded effects. Amend v2 semantic consistency/escalation and custom-policy attended routing. |
| `adr-2026-08-22-one-owner-per-review-question` | Review policies cannot select new architecture, claim product completion authority, or append to plans. Explicitly add custom-question handling through the existing owner. |
| Content anchors and engine-stamped envelope decisions | Preserve `testQuality` as its own parser/projection; introduce a separate versioned generic custom contract without loosening its vocabulary. |
| Event-spine repository contract | Occurrences extend the existing union/sinks. Policy bundles and verdict/case artifacts are state, not new telemetry readers. |

### Focused local pattern basis

The existing candidate loop is the precedent for provider fallback: native resolution, fresh sessions, preparation within safety supervision, and unconditional teardown are material traits. Its variation here is an optional cache-aware operation after preparation. Rediscovery seeds are `provider-execution.ts` / `executeAuxiliaryProviderCandidates` and `invokeProviderCandidate`; a second candidate loop is outside this basis.

The existing `RemediationCaseStore` and action effects are the precedent for restart-safe authority: one leased filesystem store, atomic state replacement, engine-stamped effect identity, idempotent publication/charge, and fail-closed recovery. Extend these schemas and consumers rather than adding a custom-policy ledger. Semantic case matching remains judgment. Source seeds are `remediation-case-store.ts`, `remediation-case-effects.ts`, and `build-review-work-order.ts`.

The self-host containment wrapper is evidence of an available OS composition seam, not a reusable bind policy: `deriveBindSet` intentionally grants feature-worktree writes. The custom-review bind policy must be separate and narrower; it must not modify the self-host exclusion contract. No suitable existing production read-only reviewer profile was found in the two provider transports.

## Domain Integrity

- Construct validated `CustomRubricId`, semantic skill reference, installed descriptor, effective bundle identity, and candidate-bound review identity at their boundaries. Avoid passing an arbitrary string directly to filesystem path construction.
- Use discriminated resolved/disabled/missing/ambiguous/unsupported/failed catalog outcomes and judged/skipped/infrastructure result kinds. No boolean `loaded` field serves as a substitute for effective-policy evidence.
- Keep current and producing provenance distinct on cache hits. Temporary paths and timestamps never create semantic cache identity.
- Persist complete custom descriptors with evidence so removing configuration does not make existing cases unreadable.
- Add explicit consistency and escalation states to the existing case protocol; no fake BUILD task or empty deferral stands in for a decision stop.
- Mechanical checks validate identities, completeness, graph legality, bounds, and replay. The model owns conflicting meaning and scope admission, with typed output and retained evidence.
- Production DI uses existing filesystem-backed stores and real metadata/provider adapters. Fakes are confined to tests.

## Wiring Surface

| Surface | Production caller and purpose |
|---|---|
| `types/config.ts`, `engine/config.ts`, `engine/resolved-config.ts` | Existing configuration loader constructs validated custom declarations and execution policy; rejects retired/reserved collisions and disabled adjudication with enabled custom members. |
| `engine/build-review-registry.ts` and new review-policy descriptor/resolver modules | Existing build-review runner constructs the effective lap catalog; provider candidate preparation invokes the source adapter before cache access. |
| `execution/llm-provider.ts`, `execution/claude-provider.ts`, `execution/codex-provider.ts` | Existing `invoke` consumes resolved review content and a typed read-only profile; metadata adapters supply host-specific installed descriptors. No alternative model dispatch entrypoint. |
| `engine/provider-execution.ts`, `engine/step-runners.ts` | Existing auxiliary candidate loop invokes prepare/resolve/lookup/judge/write/teardown in order. Built-in and custom identities use the actual candidate. |
| `engine/build-review-inputs.ts` and new review-containment/materialization modules | Existing input preparation makes the immutable source view for custom-policy laps; the candidate boundary proves read-only and private writable surfaces before invocation. |
| `engine/build-review-domain.ts`, `engine/build-review-projections.ts`, `engine/build-review-coordinator.ts`, `engine/build-review-aggregate.ts` | Catalog-selected parsers and projections validate every branch and retain raw source evidence; built-in rules remain specialized. |
| `engine/build-review-cache.ts`, `engine/build-review-artifacts.ts`, `engine/build-review-dispositions.ts` | Existing cache/artifact/operator-disposition operations understand effective identity and historic custom descriptors; same-named changed policy cannot borrow stale evidence or operator approval. |
| `engine/build-review-adjudication-context.ts`, `engine/remediation-case-artifact.ts`, `engine/remediation-case-validator.ts`, `skills/remediate/SKILL.md` | Existing adjudication dispatch carries policy/question/scope context and parses v2 consistency, admission, and escalation. |
| `engine/build-review-adjudication-coordinator.ts`, `engine/build-review-adjudication.ts`, `engine/conductor.ts` | Shared custom-review outcome operation reaches existing adjudication once in attended and daemon modes; existing navigation/checkpoints consume one typed durable result. |
| `engine/remediation-case-store.ts`, `engine/remediation-case-effects.ts`, `engine/build-review-work-order.ts`, `engine/kickback-ledger.ts` | Existing leased replay/effect owners carry new custom identities and decision stops while preserving charges and attempt evidence. |
| `types/events.ts`, `engine/event-sinks.ts`, existing event persister/renderers | Existing emitter and consumers carry policy provenance, misses, failures, consistency, and escalation. New metadata subprocess lifecycle is observed through the existing event path. |
| `README.md`, `docs/reference/configuration.md`, `docs/guides/multiprovider.md`, affected review guidance | Update the README and affected consumer guides with selection and supported review mode, host prerequisites, diagnostics, evidence, and recovery. |

The advisory overlap scan completed successfully over the central existing paths. It reported `origin/spec/daemon-self-host-guardrails` overlapping `src/conductor/src/types/config.ts`. This is an integration watchpoint for BUILD, not a blocker or permission to modify that branch. The scanner cautions that renames or name-only diffs may not be detected.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation / acceptance condition |
|---|---|---|---|---|
| A package requires incompatible standalone automation | Integration | Medium | High | Explicit review-policy contract and unsupported result; no silent empty PASS. Private motivating package remains unverified. |
| Candidate inventory is partial or changes during loading | Data | Medium | High | Typed metadata errors, unique selection, immutable captured bytes, source-change detection, and fail-closed loading. |
| Read-only containment blocks host bookkeeping or is unavailable | Technical | Medium | High | Private provider state plus two-sided and nested-sandbox probes; explicit Linux prerequisite for custom-policy laps, no writable fallback. |
| Semantic adjudication declares incompatible repairs consistent | Knowledge | Medium | High | One complete context, required consistency/admission rationale, source-preserving evidence, explicit stops, bounded repeat handling. This remains model judgment, not a mechanically provable property. |
| Dynamic ids bypass an old closed parser in recovery or risk state | Data | Medium | High | Self-describing versioned historic evidence and integration tests covering disabled/removed/reconfigured rubrics. |
| Attended custom review bypasses or duplicates daemon adjudication | Integration | Medium | High | Shared operation with persisted lap-bound result and one caller per execution path; prove both modes. |
| Generic policy context exceeds bounds | Performance | Medium | Medium | Complete-or-stop bundle/context limits; no truncation, broad re-audit, or unbounded conflict fan-out. |

## Conditions required before BUILD

1. Satisfied in DECIDE: operator approved the ADR, especially read-only policy adaptation and initial containment support; its listed adjacent ADR amendments are applied.
2. Stories cover all approved FRs, including same semantic policy under both providers, plugin/global/project sources, disabled and ambiguous cases, complete resources, fallback identity, and unchanged built-in-only behavior.

   Coverage classification: FR-1–FR-16 receive functional stories. FR-17 remains required implementation documentation work under D12, carried by the implementation plan; the stories skill's documentation boundary excludes ordinary documentation stories and acceptance criteria.

> **Amended 2026-09-10 by #1986:** FR-17 remains required delivery guidance under D12 and the PRD Delivery Requirements section. The plan skill excludes ordinary documentation tasks as well as stories; BUILD’s existing documentation/finish obligation owns README and affected consumer guides. This corrects the earlier claim that the functional plan carries that work without removing any approved deliverable.
3. Default tests use faithful metadata/LLM/tracker fakes at third-party boundaries. Do not launch real host agents or metadata CLIs from unit/acceptance tests. Process tests prove their injected boundary is reached before exercising refusal inputs. Local containment smoke tests use disposable fixtures only.
4. Prove production entry paths for attended and daemon custom review, not only helper/schema tests. Each integration proof belongs to its implementation task; no terminal catch-all task.
5. Cover crash boundaries and cross-policy identity in the existing case/effect flow, including after publication/charge and after policy removal or update. Never reset cumulative budgets.
6. Resolve every new failure into a typed coverage or decision result. A partial catalog, unavailable containment, malformed consistency output, or missing admission evidence cannot settle a clean review.
7. The implementation must not weaken the existing `testQuality` vocabulary, scope/preflight behavior, operator dispositions, suppressed-finding semantics, or infrastructure/content separation.

## Verify-Claims Ledger

| Claim | Basis / confidence | Evidence |
|---|---|---|
| Only `testQuality` is admitted today; unknown ids are rejected and retired ids ignored | Verified, 99% | `types/config.ts`, `build-review-registry.ts`, `config.ts` validation and loader at baseline `faa8914fff74619fb8331877ba8040485a7c1352` |
| Cache policy identity is computed before candidate-specific preparation | Verified, 99% | `step-runners.ts` / `resolveBuildReviewEngineIdentity` and `provider-execution.ts` candidate prepare/invoke block |
| Current native transports do not enforce read-only review | Verified, 99% | Codex unattended arguments use workspace-write; Claude runner supports permission bypass; no review profile in `InvokeOptions` |
| Existing adjudication has complete-source validation but lacks explicit cross-case semantic consistency and escalation | Verified, 99% | `remediation-case-artifact.ts`, `remediation-case-validator.ts`, `build-review-adjudication-context.ts` |
| Conductor invokes adjudication under a daemon guard | Verified, 99% | `conductor.ts` build_review outcome branch guarded by `this.daemon` |
| Installed Codex protocol exposes typed local skill/plugin metadata | Verified, 99% | `codex-cli 0.154.0` generated schema: `SkillsListParams`, `SkillsListEntry`, `SkillMetadata`, `PluginSummary`, `PluginDetail`, `PluginSource`; generated locally without starting a model turn |
| Installed Claude supports installed-plugin JSON with paths/enabled state | Verified, 99% | Claude Code 2.1.267 `plugin list --help` and `plugin list --json`; actual descriptor includes id/version/scope/enabled/installPath |
| Local bubblewrap can deny a protected write | Verified, 99% for the bounded probe | Disposable `/tmp` sentinel remained `before`; wrapped write returned read-only filesystem denial. Full host composition is not claimed proven. |
| The private Kotlin skill will work unchanged in review mode | Unverified; not assumed | GitHub returned organization SAML/SSO denial. Generic interface coverage proceeds; package-specific compatibility is not claimed. |

**Verdict:** CLEAR for review of the proposed design. No unverified external behavior is treated as guaranteed. New policy-contract and containment choices require the operator's architectural approval.

## External evidence

- [OpenAI skill documentation](https://learn.chatgpt.com/docs/build-skills) describes instruction/resource packages, explicit skill use, local discovery, and duplicate names. This supports a distinct resolve-and-bind boundary rather than a bare-name assumption.
- [OpenAI plugin documentation](https://learn.chatgpt.com/docs/build-plugins) documents skill-bearing packages and both portable and compatibility manifests. The local generated protocol is the concrete metadata-adapter evidence; the design does not infer cache-directory layout from these docs.
- [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference) documents plugin skill manifests, namespacing, and installation scopes. The locally observed installed-plugin JSON provides the path/enabled fields used by the proposal.

## ADR created

`adr-2026-09-10-portable-build-review-policy.md` — APPROVED by the operator on 2026-09-10. It makes one integrated structural change from installed policy identity through candidate-bound evidence to aggregate repair authority. Existing ADRs are reused wherever their contracts remain intact; the required narrow amendments have been applied beside their original statements.
