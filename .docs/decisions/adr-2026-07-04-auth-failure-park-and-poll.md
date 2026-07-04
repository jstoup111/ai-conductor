# ADR: Auth failures park-and-poll on operator credentials — never retry, never escalate

**Status:** APPROVED
**Date:** 2026-07-04
**Feature:** sandbox-auth-expiry-park (jstoup111/ai-conductor#210)
**Relates to:** adr-2026-06-30-sandbox-build-isolation (TR-6), adr-2026-07-03-reactive-model-fallback-ladder

## Context

The self-host build path copies the operator's `.credentials.json` into a throwaway
sandbox config dir at provision time (TR-6: copies, never symlinks). The sandbox is
provisioned once per feature run and reused across every retry of the build step.
When the operator's OAuth token is expired (or rotated by a concurrent live session),
the headless `claude -p` invocation fails with "Not logged in"; no signature regex
classifies this, so the failure burns the entire step retry budget in seconds and
halts the feature with a generic "retries exhausted" reason (incident: PR #209,
missed a fresh token by 18 seconds). An auth failure is not transient with respect
to re-running the step — it cannot succeed until the *source credentials file
changes* — and the daemon cannot re-auth interactively (subscription credentials,
not an env key).

## Decision

1. **Classification.** Add an auth-failure signature (`AUTH_FAILURE_RE`) in
   `claude-provider.ts` beside the existing signatures, matched only on failed
   (non-zero exit) invocations and anchored to the CLI's actual error shape
   ("Not logged in" / "Invalid API key" login-prompt output), surfaced as an
   `authFailure` flag through `StepRunResult`.
2. **Ordering.** Auth classification precedes model-availability handling and any
   retry decision. An auth failure never marks a ladder model dead, never consumes
   a retry-budget entry, and — binding on the future retry-as-escalation work
   (#188) — never triggers effort/model escalation.
3. **Park-and-poll primitive.** Both detection points funnel into one shared wait:
   poll the operator credentials file (mtime change AND, when parseable, an
   unexpired `claudeAiOauth.expiresAt`) at a modest interval, up to a generous
   configurable timeout (default 60 minutes). On refresh: **re-copy credentials
   into the existing sandbox** (a copy, preserving TR-6) and resume the same
   attempt with the retry budget intact. On timeout: HALT with a reason that
   names the credentials file path and the observed `expiresAt`, so the operator
   reads it as an auth-window condition, not a build defect. Existing
   HALT.cleared + REKICK remediation continues to work unchanged.
4. **Pre-flight check.** Before dispatching a self-host build attempt, read the
   operator credentials; if `claudeAiOauth.expiresAt` is expired or within an
   imminent-expiry margin, enter the same park loop without provisioning or
   spawning anything. A missing file, unparseable JSON, or absent `claudeAiOauth`
   block **fails open** (dispatch normally — that is the env-key auth path); the
   signature catch backstops genuine auth failures the pre-flight cannot see.
5. **Identity seam.** Credentials location resolves through the existing
   `globalConfigDir` seam (`$CLAUDE_CONFIG_DIR` → `~/.claude`), and expiry reading
   lives behind a single small reader, so a platform-provided identity source
   (isolated-remote/EKS deployment) can replace the file-based implementation
   without touching classification or park logic.

## Alternatives considered

- **Pre-flight check only:** rejected — misses unexpired-but-invalid tokens
  (refresh rotated by a concurrent live session), which were part of the incident.
- **Signature classification only:** rejected as sole mechanism — burns a sandbox
  provision + spawn per incident to learn what a file read already shows.
- **Treat as ordinary retry with longer backoff:** rejected — the failure is
  deterministic until the source file changes; any fixed backoff either wastes
  budget or waits arbitrarily wrong amounts, and it entangles auth with #188's
  escalation semantics.

## Consequences

- The daemon survives operator-credential expiry windows (the overnight/unattended
  case) instead of converting them into permanent parks with needs-remediation PRs.
- One more classification branch in the provider and one wait primitive in the
  conductor loop; the retry ladder itself is untouched.
- Negative-path specs are required at every classification and parse site:
  output that mentions "Not logged in" on a *successful* run must not park;
  malformed credentials must not park; an auth park must leave the model ladder
  and retry budget byte-identical.
- The park loop blocks the current feature run only — same blocking contract as
  the existing rate-limit wait.
