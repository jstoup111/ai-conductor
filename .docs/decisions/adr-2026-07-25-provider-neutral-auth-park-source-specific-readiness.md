# ADR: Provider-neutral auth park with source-specific readiness

**Date:** 2026-07-25
**Status:** SUPERSEDED
**Feature:** Codex authentication, sandbox, and permission readiness (#905)
**Deciders:** James Stoup (operator), architecture review for issue #905
**Supersedes:** `adr-2026-07-25-codex-unattended-readiness-and-bounded-execution`
**Amends:** `adr-2026-07-04-auth-failure-park-and-poll` by making its recovery
disposition provider-neutral while preserving source-specific recovery checks
**Related:** `adr-2026-07-07-daemon-owned-build-credential`,
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`

**Approval:** Approved by James Stoup on 2026-07-25.

**Superseded by:** `adr-2026-07-26-codex-auth-evidence-and-recovery-backoff`

## Context

The original #905 ADR gave Claude and Codex different terminal recovery behavior:
Claude authentication failure entered the existing park-and-poll path, while Codex
authentication failure wrote an immediate HALT. That difference was not required by
the PRD's no-retry/no-fallback constraints and creates an unnecessary operator-visible
split for the same failure class.

The operator clarified that built-in-provider authentication recovery should be the
same: current work stops, the feature enters a bounded parked state, retry and
escalation budgets remain untouched, and work resumes only after the selected source
is ready. Provider credentials still cannot be shared because Claude and Codex expose
different source and readiness mechanisms.

The current code has one conductor recovery join for serial work and a corresponding
group join, plus provider runtimes owned by the feature run. Claude's park logic is
already centralized in `parkOnAuthFailure`; Codex's adapter is the planned owner of
the strict, non-mutating readiness probe. These seams support a shared recovery state
without a new service, credential store, or provider fallback policy.

## Options Considered

### Option A: Shared park state with source-specific readiness checks

- **Pros:** one operator-visible recovery lifecycle; preserves provider isolation;
  reuses existing retry/group joins and timeout behavior; cached login can recover
  after native sign-in; no new credential storage.
- **Cons:** the coordinator needs provider/source metadata and a narrow Codex
  readiness capability; a key supplied only at daemon startup cannot recover inside
  that same process.

### Option B: Keep Claude park and Codex immediate HALT

- **Pros:** least code change and no Codex recovery polling.
- **Cons:** contradicts the approved product amendment and gives identical auth
  failures different daemon behavior.

### Option C: Add a reloadable key file or general credential broker

- **Pros:** environment-key failures could recover without restarting the daemon.
- **Cons:** adds credential storage, rotation, permissions, and lifecycle ownership
  explicitly excluded from #905; materially overcomplicates the feature.

## Decision

Choose Option A.

### 1. Use one bounded authentication-recovery state

Every built-in-provider authentication failure reaching the conductor's existing
serial or concurrent-group recovery join enters the same bounded park lifecycle.
Pre-dispatch Codex readiness states `missing`, `unusable`, and `unverifiable` enter
that lifecycle without starting substantive model work. A post-dispatch rejection
enters it after the failed invocation stops.

The park retains the failed provider, selected auth source, sanitized readiness
state/reason, and source-specific remediation. It consumes no task retry, effort
escalation, model escalation, provider fallback, or auth-source fallback budget.
Only the failed serial attempt or failed group member may resume; completed siblings
are never redispatched.

The existing auth-park timeout and opt-out semantics bound the wait. Timeout or
explicit opt-out writes one sanitized provider/source-specific HALT; it never falls
through to generic retries-exhausted recovery.

### 2. Keep readiness and refresh mechanisms provider-owned

The conductor coordinates state and timing but does not inspect or copy provider
credentials.

- Claude retains its existing credential-source checks, token refresh detection,
  remediation, and sandbox injection behavior.
- Codex reuses the same strict, captured readiness operation used before unattended
  dispatch. The Codex adapter exposes a narrow readiness capability through its
  provider runtime; the conductor receives only the typed four-state verdict and
  sanitized metadata, never raw diagnostic output.

The common recovery entry point dispatches by actual provider and selected source.
It does not introduce a generalized credential framework or require custom providers
to implement Codex/Claude recovery behavior.

### 3. Distinguish refreshable sources from startup-only keys

For cached Codex login, the parked loop repeats the native readiness check. A native
login refresh can therefore produce `ready`, after which the same attempt resumes.
Claude's existing refreshable file/token sources retain their current change checks.

An API key inherited when the daemon starts is not externally replaceable inside the
running process. Such a failure still enters the shared parked lifecycle, but it is
reported as `restart-required`; the process performs no fake credential reload and
does not introduce a new key source. Restarting the daemon with the replacement key
ends the old wait and lets normal unfinished-feature recovery run a fresh preflight.
If no restart occurs before the configured timeout, the park writes an actionable
HALT instructing the operator to replace the key, restart the daemon, and requeue.

### 4. Preserve the rest of the #905 boundary

The superseded ADR's other decisions remain unchanged and are incorporated here:

- a supplied Codex API key wins over cached login, with no auth-source fallback;
- the Codex adapter performs strict four-state readiness before every unattended
  initial, resumed, grouped, model-ladder, or auxiliary invocation;
- every unattended Codex invocation explicitly uses `workspace-write`, `on-request`,
  `auto_review`, and default secret filtering, never danger bypass;
- raw Codex diagnostic/auth output is captured and replaced by sanitized metadata;
- self-host setup resolves the build provider first. Codex skips only Claude-specific
  relink, credential, `CLAUDE_CONFIG_DIR`, token-injection, and hook-sandbox setup;
  it still runs Codex readiness/policy plus provider-neutral version and release gates;
- issue #904 retains ownership of Codex skill discovery and repository guidance.

## Consequences

### Positive

- Operators see one auth recovery lifecycle across built-in providers.
- Cached Codex login can recover autonomously after native sign-in without requeueing.
- Auth failures remain isolated from retry/model/provider fallback budgets.
- The design adds no credential persistence, refresh logic, container, or generalized
  permissions framework.

### Negative

- Codex readiness is repeated while parked, adding bounded diagnostic traffic.
- Startup-only keys cannot self-heal inside a running process; restart is explicit.
- Serial and group recovery require provider/source metadata and a Codex readiness
  capability, increasing the auth result contract slightly.

## Evidence and Assumptions

- **Verified:** the conductor already centralizes auth parking at serial and group
  joins and owns the provider runtime set — current `conductor.ts` and
  `provider-runtime.ts`.
- **Verified:** Codex readiness can be non-mutating, strictly parsed, and captured via
  the already-reviewed `codex doctor` contract; cached login success and rejected-key
  failure were directly probed during the original #905 review.
- **Verified:** a daemon cannot receive an externally changed parent-shell environment
  value after process creation. Restart-required handling therefore does not pretend
  an API key can hot-reload.
- **Approved input:** the operator approved the shared parked lifecycle and explicitly
  declined a new reloadable key mechanism on 2026-07-25.
- **Assumptions:** none. The previously approved valid-API-key diagnostic compatibility
  posture remains fail-closed as `unverifiable` and is not changed by this amendment.

## Follow-up Actions

- [ ] Replace the provider-specific terminal disposition with one shared auth park
      coordinator at serial and group recovery joins.
- [ ] Expose the Codex adapter's strict readiness operation as a narrow runtime
      recovery capability without exposing raw output or credential material.
- [ ] Preserve provider/source/readiness metadata through all result adapters.
- [ ] Add refreshable-login, restart-required key, timeout, opt-out, resume, group,
      confidentiality, no-budget, and no-fallback coverage.
- [ ] Retain all other Codex bounded-execution and self-host isolation work from the
      superseded ADR.
