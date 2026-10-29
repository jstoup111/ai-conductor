# ADR: Shared credential-reference resolver with pluggable dynamic sources

**Date:** 2026-10-28
**Status:** APPROVED
**Deciders:** operator (jstoup111), composer session

<!-- Filename convention: adr-2026-10-28-<kebab-slug>.md (no sequential numbers). -->

## Context

`otel.headers` (#1939) accepts only `{ env: <name> }`, resolved once at config load. An operator whose
OTLP bearer token lives in a plist (`plutil -extract BearerToken raw -o - <plist>`) or a keychain cannot
use it, and a rotated value needs a process restart. The operator's requirement is dynamic credential
sources in general, not the environment specifically, and the mechanism must be adoptable later by the
harness's other credential consumers: `github_bot.token_file` (read per GitHub call by
`readGithubBotToken` in `engine/github-bot-credential.ts`), the daemon build OAuth token (captured at
child-spawn time in `engine/self-host/sandbox-build-env.ts`), and `tracker.credentials` (a config key
with no production reader yet). Only `otel.headers` moves in this change.

The existing `BuildAuthProvider` seam (adr-2026-07-07-daemon-owned-build-credential) selects *which*
build credential mode applies; it does not resolve configured references from sources, so it neither
covers nor conflicts with this decision.

## Options Considered

### Option A: otel-local `{ command }` reference
- **Pros:** smallest change; mirrors #1939 exactly.
- **Cons:** not reusable; each later consumer re-implements execution, caching and redaction.

### Option B: shared credential-reference resolver (chosen)
- **Pros:** one place owns source execution, caching, single-flight refresh and value-free failures;
  new source kinds and new consumers attach without reworking it.
- **Cons:** a new seam with one consumer today.

### Option C: daemon-level periodic environment refresh
- **Pros:** every env-reading consumer benefits without config changes.
- **Cons:** mutates `process.env` process-wide (including the forwarded build OAuth token); children
  keep their spawn-time copy, so long dispatches still go stale; direct OTLP export still needs an
  async header change.

## Decision

1. **A new `engine/credentials/` module owns credential references.** It exposes a pure parser that
   turns a configured value into a typed reference (a discriminated union over source kinds) or a
   named, value-free error, never throwing and never executing or reading a value; and a resolver
   whose `resolve()` is asynchronous and returns either a value or an `unavailable` result carrying a
   reason that names the source (variable name or command argv) and never the value. Source handling
   uses an exhaustive switch over the union, so adding a source kind is a compile-time-checked change.
2. **Two sources in this slice.** `{ env: <name> }` reads `process.env` at resolve time; unset or empty
   is `unavailable`. `{ command: [argv…], prefix?: <text>, cache_seconds?: <positive integer> }` runs
   the argv with `execFile` and no shell, expands a leading `~/` in any argument to `$HOME`, applies a
   10-second timeout, trims trailing whitespace from stdout and prepends `prefix`; a non-zero exit, a
   timeout, a spawn error or empty output is `unavailable`. Stderr and stdout never appear in a reason.
   The child receives the parent environment with tmux variables scrubbed, and command execution
   honors the `AI_CONDUCTOR_NO_REAL_EXEC` test kill-switch.
3. **Values are cached per reference with single-flight refresh.** A resolved command value is reused
   for `cache_seconds` (default 300); after expiry the next `resolve()` re-runs the source, and
   concurrent callers during a refresh share that one run. An `unavailable` result is not cached, so
   the next send retries. Env references are re-read on every `resolve()`. Cached values live only in
   resolver memory: never in configuration, events, errors or the spool.
4. **`otel.headers` is the first consumer.** `resolveOtelConfig` parses each header through the shared
   parser. Env references keep their existing load-time refusal when unset or empty. Command
   references are validated by shape at load and resolved at send time, so a token that appears or
   rotates later is used without a restart. Both OTLP/HTTP delivery paths obtain headers from one
   async header provider: the spool drainer awaits it before each POST, and the direct exporters
   receive it as their `headers` factory. Existing literal-value, malformed-reference, grpc and
   file-exporter refusals are unchanged and extend to the new form.
5. **A failed resolve blocks that send and reports through the existing event spine.** No request is
   sent without every configured header. The spool drainer treats it as a retryable delivery failure
   (the batch stays spooled under the existing backoff) and reports it with the existing deduplicated
   `renderer_error` (`rendererName: 'otel'`), naming the header and the source, never the value,
   under its own `credential` reporting class (as the existing `spool` class is), so a prior
   network-class warning never suppresses it; `otel_spool_backlog.lastFailureClass` keeps its
   existing values. Recovery uses the existing "delivery recovered" report. The direct path's headers factory rejects
   with a value-free error, surfacing as that exporter's existing failed-export handling.
6. **`command` references are accepted from both user and project config.** Operator decision
   2026-10-28: project configuration is treated as trusted, like the project's own lifecycle hooks.
   This differs deliberately from the machine-scoped `github_bot` and `spec_owner` keys, and is
   recorded as an accepted security risk.
7. **Other credential consumers are not migrated.** The resolver's interface (async `resolve()` →
   value or `unavailable`) is shaped to fit `github_bot.token_file`, the daemon build OAuth token and
   `tracker.credentials`; each adoption is a separate follow-up with its own config change.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | The installed OTLP HTTP exporter (`@opentelemetry/otlp-exporter-base` 0.221.0) accepts an async `headers` factory and awaits it on every send (`http-exporter-transport.js` `send()`; `convertLegacyHeaders` passes a function through) | verified | 97% | yes | Direct export could not refresh; only the spool path would rotate | n/a |
| A2 | A rejected `headers` factory makes the direct exporter report a failed export result rather than an unhandled rejection or an unauthenticated send | inferred | 75% | yes | BUILD must wrap the exporter to convert the rejection into a failed result; a test proves the behavior either way | APPROVED by operator 2026-10-28 |
| A3 | The spool drainer can classify an unavailable credential as retryable, keeping the batch under its existing backoff without a new failure state | inferred | 85% | yes | A new drainer outcome would be needed; scope grows inside the same module | APPROVED by operator 2026-10-28 |
| A4 | The async value-or-unavailable interface fits the three future adopters: the bot token already reads asynchronously per call with a token-or-unavailable result; the OAuth token adopter must resolve before the synchronous `childEnv()`; `tracker.credentials` has no production reader | inferred | 80% | no | A later adopter extends the interface; no change to this slice | n/a |

## Consequences

### Positive
- Operators can supply OTLP credentials from plist, keychain or any CLI, rotated without a restart.
- Execution, caching, timeouts and redaction live in one tested module for later adopters.

### Negative
- A committed project config can make the daemon run a command (decision 6, accepted risk).
- Header resolution becomes asynchronous on both delivery paths.
- A misconfigured command surfaces at first send rather than at config load.

### Follow-up Actions
- [ ] File follow-up intakes to adopt the resolver for `github_bot.token_file`, the daemon build OAuth token and `tracker.credentials`.
