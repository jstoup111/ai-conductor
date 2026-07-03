# ADR: Self-host builds ignore `early-draft` (guardrail precedence)

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James Stoup (operator — selected during conflict-check resolution)

## Context

adr-2026-07-03-pr-timing-config-key lets `pr_timing: early-draft` open a draft
implementation PR at build start. The harness self-host guardrails
(harness-self-host-guardrails stories TR-7…TR-10) require a self-build to HALT for the
operator's semver-bump approval **before any PR is opened** — the VersionApprovalGate /
ReleaseArtifactGate run at finish. Build-start PR creation on a self-host build would
bypass them. Conflict surfaced by conflict-check 2026-07-03.

## Options Considered

### Option A: Self-host builds force effective mode `finish`
- **Pros:** Guardrail stories hold verbatim; smallest change; mirrors the existing
  "MUST NOT on the self-host repo" hardening pattern; uses the existing SelfHostDetector
  seam (adr-2026-06-30-self-host-detection-seam).
- **Cons:** No early visibility on self-host builds specifically.

### Option B: Push-only early mode on self-host (branch pushed, PR deferred to gates)
- **Cons:** A third publish mode to implement and test; PR-based CI/visibility (the bulk
  of the value) is absent anyway; more surface against the most safety-critical repo.

## Decision

Option A. When the SelfHostDetector identifies a self-host build, the effective publish
mode is `finish` regardless of the configured `pr_timing`, and the daemon logs one loud
line stating the configured value and the downgrade reason. Config validation is
unchanged — `early-draft` remains a valid value in the self-host repo's config; it simply
has no effect on self-host builds. Precedence: guardrails > `pr_timing`.

## Consequences

### Positive
- VersionApprovalGate/ReleaseArtifactGate semantics are preserved without modification.

### Negative
- Harness self-builds keep finish-time-only visibility (accepted; the operator watches
  consumer-project builds far more often).

### Follow-up Actions
- [ ] Gate the early publisher on `!selfHost` via the existing detector seam
- [ ] Test: self-host build + `pr_timing: early-draft` → zero early publishes + loud downgrade log
