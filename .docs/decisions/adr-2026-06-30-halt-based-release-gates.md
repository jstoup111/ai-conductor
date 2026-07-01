# ADR: All self-host release gates are HALT-based and fail-closed

**Date:** 2026-06-30
**Status:** APPROVED
**Feature:** Harness daemon self-host guardrails
**Related:** adr-005-non-autonomy-and-read-only-governor, ADR-010 (single-owner pidfile),
adr-001-rebase-insertion-mechanism (writeHalt / no-dispatch keystone)

## Context

The harness draws release gates that consumer projects do not: an operator-approved VERSION bump,
a non-empty `CHANGELOG [Unreleased]`, a `## Migration` block for breaking changes, and a green
`test/test_harness_integrity.sh`. Today these rely on a human running them; `CLAUDE.md` states the
VERSION bump must be **presented for approval before a PR is opened**.

A daemon build runs in `auto` mode with **no human to prompt**. ADR-005 (non-autonomy by
construction) and ADR-010 (single-owner) require that no build merges itself and no gate is
silently bypassed.

## Decision

Every self-host guardrail that cannot self-satisfy calls the existing `writeHalt()`
(`engine/rebase.ts`) to park the build for the operator — it never prompts and never proceeds. Two
finish-plane gates apply to a harness self-build:

- **`VersionApprovalGate`** — requires an operator VERSION-bump approval marker before opening the
  PR; absent or VERSION-mismatched → HALT with a gate-specific reason (distinct from a rebase HALT).
- **`ReleaseArtifactGate`** — runs `test_harness_integrity.sh` (bounded by a timeout), asserts a
  non-empty `## [Unreleased]`, and requires a runnable `## Migration` block when a breaking surface
  (`settings.json` schema, hook wiring, skill symlink targets, `bin/conduct` CLI) changed. Any
  failure → HALT naming the failing gate.

All gates are **fail-closed**: a missing/non-executable integrity script, a missing `[Unreleased]`
header, an uncertain breaking-surface classification, or an integrity-script timeout all HALT
rather than pass. Passing every gate still ends at the standard finish-time HALT for the operator
to re-install, `/verify`, and **merge** — the daemon never merges (structural test, TR-12).

## Consequences

- **Positive:** `CLAUDE.md`'s human-gated release rules become enforceable inside an autonomous
  loop instead of silently skipped.
- **Positive:** reuses the one sanctioned HALT primitive; no new park/merge machinery; ADR-001's
  no-dispatch keystone and ADR-005's human-merge invariant are preserved.
- **Negative:** a harness self-build will HALT often (by design) — it is a propose-only pipeline, so
  operator touchpoints are expected, not a failure.
- Each gate emits a **distinct** HALT reason so the operator sees *why* a self-build parked.

## Alternatives rejected

- **Interactive prompts at the gate:** impossible in `auto` mode (no TTY/human); would either hang
  the daemon or be auto-answered. Rejected.
- **Bump VERSION / fill CHANGELOG autonomously:** violates `CLAUDE.md`'s approval rule and ADR-005.
  Rejected.
- **Fail-open when a gate input is missing** (e.g. treat an absent integrity script as pass):
  defeats the gate on the one repo where integrity matters most. Rejected — gates are fail-closed.
