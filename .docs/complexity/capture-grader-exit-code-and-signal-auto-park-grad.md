# Complexity Assessment: Capture provider exit code and signal on unclassified subprocess failure

**Date:** 2026-09-29
**Tier:** S
**Track:** technical (`.docs/track/capture-grader-exit-code-and-signal-auto-park-grad.md`)

Tier: S

## Signals

| Signal | Value | Reading |
|---|---|---|
| Models/tables | 0 | Small |
| External integrations | 0 new (existing provider subprocesses) | Small |
| Auth/authz | None | Small |
| State machines | None — HALT/retry behavior unchanged | Small |
| Estimated stories | ~3–4 (helper, per-provider capture, surfacing) | Small |

## Decision

**Small.** Diagnostics-only change: extract codex's existing `executionProbeFacts` into a shared
provider-diagnostics helper, apply it in the claude/codex/pi `classifyCompletion` unclassified-failure
path, and surface the facts in daemon.log, the retry/HALT reason, and an optional field on an existing
failure event. No new component, no control-flow change, no new telemetry channel, so no
architecture diagram or ADR is warranted.
