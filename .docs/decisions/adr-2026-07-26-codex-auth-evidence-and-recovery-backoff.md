# ADR: Codex auth evidence is independent from unrelated doctor health

**Date:** 2026-07-26
**Status:** SUPERSEDED
**Feature:** Codex readiness park loops on unrelated doctor failure (#970)
**Deciders:** James Stoup (operator), architecture review for issue #970
**Supersedes:** `adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness`
**Preserves:** provider/source isolation, bounded timeout, zero retry/escalation/fallback budget,
startup-only API-key restart semantics, and all non-readiness decisions from the superseded ADR

**Superseded by:** `adr-2026-07-29-codex-readiness-probe-failure-disposition`

**Approval:** Approved by James Stoup on 2026-07-26.

## Context

The authoritative #905 recovery ADR requires the Codex adapter to reuse its strict readiness
operation before dispatch and while parked. The implemented documented-schema parser accepts
`auth.credentials.status: ok` as ready only when the whole doctor report also has
`overallStatus: ok`.

During the #254 Codex canary, one Codex invocation succeeded under cached login and the next
step's readiness probe reported `auth.credentials: ok` alongside an unrelated failing provider
reachability check. The adapter collapsed that mixed report to `unverifiable`, returned an auth
failure, and entered the cached-login park. Recovery then spawned the same diagnostic every second
for more than 22 minutes while emitting no durable progress after the initial park event.

The operator approved treating the versioned auth-specific `ok` result as sufficient credential
evidence. The design must still fail closed when auth evidence is missing, rejected, malformed,
or absent, and an actual rejected model invocation must still enter authentication recovery.

## Options Considered

### Option A: Auth-subcheck authority plus backed-off visible recovery

- **Pros:** fixes the observed false auth classification at the narrow parser boundary; preserves
  explicit missing/rejected failures; bounds diagnostic subprocess frequency; exposes long waits.
- **Cons:** the public Codex manual does not document the per-check JSON contract; mixed-health
  dispatch can encounter the unrelated network failure during the real invocation instead.

### Option B: Recent-success readiness lease

- **Pros:** bases continued execution on demonstrated authenticated model work rather than doctor
  field semantics.
- **Cons:** introduces cache lifetime/invalidation state and behaves differently for first versus
  adjacent dispatches.

### Option C: Separate active authentication probe

- **Pros:** could establish credential usability independently of whole-doctor health.
- **Cons:** no documented auth-only probe was found; a model probe consumes usage and creates a
  second external failure surface.

## Decision

Choose **Option A**.

### 1. Classify supported auth evidence independently

For the supported versioned doctor envelope, `checks["auth.credentials"].status: "ok"` is
sufficient to return `ready` for the selected authentication source even when
`overallStatus: "fail"` comes from another check. The adapter records only a sanitized indication
that unrelated doctor health was degraded; raw check names, summaries, stdout, stderr, and
credential material do not cross the provider boundary.

Explicit missing/rejected/expired credential evidence remains `missing` or `unusable`. Missing
`auth.credentials`, unsupported schema versions, malformed/conflicting fields, and ambiguous auth
evidence remain `unverifiable`. A real invocation that subsequently rejects the selected source
still returns an auth failure and enters the existing provider/source-specific park.

### 2. Preserve the recovery boundary while changing cadence

The conductor continues to own park timing and the provider continues to own readiness. Cached
login recovery performs one immediate readiness recheck, then uses capped exponential delays of
1, 2, 4, 8, 16, and 30 seconds, remaining at 30 seconds until ready or the existing configured
timeout expires. The configured timeout and opt-out behavior remain authoritative; backoff does
not extend the deadline or consume retry, effort, model, provider, or auth-source fallback budget.

API-key restart-required behavior and Claude recovery behavior remain unchanged.

### 3. Make recovery progress durable and rate-limited

Add a typed `credentials_park_progress` event carrying only provider, selected source, sanitized
readiness state, elapsed seconds, next probe delay, and a sanitized distinction between credential
failure and unrelated diagnostic degradation. Emit it when the sanitized state changes and,
while unchanged, no more than once per 60 seconds. The existing `credentials_park` event remains
the single lifecycle-start event.

Daemon/event persistence and operator log rendering consume the new event through the existing
event bus. No event contains raw doctor output or credential fingerprints.

## Consequences

### Positive

- Unrelated doctor failures no longer masquerade as missing Codex authentication.
- The #254 canary can proceed to the next step while its cached login remains accepted.
- An unchanged recovery condition produces at most two doctor subprocesses per minute after the
  initial ramp instead of sixty.
- Operators receive durable, bounded progress without credential or raw diagnostic leakage.

### Negative

- Auth-specific `ok` may permit a dispatch that then fails because another provider condition is
  genuinely unhealthy; that failure follows its actual classification instead of auth recovery.
- The event union and all exhaustive event consumers gain one variant.
- Backoff can observe a newly refreshed cached login up to 30 seconds later than one-second polling.

## Follow-up Actions

- [ ] Update documented-schema readiness classification and mixed-health fixtures.
- [ ] Implement deadline-preserving cached-login backoff with injected time/sleep tests.
- [ ] Add and persist `credentials_park_progress` across every event consumer.
- [ ] Prove no raw doctor detail or credential fragment reaches events, logs, or HALTs.
- [ ] Cover ready, missing, unusable, unverifiable, state-change, unchanged-progress, timeout,
      opt-out, serial, grouped, and auxiliary recovery paths.
