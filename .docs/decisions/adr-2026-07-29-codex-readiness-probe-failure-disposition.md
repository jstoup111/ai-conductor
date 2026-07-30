# ADR: Codex readiness separates probe failure from credential failure

**Date:** 2026-07-29
**Status:** APPROVED
**Feature:** Codex readiness probe failure separation (#1039)
**Deciders:** James Stoup (operator), architecture review for issue #1039
**Supersedes:** `adr-2026-07-26-codex-auth-evidence-and-recovery-backoff`
**Preserves:** selected-source isolation, auth-subcheck authority, capped recovery backoff, bounded auth-park timeout, zero retry/escalation/fallback budget, startup-only API-key semantics, and all non-readiness decisions from the superseded ADR

**Approval:** Approved by James Stoup on 2026-07-29, including the one-trial/no-recursion recovery bound and the `codex_doctor_timeout_seconds` configuration seam.

## Context

The current Codex readiness contract uses `unverifiable` for both a negative credential verdict and a failure to obtain a verdict. Execution errors, timeouts, invalid JSON, unsupported schemas, unrecognized envelopes, conflicting evidence, and ambiguous credential evidence all become `unverifiable`. Normal unattended dispatch treats every state except `ready` as `authFailure`, while cached-login recovery polls the same state until the full auth-park timeout and then reports that credentials did not become ready.

This conflation caused issue #1039's live incident: a non-authentication doctor warning produced an unrecognized envelope, valid cached credentials were treated as unavailable, and features spent repeated hour-long parks with no retained cause. Issue #1038 accepted the immediate `warning` envelope, but it did not make future doctor execution or parsing failures distinguishable.

The operator decided that a doctor probe unable to produce an answer is a degraded diagnostic and must not block an ordinary Codex dispatch. When recovery is already active because credentials were affirmatively non-ready, the operator chose one real invocation trial if the recovery probe itself fails.

## Options Considered

### Option A: Explicit probe-failure result plus bounded real-invocation trial

- **Pros:** keeps credential facts truthful; preserves useful preflight for affirmative failures; records the actual probe failure; avoids false auth parks; lets a real invocation settle an inconclusive recovery probe.
- **Cons:** widens the readiness and recovery result contracts; every consumer must handle the new outcome exhaustively; the one-trial recovery disposition needs an explicit loop bound.

### Option B: Treat probe failures as degraded `ready`

- **Pros:** fewer caller changes; normal dispatch already proceeds for `ready`.
- **Cons:** makes `ready` mean both affirmative evidence and absence of evidence; hides the distinction from callers and weakens diagnostics.

### Option C: Remove doctor readiness from dispatch

- **Pros:** actual Codex invocation becomes the only credential authority; no diagnostic can block work.
- **Cons:** loses early detection of affirmative missing or rejected credentials; every known credential failure incurs a substantive invocation; abandons the provider-local readiness boundary established by prior ADRs.

## Decision

Choose **Option A**.

### 1. Make readiness a discriminated result

Replace `unverifiable` as a credential state with an explicit `probe-failed` outcome. The shared readiness contract must make invalid combinations unrepresentable:

- `ready` means supported doctor evidence affirmatively accepts the selected source;
- `missing` and `unusable` mean supported doctor evidence affirmatively rejects or lacks the selected source; and
- `probe-failed` means no trustworthy credential verdict was obtained.

A `probe-failed` result carries a required, closed failure kind: `exec-error`, `timeout`, or `unparseable-output`. It may carry only allowlisted structured facts needed for diagnosis, such as process error code, exit code, signal, configured timeout, output byte counts, schema version, envelope status, credential-check presence/status, or a closed parser-rejection reason. It never carries raw stdout, stderr, doctor summaries, credential paths, credential fragments, hashes, or arbitrary exception messages.

Unknown schemas, invalid JSON, unrecognized envelopes, conflicting selected-source evidence, and ambiguous credential evidence map to `unparseable-output` with the narrow structured shape facts available. This retains enough evidence to distinguish the failure class and identify schema drift without replaying the incident or exposing doctor payloads.

### 2. Ordinary dispatch proceeds on probe failure

Before each unattended Codex invocation:

- `ready` proceeds normally;
- `missing` or `unusable` returns the existing source-specific authentication failure and enters authentication recovery; and
- `probe-failed` writes one sanitized degraded-readiness diagnostic to the existing feature-scoped persisted diagnostic sink, then proceeds with the real Codex invocation.

The actual invocation remains authoritative. If it reports authentication failure, the existing provider/source-specific auth recovery begins. Success and non-authentication failures retain their existing classification. Probe failure never advances provider fallback, model fallback, retry, or escalation state.

### 3. A failed recovery probe authorizes exactly one real trial

The auth-recovery coordinator's boolean timeout result becomes an explicit disposition that distinguishes `recovered`, `trial-required`, and `halt`. When a recovery probe is `probe-failed`, the coordinator records the structured diagnostic and returns `trial-required`. The caller performs exactly one real Codex invocation for that recovery episode.

If the trial succeeds or fails for a non-authentication reason, normal result handling resumes. If it affirmatively reports authentication failure, the episode ends with a probe-specific diagnostic that records both facts: the recovery probe was inconclusive and the bounded real trial still rejected authentication. It does not recursively re-enter another probe-bypass cycle. Existing polling continues unchanged while probes return conclusive `missing` or `unusable`, and resumes normally when a probe returns `ready`.

Serial, concurrent-group, and auxiliary verifier callers must use the same disposition contract so no call shape gains an unbounded bypass or a generic credential-timeout message.

### 4. Make the doctor timeout reviewed configuration

Add the consumer-facing top-level configuration key `codex_doctor_timeout_seconds`, defaulting to `10`. It must be a finite positive number; invalid values fail configuration validation rather than silently falling back. The composition root resolves the value once and injects milliseconds into the built-in Codex provider when it is registered. The provider runner keeps its injectable test seam, but no private runtime constant owns production behavior.

A Codex-specific key is preferred over a generic provider-readiness abstraction because only Codex exposes this doctor contract today. An environment-only override is rejected because it would bypass repository configuration validation and documentation.

### 5. Preserve observability and security boundaries

Normal-dispatch probe failures use the existing per-feature `diagnosticLog`, which is durable in daemon operation. Recovery probe failures additionally flow through the existing persisted `credentials_park_progress` event using a closed probe-failure degradation and failure-kind field; terminal rendering and event persistence must handle the widened variant exhaustively. A probe-specific recovery halt is constructed only from the same structured fields.

No new event bus, datastore, service, credential reader, external integration, retry budget, or provider fallback behavior is introduced.

## Consequences

### Positive

- Operators can distinguish execution error, timeout, parsing/schema drift, and affirmative credential rejection from retained evidence.
- Transient or unrelated doctor failures no longer block valid Codex work or manufacture hour-long credential parks.
- Recovery can use one actual invocation to settle an inconclusive probe without creating an unlimited bypass loop.
- The doctor timeout is visible, validated, documented, and testable per repository.
- Raw doctor payloads and credential material remain below the provider boundary.

### Negative

- A probe failure can allow an invocation that later fails for a reason the doctor would otherwise have diagnosed first.
- The readiness type, recovery result, progress event, config validator, and composition root all widen together.
- The one-trial recovery rule creates a new episode state that must be preserved across serial, grouped, and auxiliary callers.
- Valid future doctor fields are not logged verbatim; diagnosis relies on allowlisted shape metadata until the parser is updated.

## Follow-up Actions

- [ ] Add the discriminated readiness result and structured secret-safe probe-failure metadata.
- [ ] Classify execution error, timeout, invalid JSON, unsupported schema, and unrecognized/ambiguous envelopes separately from affirmative credential outcomes.
- [ ] Continue ordinary dispatch on `probe-failed` while retaining conclusive auth blocking and actual-invocation auth recovery.
- [ ] Add the bounded `trial-required` recovery disposition across serial, grouped, and auxiliary paths.
- [ ] Add, validate, resolve, inject, and document `codex_doctor_timeout_seconds`.
- [ ] Persist sanitized normal and recovery diagnostics without raw payloads or credential fingerprints.
- [ ] Add unit and acceptance coverage for every probe kind, recovery disposition, timeout validation, no-loop, no-fallback, no-budget, and secret-safety invariant.
