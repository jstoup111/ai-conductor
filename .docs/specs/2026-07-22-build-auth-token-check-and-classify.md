# PRD: Build-Auth Token — Check and Classify

- **Status:** Approved
- **Date:** 2026-07-22
- **Track:** product
- **Tier:** M
- **Intake:** jstoup111/ai-conductor#498 (subsumes #483, #484)

## Problem / Background

The daemon-token cutover (#443) made the build credential daemon-owned, but the operator
experience around that credential is hostile. Observed live on 2026-07-10/11:

- The daemon restarted before a token existed → every queued feature independently
  halted (per-feature HALT cascade, #483).
- A truncated paste (91 bytes) produced a present-but-invalid token → each dispatch
  failed with 401s that were treated as generic retryable failures and burned the full
  retry-escalation ladder per feature (#484).
- Storing the token correctly required insider knowledge (exact file location, byte
  exactness, no trailing newline, restrictive permissions); the obvious approaches
  (paste, shell redirect of the mint command) silently produced broken token files.
- Nothing in the installation health check reports anything about the credential, so a
  broken token is invisible until the next dispatch fails.

The operator has explicitly descoped a guided setup flow (and update-time auth-mode
gating) for now; this feature makes the existing manual flow observable, diagnosable,
and non-destructive when it goes wrong.

## Goals

1. An operator can learn the state of the build credential — missing, present but not
   usable, or verified working — from the installation health check, before any
   dispatch depends on it.
2. A build failure caused by an unusable credential is recognized as an authentication
   failure and pauses work until the credential changes; it never consumes retry or
   escalation budget.
3. When the credential is missing, the operator gets one clear, complete, actionable
   remediation message — not a cascade of per-feature failures.

## Non-Goals

- No guided/interactive setup flow that mints or writes the token on the operator's
  behalf (explicitly descoped; candidate follow-up).
- No gating or prompting when an update changes the default authentication mode.
- No automatic token refresh, rotation, or expiry prediction.
- No change to how the credential is minted or to its storage format/location.

## Users / Personas

- **Operator (James):** installs/updates the harness, mints and stores the build
  credential manually, triages daemon halts — often from a phone, hours after the fact.
- **Daemon (autonomous consumer):** dispatches builds using the credential; must fail
  informatively and cheaply when the credential is absent or unusable.

## Functional Requirements

- **FR-1 — Credential state in the health check.** The installation health check
  reports the build-auth mode and, when the daemon-token mode is active, the
  credential's state as exactly one of: **missing** (no stored credential, or stored
  content is empty/whitespace-only), **unreadable** (stored but not accessible),
  **invalid** (stored but rejected when verified — includes expired), or **valid**
  (stored and verified usable). Verification is live: a present-but-invalid credential
  MUST be reported as invalid at check time, not discovered at the next dispatch.
- **FR-2 — Mode-aware checking.** When the API-key authentication mode is active, the
  health check reports that mode and performs no credential-file checks; it MUST NOT
  report a missing token as a failure in that mode.
- **FR-3 — Scriptable outcome.** A missing, unreadable, or invalid credential (in
  daemon-token mode) causes the health check to exit unsuccessfully, consistent with
  how other failed checks behave, so scripts and operators can rely on the exit status.
- **FR-4 — Invalid credential classified at dispatch.** A dispatched build that fails
  because the credential is rejected by the service (unauthorized / authentication
  error) is classified as an authentication failure on **every** dispatch path (serial
  and concurrent). Per the existing park-and-poll decision, the affected work pauses
  and resumes when the credential changes; the failure consumes **zero** retry or
  escalation budget.
- **FR-5 — One actionable missing-credential message.** When the daemon finds the
  credential missing before dispatching, the operator-facing message includes, in one
  place: what is wrong, the exact command that mints a credential, where the credential
  must be stored, and the storage pitfalls observed in the field (the mint command
  prints to the terminal so shell redirection captures nothing; trailing whitespace
  breaks the credential; the file must not be readable by other users). Following only
  that message must be sufficient to recover.
- **FR-6 — No per-feature cascade.** A single missing-credential condition surfaces to
  the operator as one condition, not as an independent halt per queued feature: work
  queued behind a known-missing credential waits on that one condition and proceeds
  automatically once the credential is stored, without per-feature operator cleanup.
- **FR-7 — Credential confidentiality.** No check, log line, halt message, or error
  path introduced by this feature ever prints the credential's value (in full or
  partial form).

### Negative / edge behavior

- Whitespace-only stored credential is reported as **missing** (matches existing
  fail-closed reading), not invalid.
- A credential that cannot be verified because the verification itself failed (e.g.
  network down) is reported as **unverifiable — state unknown**, distinct from invalid;
  the health check MUST NOT claim "valid" without a successful verification.
- Health check with no project configuration present uses the documented defaults and
  still reports credential state.

## Non-Functional Requirements

- **Cost/latency:** credential verification adds no more than a few seconds to the
  health check and negligible service cost per run.
- **Determinism:** classification of authentication failures must not depend on locale
  or incidental phrasing the service is free to change, to the extent the service's
  error surface allows.

## Acceptance Criteria / Success Metrics

- Re-running the 2026-07-10/11 failure scenarios yields: truncated token → health check
  says **invalid** before any dispatch; 0-byte token file → **missing** with the
  complete remediation message; daemon started before mint → one waiting condition,
  zero per-feature halts, work resumes unaided after the token is stored.
- An invalid-credential dispatch failure shows zero retry attempts and zero model/effort
  escalations in the audit trail (#484 closed).
- #483 and #484 can be closed by this feature.

## Scope

**In:** health-check credential reporting; dispatch-time classification of
authentication failures on all dispatch paths; single-condition missing-credential
degradation and its remediation message.

**Out:** guided setup flow; update-time auth-mode gating; token minting/writing on the
operator's behalf; refresh/rotation; changes to credential storage location or format.

## Key Decisions & Rationale (product)

- **Observability over automation (for now):** the operator chose diagnosis and safe
  failure (Approach B) over a guided setup flow (Approach A) — smaller, sooner, and the
  flow remains a natural follow-up on top of the verification this feature introduces.
- **"Expired" is reported as invalid:** the operator-facing distinction that matters is
  usable vs not-usable; expiry is one cause of invalid, and remediation is identical.

## Dependencies

- The pre-existing mint command (`claude setup-token`) and its terminal-only output
  behavior — external reality this feature documents, not something it changes.
- The pre-existing credential storage contract (file location and permission
  expectations from the daemon-owned-build-credential decision) — reported against,
  not altered.
- Existing decisions: daemon-owned build credential (2026-07-07) and auth failures
  park-and-poll, never retry/escalate (2026-07-04). FR-4 and FR-6 must land inside
  those decisions, not amend them.
- The service's error surface for rejected credentials (what a 401 looks like to the
  consumer) — external constraint on FR-4.

## Open Questions (for architecture review)

- **OQ-1 — Verification mechanism:** how to cheaply verify credential liveness (direct
  service probe with the stored credential vs. a minimal invocation of the existing
  build tooling in an isolated environment). Trade-off: cost/latency vs. fidelity to
  the real dispatch path. (~70% confidence a cheap probe exists; affects FR-1's
  implementation, not its requirement.)
- **OQ-2 — Classification signal:** whether authentication-failure recognition should
  rely on richer structured error information where available rather than matching
  human-readable text (determinism NFR).
- **OQ-3 — Single-condition surfacing:** how the "one condition, not per-feature
  halts" behavior (FR-6) composes with the existing per-project halt marker mechanism
  without weakening fail-closed semantics.
