**Status:** Accepted

# Stories: Per-Step LLM Provider Selection and Fallback

**Source:** Approved PRD `2026-07-24-per-step-provider-routing-927`
**Architecture:** Approved ADR
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
**Track:** Product
**Complexity:** Large

> **Provider-specific auth amendment (#905, approved 2026-07-25):** ST-927-6's
> no-provider-fallback invariant remains unchanged, but authentication recovery is
> provider-neutral at the lifecycle boundary and provider-specific at the readiness
> boundary. Every built-in provider enters the same bounded auth park; only the failed
> provider's selected source is rechecked, with no provider fallback or retry/escalation
> budget consumption.

## Traceability

| Story | Requirements |
|---|---|
| ST-927-1 Provider-set configuration and validation | FR-1, FR-2, FR-17 |
| ST-927-2 Inheritance and explicit step specialization | FR-3, FR-4, FR-5, FR-8 |
| ST-927-3 Provider-native model and setting resolution | FR-6, FR-7, FR-14 |
| ST-927-4 Ordered provider fallback and diagnostics | FR-9, FR-13, FR-18 |
| ST-927-5 Model exhaustion and availability scope | FR-10, FR-15, FR-16 |
| ST-927-6 Failure-classification boundaries | FR-11, FR-12 |
| ST-927-7 Provider-local execution identity and accounting | FR-19 |
| ST-927-8 Consistent routing across every execution path | FR-20 |

## Story ST-927-1: Configure and validate the provider set

**Requirement:** FR-1, FR-2, FR-17

As a harness operator, I want to configure one provider or an ordered provider
set so that a run has a valid, predictable source of provider choices without
breaking existing projects.

### Acceptance Criteria

#### Happy Path

- Given a project with one registered provider selected in the existing scalar
  form, when the run starts, then that provider is accepted as the complete
  ordered provider set and existing single-provider behavior is preserved.
- Given a project with two registered providers in an ordered selection, when
  the run starts, then both providers are accepted in exactly the declared order.
- Given run-level and step-level provider selections that all name registered
  providers, when configuration validation completes, then the run may proceed
  to its first executable step.

#### Negative Paths

- Given an empty ordered provider selection, an empty provider name, or the same
  provider listed twice, when configuration validation runs, then validation
  fails before any step dispatch and identifies the invalid run-level selection.
- Given a valid existing scalar provider selection, when the upgraded conductor
  runs it, then it does not require array syntax, reorder the provider, or emit a
  migration error.
- Given an unknown provider at run level or on a named executable step, when
  validation runs after provider registration, then validation fails before
  dispatch and reports the unknown name, its run/step scope, and the available
  registered names.

### Done When

- [ ] Automated configuration tests accept scalar and ordered provider selections.
- [ ] A compatibility test proves an existing scalar Claude-only configuration
      resolves identically to its pre-feature behavior.
- [ ] Validation tests reject empty, blank, duplicate, and unknown provider names
      with scope-specific diagnostics before invocation.

## Story ST-927-2: Inherit a default and explicitly specialize steps

**Requirement:** FR-3, FR-4, FR-5, FR-8

As a harness operator, I want unspecified steps to inherit the first provider and
selected steps to name another provider so that specialization is explicit and
local to each step.

### Acceptance Criteria

#### Happy Path

- Given an ordered provider set with Claude first and Codex second, when an
  unspecified step is resolved, then Claude is its preferred provider.
- Given the same provider set and a judgment step explicitly selecting Codex,
  when that step is resolved, then Codex is attempted before Claude.
- Given one unspecified build step and one Codex-specialized judgment step in the
  same run, when both execute successfully, then the build uses Claude and the
  judgment uses Codex.
- Given a registered built-in provider that is not in the run-level provider set,
  when a step explicitly selects it, then that provider is still attempted first.

#### Negative Paths

- Given a later provider in the ordered set and no explicit step selection, when
  a judgment-class step is resolved, then the system does not automatically move
  it away from the first provider based on role or model preference.
- Given one step explicitly selecting Codex, when a later unspecified step is
  resolved, then the earlier specialization does not mutate the inherited
  provider for the later step.
- Given a step explicitly selecting the first provider, when the run resolves it,
  then a later provider is not attempted first merely because it is present.
- Given a step selecting a registered provider outside the run-level set, when
  that provider is unavailable, then fallback candidates come from the declared
  run-level set rather than from arbitrary registered providers.

### Done When

- [ ] A mixed-run acceptance test records Claude for one step and Codex for another.
- [ ] Resolution tests prove inheritance, explicit selection, and no cross-step
      mutation or automatic role-based assignment.
- [ ] A candidate-order test covers a preferred registered provider outside the
      run-level set.

## Story ST-927-3: Keep model and execution settings provider-native

**Requirement:** FR-6, FR-7, FR-14

As a harness operator, I want each provider attempt to receive only its own model
and execution settings so that mixed-provider runs never send invalid native
values across provider boundaries.

### Acceptance Criteria

#### Happy Path

- Given a step selecting Codex without an explicit model, when the step resolves,
  then it receives Codex's model and effort defaults for that step and tier.
- Given a step selecting Codex with an explicit Codex model, when Codex executes
  the preferred attempt, then the exact configured model is used without
  translation.
- Given a preferred Codex attempt that falls back to Claude, when Claude executes,
  then Claude receives its native default model, effort, and model-fallback
  behavior for that step and tier.

#### Negative Paths

- Given run-wide Claude-native model settings and a step explicitly selecting
  Codex without a step-local model, when the Codex step resolves, then no
  inherited Claude model identifier or provider-native ladder is passed to
  Codex.
- Given an explicit Codex model and a successful Codex attempt, when invocation
  options are inspected, then the system has not translated it to a Claude alias
  or substituted another provider's default.
- Given an explicit Codex model, effort, command-line override, or retry-escalated
  model on the failed preferred attempt, when fallback reaches Claude, then none
  of those Codex-native values are carried into the Claude attempt.

### Done When

- [ ] Provider-spy tests assert exact model and effort values for primary Claude
      and Codex attempts.
- [ ] Fallback tests assert that the fallback provider receives policy defaults,
      not primary-provider explicit or escalated values.
- [ ] Negative tests fail if an inherited or fallback-origin model from one
      provider reaches another; a step-local explicit model remains opaque and
      round-trips byte-for-byte on its preferred-provider attempt.

## Story ST-927-4: Fall back in deterministic provider order with loud diagnostics

**Requirement:** FR-9, FR-13, FR-18

As a harness operator, I want unavailable providers to fall back in a deterministic
and visible order so that the run can recover without hiding what actually executed.

### Acceptance Criteria

#### Happy Path

- Given a step preferring Codex and a run-level order of Claude then Codex, when
  Codex is unavailable, then the step attempts Codex first and Claude second.
- Given a preferred provider followed by two other configured providers, when the
  first two are unavailable, then each remaining provider is attempted once in
  declared run-level order.
- Given a cross-provider transition, when the next provider is attempted, then a
  visible warning identifies the step, failed provider, concrete reason, and next
  provider.
- Given all configured candidates unavailable, when the candidate list is
  exhausted, then the step fails with every attempted provider and reason listed.

#### Negative Paths

- Given a preferred provider that also appears in the run-level list, when
  fallback order is built, then that provider is not attempted twice.
- Given a registered provider that is neither preferred nor in the run-level set,
  when configured candidates fail, then the system does not silently dispatch to
  that arbitrary provider.
- Given a fallback warning missing the step, failed provider, reason, or next
  provider, when diagnostics are validated, then the warning contract is rejected.
- Given every configured provider unavailable, when exhaustion is reported, then
  the system does not reuse another provider's model settings, report success, or
  consume an unlisted provider.

### Done When

- [ ] Candidate-order tests prove selected-first behavior and stable de-duplication.
- [ ] Warning assertions cover all required diagnostic fields.
- [ ] Exhaustion tests assert failure, complete attempted-provider history, and no
      unconfigured invocation.

## Story ST-927-5: Scope model exhaustion and deterministic unavailability correctly

**Requirement:** FR-10, FR-15, FR-16

As a harness operator, I want model exhaustion to trigger step-scoped fallback and
deterministic provider failures to be remembered so that recovery is efficient
without disabling healthy future work.

### Acceptance Criteria

#### Happy Path

- Given every model in the preferred provider's native ladder is unavailable,
  when the ladder is exhausted within one step attempt, then the next configured
  provider is attempted without consuming a step retry.
- Given one step exhausts every model for Codex and falls back, when a later step
  explicitly selects Codex, then Codex is eligible again and its settings are
  resolved for that later step.
- Given a built-in provider executable is deterministically unavailable for the
  run, when a later step would select that provider, then the run skips the doomed
  process attempt, warns with the cached reason, and continues to the next
  configured candidate.

#### Negative Paths

- Given only the first model is unavailable and a later model in the same
  provider's ladder succeeds, when the step completes, then cross-provider
  fallback does not occur.
- Given model exhaustion on one step, when another step selects the same provider,
  then the provider itself is not treated as globally dead solely because of the
  earlier step.
- Given a transient or step-scoped failure, when a later step resolves candidates,
  then that failure is not cached as deterministic run-wide provider
  unavailability.

### Done When

- [ ] Tests prove within-provider ladder walking precedes cross-provider fallback.
- [ ] Retry accounting proves neither model walking nor provider fallback consumes
      a retry.
- [ ] Cache-scope tests distinguish step model exhaustion from deterministic
      run-wide provider failure.

## Story ST-927-6: Preserve authentication and ordinary failure recovery

**Requirement:** FR-11, FR-12

As a harness operator, I want only genuine provider unavailability to change
providers so that authentication, rate-limit, session, and task failures retain
their established recovery semantics.

### Acceptance Criteria

#### Happy Path

- Given a preferred provider reports authentication failure, when the result is
  classified, then the common bounded auth park receives it, retains the failed
  provider and source, and invokes only that provider's readiness path; no alternate
  provider is attempted.
- Given a preferred provider reports a rate limit, session expiry, timeout,
  rejected request, unsuccessful work result, or ordinary non-zero exit, when the
  result is classified, then its existing retry/recovery path receives it and no
  alternate provider is attempted.

#### Negative Paths

- Given output containing both authentication wording and no model-unavailable
  signature, when classification runs, then the selected provider is not marked
  unavailable and no cross-provider warning is emitted.
- Given a rate-limit or session-expired result while another provider is
  configured, when the conductor handles it, then the provider candidate list
  does not advance and the established non-budget-consuming recovery behavior is
  preserved.
- Given an ordinary failure whose prose happens to contain the word
  "unavailable" but does not match the provider/model-unavailability contract,
  when classification runs, then the system does not switch providers.

### Done When

- [ ] Classification tests cover auth, rate limit, session expiry, timeout,
      rejected work, and ordinary failure without provider fallback.
- [ ] Mixed-message tests prove classification precedence cannot poison provider
      or model availability caches.
- [ ] Existing Claude authentication, rate-limit, and stale-session recovery suites
      remain green, and built-in-provider authentication failures prove the same
      parked disposition with provider/source-specific recovery and no provider
      fallback.

## Story ST-927-7: Isolate sessions, permissions, retries, and usage by provider

**Requirement:** FR-19

As a harness operator, I want execution identity and accounting to follow the
actual provider and current step so that mixed runs remain isolated and
auditable without carrying conversation context across step boundaries.

### Acceptance Criteria

#### Happy Path

- Given Claude completes one step and Codex completes the next, when the second
  step starts, then it creates a fresh provider-native session and does not
  resume any session from the first step.
- Given a preferred provider falls back to another provider, when the fallback
  attempt first runs for that step, then it starts a fresh fallback-provider
  session with that provider's permissions and authentication context.
- Given an ordinary failure retries the same step on a provider, when the retry
  dispatches, then it resumes that step-and-provider session rather than minting
  a new session.
- Given multiple provider attempts produce usage, retries, and events, when run
  accounting is reported, then every attempt is attributed to the provider that
  actually executed it while retaining one overall run identity.
- Given concurrent branches use different built-in providers, when both complete,
  then neither branch mutates the other's or the main run's provider session state.

#### Negative Paths

- Given a prior step left a Claude or Codex session marker, when the next step
  starts on either provider, then it does not resume the prior step's session or
  treat that marker as current-step state.
- Given Codex fails before Claude succeeds on fallback, when usage and events are
  inspected, then Codex's attempt is not reported as Claude usage and Claude's
  success is not reported as Codex work.
- Given authentication or permission state for one provider, when another provider
  executes, then the first provider's native credential/session state is not
  passed across the provider boundary.
- Given two concurrent branches complete in either order, when either branch or
  the next main step dispatches, then no branch-local provider state is resumed
  outside the branch and step that created it.

### Done When

- [ ] Mixed-provider tests prove every step boundary creates fresh
      provider-native sessions and no session survives into a later step.
- [ ] Retry tests prove attempts within one step resume only the matching
      step-and-provider session.
- [ ] Event and token-usage tests carry both preferred and actual provider identity.
- [ ] Concurrent-branch tests prove provider-local and branch-local session isolation.
- [ ] Scalar single-provider runs retain the accepted #325 fresh-per-step and
      within-step retry-resume behavior.

## Story ST-927-8: Route every conductor execution path consistently

**Requirement:** FR-20

As a harness maintainer, I want every built-in execution path to use the same
provider decision so that no validation, recovery, or auxiliary step silently
bypasses per-step configuration.

### Acceptance Criteria

#### Happy Path

- Given built-in provider specialization, when normal interactive and autonomous
  steps run, then both honor preferred-provider selection, native settings, and
  availability fallback.
- Given built-in provider specialization, when concurrent validation, judgment,
  attribution, complexity, prelude, rebase, remediation, setup-fix, CI-fix, or
  recovery work runs, then each path resolves and records its preferred and actual
  provider through the same behavior.
- Given a scalar single-provider run, when every production execution path runs,
  then all paths retain their prior provider and recovery behavior.

#### Negative Paths

- Given an interactive built-in provider is unavailable, when an interactive step
  completes its failed attempt, then visible streaming does not suppress failure
  classification or prevent eligible provider fallback.
- Given an auxiliary or judgment path explicitly assigned to Codex while the main
  build uses Claude, when that path executes, then it does not use a provider
  captured at run startup.
- Given a production invocation path that bypasses provider resolution or cannot
  report its actual provider, when wiring coverage runs, then the feature is
  considered incomplete even if unit tests for the resolver are green.

### Done When

- [ ] An invoke-site matrix test covers every normal, grouped, prelude, judgment,
      attribution, recovery, inline, and daemon path named by the approved ADR.
- [ ] Interactive parity tests prove visible streaming plus classified completion
      and fallback for built-in providers.
- [ ] Static wiring/reachability coverage fails when any production path retains a
      run-global provider or policy.
- [ ] Custom provider plugins retain their pre-feature compatibility behavior and
      are not asserted to provide built-in mixed-provider fallback.
