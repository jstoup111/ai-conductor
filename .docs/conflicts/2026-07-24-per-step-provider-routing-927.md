# Conflict Check: Per-Step Provider Routing (#927)

**Date:** 2026-07-24
**New stories:** `.docs/stories/per-step-provider-routing-927.md`
**Result:** PASSED AFTER RESOLUTION — zero remaining blocking conflicts, zero
accepted degrading conflicts

## Inventory and Method

The check scanned the full contents of:

- 234 files under `.docs/stories/`;
- 35 files under `.docs/specs/`; and
- 116 prior reports under `.docs/conflicts/`.

The #927 stories were checked internally and against the complete inventory for
contradiction, behavioral overlap, state conflict, resource contention, and
sequencing conflict. Focused exact-text comparisons covered provider selection,
model and effort policy, model availability, authentication and rate-limit
classification, provider startup, session ownership, concurrent branches,
retries, auxiliary judgment paths, and custom-provider compatibility.

The verify-claims verdict is **CLEAR**. The operator selected every resolution
below. Current code and the accepted #325 story were inspected to resolve the
load-bearing session-lifetime claim.

## Resolved Blocking Conflicts

### Conflict 1: Opaque explicit models versus cross-provider setting isolation

**Stories involved:** `model-and-effort-resolution-provider-aware-902` vs.
ST-927-3

**Type:** contradiction
**Severity:** blocking (resolved)
**Confidence:** 99%

**Description:**

#902 requires an explicit model string to round-trip without provider-family
validation, including a Claude-looking string while Codex is selected. ST-927-3
said any Claude-native model reaching Codex must fail. Those tests would require
opposite outcomes for the same preferred-provider invocation.

**Resolution Options:**

1. Preserve opaque step-local explicit values on the preferred provider and
   prohibit only inherited or fallback-origin setting leakage.
2. Add provider-family validation and reject cross-family explicit strings.
3. Translate explicit strings between provider model vocabularies.

**Selection:** Option 1 (operator: “aligned”). It preserves FR-7, the approved
ADR's no-translation rule, and #902 while keeping cross-provider fallback safe.

**Resolution applied:**

- Scoped ST-927-3's negative criterion to inherited and fallback-origin values.
- Added a #927 amendment to #902 clarifying preferred-attempt opacity and
  fallback-provider native defaults.

### Conflict 2: Run-global selected-provider language versus per-step routing

**Stories involved:** `model-and-effort-resolution-provider-aware-902` vs.
ST-927-2 and ST-927-8

**Type:** contradiction / behavioral overlap
**Severity:** blocking (resolved)
**Confidence:** 98%

**Description:**

#902 describes one selected provider policy reaching every execution path.
#927 requires the provider to be resolved independently for each step and
attempt. Read literally, the older language would keep auxiliary and later
steps on the provider selected at startup.

**Resolution Options:**

1. Amend “selected provider” to mean the provider resolved for the current step
   and attempt.
2. Restrict per-step routing to the primary runner and retain run-global
   providers for auxiliary paths.
3. Replace #902's provider policies with a new provider-neutral policy.

**Selection:** Option 1 (operator: “aligned”). It carries forward #902's policy
tables without retaining its superseded run-global selection boundary.

**Resolution applied:**

- Added the per-step routing amendment to the #902 story file.
- The approved #927 ADR remains the single resolver/runtime decision.

### Conflict 3: Process-global model cache versus provider-local availability

**Stories involved:** `model-availability-fallback-ladder` vs. ST-927-5

**Type:** state conflict / resource contention
**Severity:** blocking (resolved)
**Confidence:** 99%

**Description:**

The historical story required one process-global exact-string dead-model cache.
In a mixed-provider run, the same opaque model string could be meaningful to
two providers; a global cache would let one provider poison another provider's
availability state. #927 explicitly forbids that state crossing.

**Resolution Options:**

1. Scope each exact-string cache to a provider runtime.
2. Keep one global cache and prefix every model key with a provider name.
3. Disable availability caching for mixed-provider runs.

**Selection:** Option 1 (operator: “aligned”). It is the lowest-lift match for
the approved provider-runtime boundary and retains process-lifetime caching.

**Resolution applied:**

- Amended the model-availability story to make the cache process-scoped per
  provider runtime and to distinguish step-scoped ladder exhaustion from
  run-wide provider failure.

### Conflict 4: Historical feature session versus fresh step sessions

**Stories involved:** `features/conduct/ST-008-session-management` and
EP-001 vs. `fresh-session-per-step` and ST-927-7

**Type:** contradiction / state conflict
**Severity:** blocking (resolved)
**Confidence:** 100%

