# ADR: Daemon-level missing-credential gate — one waiting condition, per-feature preflight retained as backstop

**Date:** 2026-07-22
**Status:** APPROVED
**Feature:** build-auth-token-check-and-classify (jstoup111/ai-conductor#498)
**Related:** adr-2026-07-04-auth-failure-park-and-poll (park machinery reused),
adr-2026-07-07-daemon-owned-build-credential (credential source),
adr-2026-07-20-ci-fix-startup-preflight-and-error-classification (fail-loud-once precedent)

## Context

FR-6: a single missing-credential condition must surface as one condition, not an
independent halt per queued feature. Today `preflightBuildAuthCheck`
(`build-auth-preflight.ts:24-73`) runs per dispatch and writes a `.pipeline/HALT`
marker per projectRoot/worktree — correct fail-closed behavior per feature, but when
the credential is missing globally (observed 2026-07-10/11, #483), every queued
feature independently halts and each requires operator cleanup after the token lands.

## Decision

1. **Pre-dispatch gate in the daemon loop.** Once per dispatch cycle, before any
   feature is dispatched, the daemon resolves the build-auth mode and reads the
   credential through the existing reader. In daemon-token mode with the credential
   missing/unreadable, the daemon:
   - surfaces ONE waiting condition (single log/status entry carrying the full FR-5
     remediation message), and
   - **parks the whole dispatch cycle** on the credential source using the existing
     park-and-poll machinery (`waitForCredentialsChange` + the daemon-token freshness
     classifier) — dispatching nothing, writing no per-feature HALT markers.
2. **Auto-resume.** When the credential file becomes fresh (non-empty content change),
   the park loop returns and the daemon resumes the dispatch cycle unaided — queued
   features proceed without per-feature operator cleanup (FR-6).
3. **Per-feature preflight is retained, unchanged in semantics, as the fail-closed
   backstop** for races (credential deleted mid-cycle, per-feature config overrides).
   Its message body is upgraded to the same FR-5 remediation content, produced by one
   shared message builder so gate, preflight, and health check can never drift apart.
4. **Fail-closed is preserved, not weakened:** the gate only ever *prevents* dispatch;
   no path dispatches on unverified state that would previously have been blocked.

## Consequences

- #483's cascade becomes one parked condition with one message; recovery is
  "store the token" with zero per-feature cleanup.
- The gate adds one credential read per dispatch cycle — negligible.
- Stays inside adr-2026-07-04 (park-and-poll is the wait mechanism; never retry,
  never escalate) and adr-2026-07-07 (the credential seam is read, not changed);
  neither ADR is amended.
- The daemon's status surface gains a visible "waiting on build credential" state,
  which the observe tooling reports like any other park.
