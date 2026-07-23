# ADR 2026-07-22-a — Capture build-session usage via `--output-format json`

Status: APPROVED
Date: 2026-07-22
Feature: per-feature-token-accounting (#537)

## Context

Autonomous build dispatch (`claude-provider.ts invoke()`) runs `claude --print --output-format text`
with the prompt on **stdin** (deliberate, to avoid E2BIG argv limits, comment at claude-provider.ts
:417-424). `parseTokenUsage()` exists but only matches a stream-json `{type:'usage'}` line, which
`--output-format text` never emits — so token usage is never captured. We need usage per invocation
without regressing the stdin delivery or the text output the engine already consumes.

## Decision

Switch the autonomous `invoke()` dispatch to `claude --print --output-format json`, prompt still on
stdin. Parse the single result object:

- text output ← `.result` (replaces reading raw stdout as the tail),
- usage ← `.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`,
- cost/meta ← `.total_cost_usd`, `.num_turns`, `.duration_ms`.

Reject `stream-json`: with `--print` it additionally requires `--verbose` and NDJSON/partial-message
parsing, for no benefit — the build path already awaits full completion (buffered) and does not stream
to a live user.

Usage is per-invocation (verified); the engine already emits one `step_completed` per invocation, so
the per-feature total is a sum over events — no cumulative-usage query.

## Consequences

- `parseTokenUsage` (or its replacement) parses a json object rather than scanning lines.
- `InvokeResult.output` is sourced from `.result`; an acceptance spec pins that autonomous steps still
  receive unchanged text output (guards R3).
- `InvokeResult.tokenUsage` also carries cost (`total_cost_usd`) and duration so downstream can report
  cost and so unmeterable sessions can still record duration.
- Interactive path (`invokeInteractive`) is unchanged in this feature; its sessions are recorded as
  unmetered where they occur.
- Verified against Claude Code CLI v2.1.218; schema stable. Re-verify if the CLI result schema changes.
