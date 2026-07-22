# ADR: Token liveness verification via minimal CLI invocation (not raw API probe)

**Date:** 2026-07-22
**Status:** APPROVED
**Feature:** build-auth-token-check-and-classify (jstoup111/ai-conductor#498)
**Related:** adr-2026-07-07-daemon-owned-build-credential (seam this verifier reads through),
adr-2026-07-04-auth-failure-park-and-poll

## Context

FR-1 requires the install health check to report the build credential as
missing / unreadable / invalid / valid, with "valid" backed by live verification. No
verification exists today (`readDaemonBuildToken` is presence-only). Two candidate
mechanisms (PRD OQ-1):

- **(a) Raw API probe** — HTTPS request to the Anthropic API with the stored token as a
  bearer credential.
- **(b) Minimal CLI invocation** — run the same headless build tooling dispatch uses
  (`claude -p`) with `CLAUDE_CODE_OAUTH_TOKEN` set from the token file inside a
  throwaway `CLAUDE_CONFIG_DIR`.

## Evidence (verified 2026-07-22, this machine, deliberately-invalid token)

- `claude -p "reply with ok" --model claude-haiku-4-5-20251001` with an invalid
  `sk-ant-oat01-…` token in a throwaway config dir: exit 1, output
  `Failed to authenticate. API Error: 401 Invalid bearer token`, duration ~2.3s.
- Same invocation with `--output-format json`: structured envelope
  `"is_error":true, "api_error_status":401, "terminal_reason":"api_error",
  "total_cost_usd":0` — a deterministic, machine-readable verdict at zero cost.
- Option (a) could NOT be verified: whether the raw API accepts setup-token OAuth
  bearers is an unconfirmed assumption (~70%, inferred from ecosystem behavior), and
  probing with the real credential was declined at review time.

## Decision

The liveness verifier is a **minimal headless CLI invocation** (option b):

- Runs `claude -p` with a trivial prompt, the cheapest model tier, `--output-format
  json`, a tight timeout, `CLAUDE_CODE_OAUTH_TOKEN` sourced from the resolved token
  path, and a throwaway `CLAUDE_CONFIG_DIR` (same isolation pattern as
  `sandbox-build-env.ts`) so the operator's interactive credentials are never touched.
- Verdict mapping (fail-safe, never claims valid without positive signal):
  - **valid** — envelope parses and `is_error` is false (a real completion came back).
  - **invalid** — `api_error_status` 401/403 (includes expired tokens).
  - **unverifiable — state unknown** — anything else: spawn failure, timeout, network
    error, unparseable envelope, unexpected status.
- The token value is passed via environment only; no code path prints it (FR-7).
- The verifier is invoked by the health check only — dispatch does NOT run it
  (dispatch keeps fail-fast read + classified failure per the companion ADRs).

## Why not the raw API probe

- Rests on an unverified load-bearing assumption (raw-API acceptance of setup-tokens);
  the CLI probe is **verified by construction** — it exercises the exact auth path the
  next dispatch will use, so its verdict cannot drift from real dispatch behavior.
- A second, hand-rolled auth implementation is a drift surface the harness would have
  to maintain against an external service contract we don't control.

## Consequences

- Cost/latency: invalid/missing verdicts are free and fast (measured $0, ~2.3s); a
  "valid" verdict costs one minimal cheapest-tier completion and a few seconds —
  acceptable for an operator-run health check (PRD NFR met with margin noted).
- If a future need demands sub-second checks, a raw probe can be introduced by a
  superseding ADR once its acceptance assumption is actually verified.
