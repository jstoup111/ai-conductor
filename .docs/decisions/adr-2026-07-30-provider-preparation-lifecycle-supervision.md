# ADR: Supervise provider preparation with fenced attempt identities

**Date:** 2026-07-30
**Status:** APPROVED
**Deciders:** James Stoup

## Context

Every provider-aware step enters the shared `dispatchProviderWithWatchdog` boundary before provider
candidate resolution, session preparation, self-host preparation, and adapter invocation. The
current watchdog gains termination authority only after stdout/stderr activity creates a matching
heartbeat. If any pre-spawn await wedges, the watchdog ignores the dispatch indefinitely.

Output activity is not reliable termination authority after spawn. Claude and Codex may remain
silent while reasoning, and repository history records a false watchdog kill caused by stale
heartbeat attribution. Operating-system process discovery is also not reliable enough to authorize
recovery: a missing process in an external scan does not prove that an older asynchronous attempt
cannot later resume and spawn.

The required behavior applies to every daemon-managed provider step and every selected provider.
One transient preparation wedge may recover automatically. A repeat for the same logical step must
become a durable human-diagnosable halt.

## Options Considered

### Option A: Shared provider-execution lifecycle supervisor

- **Pros:** One provider-neutral policy; covers candidate/session/self-host preparation; owns attempt
  identity, cancellation, spawn fencing, recovery budget, and telemetry in one boundary.
- **Cons:** Requires a lifecycle-capability contract at the provider adapter boundary and durable
  attempt evidence.

### Option B: Step-level preparation lease

- **Pros:** Smaller initial change near the existing step watchdog.
- **Cons:** Cannot strictly prevent a superseded provider invocation from spawning without extending
  the provider boundary; splits lifecycle ownership between step runner and provider execution.

### Option C: Per-provider startup watchdogs

- **Pros:** Built-in adapters directly control their own process creation.
- **Cons:** Duplicates policy, fails to cover preparation before adapter invocation, and makes custom
  provider behavior inconsistent.

## Decision

Adopt Option A.

Introduce one shared lifecycle supervisor around provider candidate execution. Each logical step
attempt receives a durable identity and moves through explicit states:

1. `preparing` begins before candidate resolution and every pre-spawn await.
2. A provider-neutral spawn permit must be validated synchronously immediately before process
   creation. Revoked or superseded permits fail closed without spawning.
3. A successful spawn moves the attempt to `running`.
4. Provider output may refresh observational telemetry, but output silence has no termination,
   retry, or completion authority.
5. Preparation timeout revokes the attempt before recovery begins. Recovery never consults `ps`,
   process names, pane contents, or other external discovery.
6. One replacement attempt is allowed per logical step. The recovery count is persisted across
   daemon restarts. A second preparation timeout writes a `needs-human` HALT containing the step,
   phase, attempt identity, elapsed preparation time, and recovery count.
7. Clean completion resets the logical step's recovery episode. Provider-selected fallback within
   one active attempt remains distinct from lifecycle recovery and cannot bypass the bound.

The existing `step_heartbeat_stall_minutes` output-silence watchdog loses termination authority.
Heartbeat data may remain for status visibility, but neither absence nor staleness may kill or
replace a spawned provider. Preparation timeout configuration is resolved separately so existing
operator heartbeat opt-outs are preserved rather than silently repurposed.

Providers that cannot honor the synchronous spawn-permit contract cannot run under daemon lifecycle
recovery. They fail closed before invocation with the selected provider, missing capability, and
recovery action named, following the harness unsupported-capability contract.

## Consequences

### Positive

- Pre-spawn wedges leave in-flight state within a bounded time for every provider-aware daemon step.
- A superseded attempt cannot launch after its replacement starts.
- Quiet reasoning cannot be mistaken for a dead provider.
- Recovery behavior is independent of unreliable host-side process discovery.
- Status and logs distinguish `preparing`, `running`, `recovering`, and terminal halt with attempt
  identity.

### Negative

- Provider adapters gain a stricter lifecycle capability contract.
- A genuinely wedged process after spawn is no longer automatically killed from output silence;
  operators retain explicit park/stop controls.
- Durable lifecycle evidence and recovery-count reset semantics add state-machine test surface.
- A separate preparation-timeout setting or fixed policy must be documented and migrated without
  reactivating disabled heartbeat termination.

### Follow-up Actions

- [ ] Define the lifecycle attempt record and crash-safe persistence rules.
- [ ] Add the synchronous spawn-permit contract to built-in providers and fail closed for unsupported providers.
- [ ] Replace output-silence termination with telemetry-only heartbeat behavior.
- [ ] Add bounded recovery and `needs-human` exhaustion handling.
- [ ] Update daemon status, logs, configuration reference, guide, and stalled-feature runbook.
