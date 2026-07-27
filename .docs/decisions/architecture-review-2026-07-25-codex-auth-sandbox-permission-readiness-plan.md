# Architecture Review: Codex Authentication and Autonomous Execution Plan (#905)

**Date:** 2026-07-25
**Mode:** Lightweight (Tier M, post-plan feasibility and alignment refresh)
**Inputs reviewed:** Approved PRD; accepted stories; approved shared-auth-park ADR; approved architecture diagram; implementation plan; current TypeScript execution and conductor seams
**Verdict:** APPROVED WITH CONDITIONS

## Technical Feasibility

The 13-task plan is feasible in the existing TypeScript conductor. It adds no package, service, datastore, credential store, migration, deployment resource, worktree-shared port, or external integration. It uses four existing boundaries:

| Plan area | Verified boundary | Finding |
|---|---|---|
| Codex source/readiness/policy | `src/conductor/src/execution/codex-provider.ts` | The adapter already owns initial and streamed invocation construction and completion classification; a provider-local capability is the narrowest fit. |
| Metadata/fallback precedence | `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/step-runners.ts` | Additive typed metadata retains provider/source identity while existing auth-failure precedence prevents provider fallback. |
| Serial/group recovery | `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/group-core.ts` | Existing joins avoid retry-budget consumption and selectively redispatch failed group members; the shared coordinator can dispatch provider-owned readiness. |
| Self-host isolation | `src/conductor/src/engine/conductor.ts#runSelfBuildDispatch` | Resolving the provider before the Claude-only bundle isolates Codex without weakening common release gates. |

The only material runtime dependency is the already-supported Codex CLI. Strict captured parsing, injected command-runner tests, and opt-in no-model-work smoke coverage control diagnostic-schema drift without requiring external credentials in ordinary tests.

## Architectural Alignment

The plan implements, rather than redefines, the approved ADR:

- `CodexProvider` remains the provider-local owner of source selection, readiness evidence, invocation policy, API-key child-environment scoping, and diagnostic sanitization.
- The conductor remains the owner of park timing and failed-work resumption. It receives typed, sanitized provider/source data and does not read, store, or copy Codex or Claude credentials.
- Authentication failure retains its established precedence over provider/model fallback and retry accounting. The plan explicitly tests the rate-limit/model-unavailability negative boundary.
- Provider-specific self-host setup is selected before preparation. Claude behavior is preserved; Codex skips only the Claude-specific relink, credential, sandbox, config, and token paths.
- The updated component and sequence diagram accurately represents this planned structure. No system-context, container, or ERD change is needed because the feature adds no deployable or data boundary.
- All plan paths are worktree-local. No shared mutable runtime resource is introduced.

No new ADR is required: the plan is fully governed by the approved `adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness` decision and does not alter its scope.

## Risk Register

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Raw doctor or auth diagnostics leak credential fragments | Security | Medium | High | Keep streams captured below the adapter boundary; adversarial fragment checks cover logs, events, state, audit, and HALT output. |
| Metadata is lost at a serial, group, judgment, or auxiliary adapter | Integration | Medium | High | Task 6 requires additive propagation tests before the recovery coordinator changes. |
| A grouped retry reruns a completed sibling | State | Low | High | Task 9 preserves failed-index redispatch and asserts sibling non-invocation. |
| An API key is presented as hot-reloadable | Operational | Medium | Medium | Preserve restart-required disposition; no key file or reload source is introduced. |
| High-contention provider/conductor files advance before implementation | Coordination | Medium | Medium | Re-read current signatures and rerun the advisory overlap scan before editing the affected task. |

## Conditions

1. Raw Codex readiness and authentication diagnostics must remain captured and never reach terminal inheritance, events, state, audit artifacts, or HALT markers.
2. Every unattended path named in the plan — initial, resumed, streamed, grouped, auxiliary, and model-ladder — must receive a fresh readiness verdict and the same explicit bounded policy.
3. Serial and grouped parked recovery must retain failed provider/source identity, preserve zero retry/escalation/fallback budget effects, and never redispatch completed siblings.
4. The Codex self-host branch may skip only Claude-specific preparation. Provider-neutral version and release gates remain mandatory; #904 skill/`AGENTS.md` scope stays out of this feature.
5. If implementation requires a `provider-execution.ts` behavior change beyond additive metadata, rerun the advisory overlap review before editing that seam.

## Verify-Claims Verdict

**CLEAR** — all plan-critical claims were verified against current source and approved decisions; no unconfirmed load-bearing assumption drives the implementation plan.
