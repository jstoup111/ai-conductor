# ADR: Auth-failure classification — observed 401 patterns in text mode, structured status in the probe

**Date:** 2026-07-22
**Status:** APPROVED
**Feature:** build-auth-token-check-and-classify (jstoup111/ai-conductor#498)
**Related:** adr-2026-07-04-auth-failure-park-and-poll (the park semantics classification
routes into), adr-2026-07-22-token-liveness-probe-via-cli-invocation,
adr-2026-07-20-ci-fix-startup-preflight-and-error-classification (classification precedent)

## Context

FR-4: a dispatched build failing on a rejected credential must classify as an auth
failure on both dispatch paths, consuming zero retry/escalation budget. Today
`AUTH_FAILURE_RE` (`claude-provider.ts:34`) is `/not logged in|invalid api key|please
run \/login/i`. Verified 2026-07-22: an invalid daemon token actually produces
`Failed to authenticate. API Error: 401 Invalid bearer token` (exit 1) — no pattern
matches, so the failure is generic and rides the full retry-escalation ladder
(`group-core.ts:413-500`); the serial path parks only when `authFailure` is set
(`conductor.ts:3096`). This is exactly #484.

The build invocation uses `--output-format text` (`claude-provider.ts:418`), so
dispatch-time classification only sees prose. The JSON envelope carries a structured
`api_error_status` field (verified), but switching dispatch's output format reworks
output handling for every consumer — out of scope for this feature.

## Decision

1. **Dispatch path (text mode): extend the existing precedence classifier** with
   patterns anchored to the observed error shape, keeping the current precedence
   position of auth-failure:
   - `failed to authenticate` (observed prefix — covers invalid and, inferred ~80%,
     expired/revoked variants which surface through the same authenticate step)
   - `invalid bearer token` (observed)
   - a conservative `401` pattern only in an authentication context (e.g.
     `API Error: 401`) — never a bare number match, so legitimate build output
     mentioning 401 is not misclassified.
   Each pattern must carry a fixture test using the verbatim observed output.
2. **Verifier path (new code): use the structured signal.** The liveness probe runs
   with `--output-format json` and keys off `api_error_status`/`is_error` — no text
   matching (determinism NFR satisfied where we control the invocation).
3. **Both dispatch paths honor the flag identically:** serial already parks;
   `group-core` must treat `authFailure` as park-not-retry (it currently returns
   no-verdict at `:493` — the fix routes it to the same park-and-poll semantics,
   never the retry ladder), per adr-2026-07-04: never retry, never escalate.

## Consequences

- #484's failure mode (401 burning the ladder) is closed by classification, not by
  retry-budget tuning.
- Text patterns remain an external-phrasing dependency; the mitigation is (a) anchored
  patterns with verbatim fixtures, (b) the health check catching most bad tokens
  before dispatch, (c) a future migration of dispatch to the JSON envelope, which
  would supersede the regex clause of this ADR.
- Misclassification risk is asymmetric by design: a missed auth failure degrades to
  today's behavior (retry ladder); a false positive parks work until the credential
  file changes — hence the anchored, context-bound patterns.