**Description:**

ST-008 and EP-001 still described one resumable Claude session per feature.
Accepted issue #325 requires every executed step to start fresh, with resume
limited to retries inside that step. The initial #927 ADR compounded the stale
story by proposing provider sessions that survive later steps.

Code inspection confirmed the #325 behavior: `Conductor` invokes
`resetSession()` at every executed step boundary before its retry loop; retries
then reuse that step's runner session. Concurrent and one-shot auxiliary paths
mint isolated sessions.

**Resolution Options:**

1. Use one durable session per provider for the feature.
2. Use one session per phase and provider.
3. Preserve the implemented #325 boundary: fresh per step and provider, with
   same-step same-provider retry resume only.

**Selection:** Option 3. The operator required at least phase isolation and
identified the intended existing behavior as a new session for each provider
call. Verification showed the stronger accepted invariant is fresh per step,
so the resolution preserves that shipped contract.

**Resolution applied:**

- Rewrote ST-008 to state the current fresh-per-step and within-step retry
  contract, amended EP-001, and marked the older Phase 3 plan's session tasks
  historical.
- Added an implementation-resolution note to the authoritative #325 story and
  annotated the intermediate historical changelog entry.
- Updated ST-927-7 to require fresh step-and-provider sessions and isolated
  retry resume.
- Created and approved
  `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`.
- Marked the initial #927 provider-aware execution ADR superseded.
- Amended the architecture review to reflect step-and-provider session scope.

### Conflict 5: Missing executable startup failure versus provider fallback

**Stories involved:** EP-005 vs. ST-927-4 and ST-927-5

**Type:** contradiction / sequencing conflict
**Severity:** blocking (resolved)
**Confidence:** 99%

**Description:**

EP-005 required startup failure whenever the configured provider binary was
missing. #927 requires a registered but deterministically unavailable provider
to warn and fall back to another configured provider. Both cannot govern an
ordered multi-provider run whose preferred executable is absent.

**Resolution Options:**

1. Preserve the clear failure when no usable candidate exists, but allow
   ordered fallback when another configured provider is available.
2. Always fail startup before fallback.
3. Always defer missing-executable detection until the affected step invokes.

**Selection:** Option 1 (operator: “aligned”). It preserves the useful scalar
diagnostic while satisfying the approved multi-provider recovery behavior.

**Resolution applied:**

- Added an EP-005 amendment distinguishing scalar/no-alternative failure,
  ordered fallback, and fail-closed unknown-provider validation.

## Non-Conflicting Reconciliations

- **Authentication and rate limits:** Existing auth park/retry and
  non-consuming rate-limit/session recovery stories already require
  classification before model fallback. ST-927-6 preserves them and never
  advances providers for those outcomes.
- **Retry escalation:** Provider fallback stays within the same step attempt
  and does not consume retry budget. Ordinary retries remain attempt-indexed
  and resume only the matching step-and-provider session.
- **Custom providers:** Registered custom provider plugins retain #902's warned
  Claude-compatible policy. #927 does not promise them built-in mixed-provider
  fallback behavior; unknown/unregistered names still fail validation.
- **Concurrent branches:** Existing branch-local fresh-session requirements
  compose with the stronger step-and-provider key and introduce no shared
  marker ownership.
- **Configuration:** Scalar compatibility and ordered-array validation add no
  collision with existing top-level config keys or step setting precedence.

## Five-Type Re-Check

After applying the selected resolutions, the full inventory was re-checked.

| Conflict type | Result after resolution |
|---|---|
| Contradiction | Clean — provider/model, session, and startup contracts are explicitly scoped |
| Behavioral overlap | Clean — #927 extends the existing resolver, fallback, retry, and all-path contracts at one provider boundary |
| State conflict | Clean — model caches and sessions are isolated by provider, with sessions additionally isolated by step |
| Resource contention | Clean — no shared model cache or session marker may carry another provider's identity |
| Sequencing conflict | Clean — registration and validation precede resolution; within-provider fallback precedes provider fallback; step reset precedes attempts |

A repository-wide documentation sweep found no remaining unqualified claim
that normal conductor sessions persist across steps. Historical references are
either rewritten to the current contract or explicitly labelled as superseded;
the changelog retains chronology while naming #325 as the later behavior.

## ADR and Review Disposition

- One superseding ADR was required and approved:
  `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`.
- No degrading conflict was accepted.
- A conflict-check review marker is required because blocking conflicts were
  found and resolved and a superseding ADR was created.

## Verdict

**PASSED AFTER RESOLUTION.** Zero blocking conflicts remain. After operator
review, proceed to `/plan`.
