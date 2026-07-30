# ADR: Direct Claude uses the configured verifier interface

**Date:** 2026-07-25
**Status:** SUPERSEDED by `adr-2026-07-29-deterministic-build-verification-fanout`
**Deciders:** James Stoup (operator), Codex architecture review for issue #940
**Supersedes:** `adr-2026-07-25-content-addressed-full-suite-proof` direct-Claude invocation details only

## Context

The prior ADR correctly required direct `/test-suite` to share the configured
aggregate verifier's content-addressed evidence with the native engine. It
incorrectly made a particular executable command part of that reusable skill's
contract. That would make a generic skill depend on an implementation-specific
CLI, while direct Claude is intended to use its host integration rather than a
Bash or literal CLI workflow.

## Decision

> **Supersession notice (2026-07-29):** The configured-verifier proof semantics
> remain implemented by `FullSuiteVerifier`, but the test-suite skill surface
> described here is removed. Interactive verification uses the provider-neutral
> `conduct-ts test-suite` adapter directly.

Direct `/test-suite` and permitted BUILD fallbacks use the host-provided,
repository-configured aggregate verifier interface. The interface resolves the
repository's declared verifier and preserves the shared proof semantics:

1. It performs the same current-versus-stale inspection, execution, evidence
   recording, redaction, and fail-closed classification as the engine gate.
2. Generic skills name only this interface and never prescribe a
   repository-specific command or the raw project aggregate command.
3. An executable adapter may exist behind the host interface, but it is an
   internal implementation detail and is not a prerequisite for an operator to
   run `/test-suite`.

This supersedes only the direct-CLI statements in
`adr-2026-07-25-content-addressed-full-suite-proof`; all requirements for one
shared verifier, project-owned configuration, content-addressed reuse, and
fail-closed evidence remain authoritative.

## Verify-Claims Ledger

### Claims

- **Verified (99%):** the engine gate owns configured-verifier inspection,
  execution, and evidence through `FullSuiteVerifier`.
- **Verified (99%):** `skills/test-suite/SKILL.md` intentionally avoids both a
  raw project command and the implementation-specific executable command.
- **Verified (100%):** the operator directed that `/test-suite` execute within
  Claude directly and that generic skills not require that executable command.

### Assumptions

- **None pending.** The direct-interface policy is an explicit operator
  decision, not an inferred runtime capability.

**Verdict:** CLEAR.

## Consequences

### Positive

- Reusable skills remain portable across configured repositories.
- Direct and automated paths retain one proof/evidence contract without
  exposing an internal adapter as workflow syntax.

### Negative

- Hosts must provide the configured-verifier interface; a host that cannot do
  so fails the gate rather than falling back to the raw aggregate command.

### Follow-up Actions

- [x] Update direct-flow, fallback, and architecture documentation.
- [x] Re-run the as-built architecture review against this ADR.
