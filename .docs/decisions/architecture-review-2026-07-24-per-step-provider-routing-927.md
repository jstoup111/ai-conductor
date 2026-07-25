# Architecture Review: Per-Step LLM Provider Selection and Fallback

**Date:** 2026-07-24
**Input reviewed:** Approved PRD FR-1 through FR-20; current-state provider-routing diagram
**Complexity:** Large
**Verdict:** APPROVED WITH CONDITIONS

> **Conflict-review amendment (2026-07-24):** The approved
> `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
> supersedes the initially reviewed ADR's cross-step provider-session
> persistence. Provider runtime state remains isolated, but sessions are fresh
> per step and provider; only retries within the same step and provider resume.
> This restores alignment with accepted story #325.

## Feasibility

The feature is feasible in the current TypeScript conductor without a new package,
service, datastore, external account, or deployment component.

Verified current seams:

- The plugin registry already retains all discovered and built-in providers and can
  list or retrieve them after initialization.
- Interactive and daemon composition roots currently select one provider and one
  provider-model policy before creating the conductor and runner.
- Step configuration and resolved step settings currently carry no provider identity.
- The step runner owns one provider, one provider policy, one model-availability
  cache, and one mutable session slot; the conductor resets that slot at every
  executed step boundary and reuses it only for retries within the step.
- Within-provider model fallback already distinguishes authentication from model
  unavailability and preserves retry budget.
- Normal, grouped, review, attribution, prelude, recovery, and daemon auxiliary paths
  contain direct provider/policy wiring that must be migrated together.

No schema migration, data backfill, network protocol, or shared worktree resource is
required. The highest feasibility risk is incomplete wiring rather than unknown
technology.

## Complexity

Large remains appropriate. The behavior crosses public configuration, config
validation, step resolution, retry escalation, provider invocation, interactive
streaming, within-step retry durability, availability caching, event/usage attribution,
composition roots, auxiliary dispatches, documentation, and acceptance coverage.

The feature should remain one cohesive delivery because splitting configuration from
runtime routing would expose a valid-looking setting that cannot execute safely.
Implementation should nevertheless be batched around the resolver/runtime seam, then
production path migration, then observability and compatibility.

## Alignment

The proposed provider-local runtime extends the current plugin registry and the
provider-policy seam from issue #902 rather than adding a second provider abstraction.

It preserves the approved reactive model-fallback ADR:

- within-provider model fallback remains reactive and in-attempt;
- authentication is checked before model unavailability;
- model fallback does not consume step retry budget; and
- warnings remain loud.

It necessarily supersedes the run-global selection portion of
`adr-2026-07-23-provider-policies-with-deeper-discovery-effort`, while carrying
forward that ADR's model tables, effort values, tier overrides, escalation orders,
fallback ladders, and custom-provider compatibility.

The current-state diagram accurately shows the existing run-global narrowing points.
The proposed flow is contained in the draft ADR; no system-context, container, or ERD
change is required.

## Domain Integrity

- Provider names are semantic registry keys, not arbitrary model aliases.
- Preferred-provider order is represented as an ordered non-empty collection; empty
  and duplicate entries are rejected so invalid or ambiguous states do not reach the
  runner.
- Provider-neutral step settings are separated from provider-native model, effort,
  availability, and session state.
- Availability outcomes remain explicit classifications: provider unavailable,
  model unavailable, authentication failure, rate limited, session expired, or
  ordinary failure. No catch-all failure triggers provider fallback.
- Candidate exhaustion is explicit and reports every attempted provider.

## Wiring Surface

| Production surface | Design-time production wiring |
|---|---|
| Scalar/array run provider configuration | Parsed and validated by project/user config loading before interactive or daemon composition |
| Per-step provider preference | Validated with executable step configuration and consumed by the shared step resolver |
| Provider candidate-order resolver | Called by conductor base/retry resolution and every step-runner dispatch |
| Provider runtime registry | Constructed after plugin discovery and built-in registration in both interactive and daemon roots |
| Provider-local model availability | Invoked by normal steps, grouped validation branches, reviews, attribution, and recovery dispatches |
| Step-and-provider-local session state | Reset at every step boundary; read/marked only for same-step, same-provider retries; branch sessions remain isolated |
| Provider-unavailable classification | Produced by built-in Claude/Codex integrations and consumed by the candidate invocation loop |
| Actual-provider result metadata | Emitted into step events, warnings, usage accounting, and final exhaustion diagnostics |
| Auxiliary dispatch migration | Project prelude, complexity, build review, attribution, rebase, remediation, setup-fix, CI-fix, and recovery call the same resolver/runtime seam |
| Documentation contract | Configuration guide, conductor README, generated model documentation if affected, and Unreleased changelog |

## Early Overlap Scan

The advisory overlap scan reported broad overlap across many unmerged spec branches,
especially the central conductor, runner, configuration, provider, README, and
CHANGELOG files. The report is non-blocking but confirms high merge-conflict exposure.
The plan should keep commits narrow by seam and reserve finish-time rebase for integration
with whichever overlapping work lands first.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| One auxiliary path retains the run-global provider | Integration | Medium | High | Shared resolver contract, invoke-site inventory, wiring tests, and as-built reachability sweep |
| A provider resumes another provider's or prior step's session | Technical | Medium | High | Step-and-provider-local session identity/markers, per-step reset, and mixed-provider retry tests |
| Primary model/effort settings leak into fallback | Technical | Medium | High | Separate provider-neutral settings from provider-native candidate resolution; fallback-default tests |
| Authentication or rate limits are misclassified as provider unavailable | Reliability | Low | High | Explicit precedence and negative classification tests before provider fallback |
| Multi-provider configuration breaks scalar projects | Integration | Low | High | Normalize scalar to one item and retain #325 fresh-per-step plus within-step retry-resume behavior |
| Model exhaustion disables a provider globally | Reliability | Medium | Medium | Per-provider model cache plus step-scoped provider exhaustion |
| Interactive streaming loses fallback classification | Technical | Medium | Medium | Built-in interactive completion result with visible streaming and parity tests |
| Concurrent work causes merge conflicts in central files | Integration | High | Medium | Narrow commits, advisory overlap awareness, sanctioned finish-time rebase |

## ADRs Created

- `adr-2026-07-24-provider-aware-step-execution` — SUPERSEDED; established the
  shared provider-aware resolver, provider-local runtimes, and fallback boundary
  but misstated session lifetime.
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` —
  APPROVED; preserves the resolver/fallback design and restores fresh-per-step,
  same-provider retry-resume session semantics.

## Conditions

1. **Satisfied:** The provider-aware step execution ADR was approved by the
   operator on 2026-07-24.
2. Approval supersedes `adr-2026-07-23-provider-policies-with-deeper-discovery-effort`;
   its still-valid policy and effort decisions must be carried forward unchanged.
3. Every production provider invocation listed in the Wiring Surface must use the
   shared resolver/runtime seam; partial migration is blocking.
4. Full mixed-provider fallback is guaranteed for built-in providers only in #927.
   Custom provider plugins retain their current compatibility behavior.
5. The plan must include step-and-provider-local session isolation, same-step
   retry durability, and interactive-path parity, not just autonomous step
   routing.

## Blocking Issues

None after the operator confirmed the built-in/custom-provider scope. The ADR approval
lifecycle remains a hard gate.
