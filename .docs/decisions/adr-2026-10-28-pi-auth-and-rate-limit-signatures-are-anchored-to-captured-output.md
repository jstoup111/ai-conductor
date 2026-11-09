# ADR: Pi auth and rate-limit signatures are anchored to captured output, and a Pi auth failure parks on Pi's own credentials

**Date:** 2026-10-28
**Status:** APPROVED
**Deciders:** operator (jstoup111), composer DECIDE for #2718

## Context

`adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` D5 lists "anchored auth and
rate-limit signatures → `authFailure` / `rateLimited`" in the Pi adapter's classification order. It
also requires each signature to be confirmed against real Pi output before it is anchored. No
signature was confirmed, so `execution/pi-provider.ts` classifies only ENOENT or exit 127 and the
unknown-model stderr. Every other failure is an ordinary step failure, including the exit-0 error
stop of D14.

Two consequences follow, both verified in the engine source on 2026-10-28:

- A rate-limited or quota-exhausted Pi fails the step. The serial loop's rate-limit wait and its
  `providerAvailability.suppress` call (`engine/conductor.ts`, the `result.rateLimited` branch)
  never see Pi. The candidate walk in `executeProviderCandidates` therefore never refuses Pi as
  `provider-suppressed`, and the ladder does not advance.
- Setting `authFailure` alone would be wrong. `parkOnAuthFailure` (`engine/conductor.ts`) enters
  its readiness branch only for a provider whose catalog descriptor declares `readiness`, which
  Pi does not. Any other result falls through to the self-host api-key or daemon-token branches,
  or else polls `$CLAUDE_CONFIG_DIR/.credentials.json`. A Pi auth failure would wait on Claude's
  credentials and halt with Claude-specific text.

### Evidence: Pi 1.0.0 output, captured 2026-10-28

Pi is `@earendil-works/pi-coding-agent` 1.0.0, with bundled `@earendil-works/pi-ai` 1.0.0. Every
capture ran `pi -p "say hi" --no-session --mode json --provider <p> --model <m>` with
`env -i`, a throwaway `HOME` and `PI_CODING_AGENT_DIR`, and stdin closed. Each upstream request
was refused, so no tokens were billed.

| # | Condition | Exit | Channel | Captured text (verbatim prefix) |
|---|---|---|---|---|
| E1 | No credential for `deepseek` | 1 | stderr | `No API key found for deepseek.` |
| E2 | Invalid key, DeepSeek API | 0 | terminal `errorMessage` | `401: {"message":"Authentication Fails, Your api key: ****0000 is invalid (request_id: 72ea5ff9-8912-4cdf-ab67-9dfd24e4af24)","type":"authentication_error","param":null,"code":"invalid_request_error"}` |
| E3 | Invalid key, OpenRouter | 0 | terminal `errorMessage` | `401: {"message":"User not found.","code":401}` |
| E4 | Invalid key, Anthropic API | 0 | terminal `errorMessage` | `401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CgUU8ag6NK3M6kEMhoWvU"}` |
| E5 | Expired OAuth with a rejected refresh token, Anthropic | 0 | terminal `errorMessage` | `OAuth refresh failed for anthropic: Anthropic token refresh request failed.` |
| E6 | HTTP 429 rate limit, OpenAI-compatible API | 0 | terminal `errorMessage` | `429: {"message":"Rate limit reached for requests","type":"requests","param":null,"code":"rate_limit_exceeded"}` |
| E7 | HTTP 429 `insufficient_quota`, OpenAI-compatible API | 0 | terminal `errorMessage` | `429: {"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}` |
| E8 | HTTP 429 `rate_limit_error`, Anthropic API | 0 | terminal `errorMessage` | `429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}` |
| E9 | HTTP 500, OpenAI-compatible API | 0 | terminal `errorMessage` | `500: {"message":"The server had an error while processing your request.","type":"server_error","param":null,"code":null}` |

E2 to E5 reached the real DeepSeek, OpenRouter, Anthropic and Anthropic-OAuth endpoints with bogus
credentials. E6 to E9 ran Pi's real HTTP stack against a local stub upstream, configured through a
throwaway `models.json` with `api: openai-completions` or `api: anthropic-messages`. The status and
the body were chosen for the stub. Pi's handling of them is Pi's: the status prefix, the separator,
the retry decision, the exit code, and the event shape. For E6, E8 and E9, Pi emitted three
`auto_retry_start` events and then `auto_retry_end` with `success: false`. For E7 it emitted none.
For every terminal error stop, the last assistant `message_end` named the upstream in
`message.provider`.

Source confirmations in the installed package:

- `pi-ai/dist/utils/error-body.js` `formatProviderError` composes `<status>: <body>` when the SDK
  error message does not already carry the body. Otherwise it keeps the SDK message, which the
  Anthropic SDK writes as `<status> <body>`. That accounts for both separators.
- `pi-ai/dist/utils/retry.js` holds Pi's own quota vocabulary, which Pi refuses to retry:
  `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` (`GoUsageLimitError`, `FreeUsageLimitError`,
  `Monthly usage limit reached`, `available balance`, `insufficient_quota`, `out of budget`,
  `quota exceeded`, `billing`, `subscription_sharing_usage_limit_exceeded`).
- `pi-coding-agent/dist/core/agent-session.js` throws `Authentication failed for "<provider>".
  Credentials may have expired or network is unavailable.` when a stored OAuth credential cannot be
  resolved. It throws the `formatNoApiKeyFoundMessage` text, `No API key found for <provider>.`,
  when no credential is configured. `dist/modes/print-mode.js` prints a thrown error on stderr and
  returns 1.
- `pi-ai/dist/auth/resolve.js` raises `OAuth refresh failed for <providerId>` (E5).
- `pi-ai/dist/api/*.js` raise `No API key for provider: <provider>` inside the request stream. D14
  of `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` captured it on Pi 0.84.3 as an
  exit-0 error stop.
- `docs/cli-integration.md`: in JSON mode a failed assistant response "does not by itself produce a
  nonzero exit status". `docs/models.md`: a stored `auth.json` credential takes precedence over a
  provider's environment variable.
- `pi auth check --provider <p> --json` reports `{"status":"ready"}` both for an invalid key that is
  present and for an expired OAuth credential under `--no-refresh`. It proves presence, not
  validity.

## Options Considered

### Option A: Classify in the adapter only

Set `authFailure` and `rateLimited` in `pi-provider.ts` and change nothing else. Rejected. A Pi auth
failure would poll Claude's credentials file (Context), which is worse than today's plain failure.

### Option B: Pi declares `readiness`, probed with `pi auth check`

Reuse the Codex readiness branch. Rejected. The probe reports `ready` for a present but rejected
key (Evidence). The park would resume at once, the retry would fail with a 401, and the run would
park again. That is an unbounded loop of real upstream requests with no budget burn.

### Option C: A declared credential-file park for Pi (chosen)

Pi's catalog descriptor declares the file that holds its stored credentials. A Pi auth failure
parks until that file changes, as the Claude park waits on `.credentials.json`. A change is the
only event that can make a retry succeed: Pi re-reads `auth.json` on every invocation, and a stored
credential overrides an environment key. A park that sees no change ends at the existing
`auth_park_timeout_minutes` bound.

### Option D: Anchor on Pi's retry events instead of the error text

Pi's `auto_retry_start` events are structured, but Pi also emits them for a 500, for network
errors, and for timeouts (E9). Using them would turn a real server failure into a rate-limit wait.
Rejected as the sole signal. The terminal status prefix is the discriminator.

## Decision

### D1. The anchored signatures

The Pi adapter recognizes exactly these signatures. Each is matched case-sensitively at the start of
a line of the classified text (D2).

| Class | Signature | Evidence |
|---|---|---|
| auth, missing | `No API key found for ` | E1 |
| auth, missing | `No API key for provider: ` | adr-2026-09-24 D14; `pi-ai/dist/api/*.js` |
| auth, unusable | `Authentication failed for "` | `agent-session.js` |
| auth, unusable | `OAuth refresh failed for ` | E5; `auth/resolve.js` |
| auth, unusable | `401` followed by `: ` or a space | E2, E3, E4 |
| usage exhaustion | `429` followed by `: ` or a space, where the same text also matches Pi's quota vocabulary (Context) | E7; `utils/retry.js` |
| rate limit | `429` followed by `: ` or a space, otherwise | E6, E8 |

HTTP 403 and 402, a 5xx status, upstream model-not-found under an explicit `--provider`, and limit
wording that arrives without an HTTP status stay unclassified. None of them has a verified shape,
and D5 of adr-2026-09-24 requires one.

### D2. Only Pi-owned channels are classified

The classified text is the terminal assistant message's `errorMessage` when Pi exits 0 with
`stopReason: "error"` (D14). It is Pi's stderr when Pi exits non-zero. Assistant text content, tool
results, intermediate error stops that Pi retried, and the output of a successful run are never
classified. Pi sets `errorMessage`, not the model, so model output cannot forge a signature.

### D3. Precedence

Classification runs in this order: ENOENT or exit 127; usage exhaustion; rate limit; auth;
unknown-model `modelUnavailable`; ordinary failure. Classification also runs before the existing
missing-structured-result check, so a native-schema dispatch that is rate-limited reports the rate
limit rather than a parse failure. The 401 and 429 signatures cannot both match one text. The order
follows the Codex adapter, where rate limits precede auth.

### D4. Result mapping

The mapping follows the Codex adapter.

- A rate limit returns `rateLimited: true`. It has no `waitSeconds`, so the step runner's 300-second
  default applies. Pi's message carries no verified reset time.
- A usage exhaustion returns `rateLimited: true`, `usageExhausted: true` and `waitSeconds: 3600`.
- An auth failure returns `authFailure: true` and an `authentication` record
  `{ provider: 'pi', source: 'cached-login', state }`. `state` is `missing` for the two
  missing-credential signatures and `unusable` otherwise.
- Each of these results has `success: false`. Its `output` is a fixed sentence naming the class and
  Pi. It never carries the provider's error body, which can contain a masked key fragment, a
  request id, or a refresh-token diagnostic.
- Failed-attempt token usage is reported as it is today. `modelUnavailable` and the
  ordinary-failure `exitFacts` are unchanged.

The `authentication` record's provider type admits the catalog ids that declare either `readiness`
or `credentialFileRecovery` (D5). `AuthenticationSource` and the `authenticationSource` telemetry
field are unchanged.

### D5. Pi declares a credential-file recovery

`ProviderCapability` gains `credentialFileRecovery`. A built-in descriptor that declares it also
declares `credentialRecoveryFile`, a path relative to the provider's live home. Pi declares the
capability with `credentialRecoveryFile: 'auth.json'`. The live home is the `PI_CODING_AGENT_DIR`
environment value, else the descriptor's default home. Claude and Codex declare neither. The
capability is not added to `PROVIDER_CAPABILITY_OWNERS`, because no intake owns turning it on for
another provider.

### D6. The credential-file park

`parkOnAuthFailure` gains one branch. It runs after the readiness branch and before every Claude
branch, and it is selected when the failed result's `authentication.provider` names a descriptor
that declares `credentialFileRecovery`. The branch:

- emits the existing `credentials_park` event with the reason `Pi credentials rejected or missing —
  waiting for the Pi credentials file to change`;
- waits through the existing `waitForCredentialsChange`. The file is the resolved credential file,
  the initial state is `expired`, the timeout is `auth_park_timeout_minutes`, and the content
  classifier accepts a file that parses as a JSON object;
- returns `recovered` when the file's mtime advances and it parses. The serial loop and the group
  JOIN then resume as they do for any recovered park, with the retry budget intact;
- returns `halt` on timeout. The halt reason names Pi, the credentials file path, and the remedy:
  store a working credential with Pi, or fix the provider's environment key and restart the
  daemon. It contains no provider output.

Both auth paths already carry the `authentication` record, the serial loop through
`StepRunResult` and the group JOIN through the `authFailure` no-verdict outcome. The branch
therefore covers both without new plumbing. It never reads `~/.claude`, and the Claude branches
stay unchanged for every result they handled before.

### D7. Ladder behavior

An auth failure stops the candidate walk. `classifyProviderCandidateFailure` gives `authFailure`
recovery precedence, as it does for Claude and Codex, so the next candidate is never invoked. A
plain rate limit also stops the walk and waits before retrying Pi. A usage exhaustion suppresses
`pi` in `providerAvailability` until its deadline, so every other dispatch in that window refuses
Pi as `provider-suppressed` and its walk advances. The dispatch that observed the exhaustion waits
for the deadline and then retries, as the serial loop already does for Codex exhaustion. Suppression is keyed by the harness provider id, so a
quota exhausted on one upstream suppresses every Pi candidate for that window. This matches how
Claude and Codex exhaustion suppress their provider.

### D8. Tests use committed captures

Default-suite tests never spawn a real Pi. Classification tests drive the adapter's fake subprocess
with committed fixtures under `src/conductor/test/fixtures/pi/`. Each fixture's terminal
`errorMessage` or stderr is copied byte for byte from the Evidence table, and its event framing
follows the existing `error-stop-live-capture.jsonl` fixture.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Pi 1.0.0 renders an HTTP rejection as an exit-0 error stop whose `errorMessage` starts with the status and then `: ` or a space (E2-E4 and E6-E9; `formatProviderError` in `pi-ai/dist/utils/error-body.js`) | verified | 95% | yes | 401 or 429 would go unrecognized and stay an ordinary failure | n/a (verified) |
| A2 | A missing Pi credential exits 1 with `No API key found for <provider>.` on stderr (E1; `auth-guidance.js`) | verified | 97% | yes | Missing credentials would stay ordinary failures | n/a (verified) |
| A3 | Without this change, a Pi `authFailure` reaches the Claude credential branches of `parkOnAuthFailure`, because Pi declares no `readiness` (read in `engine/conductor.ts`) | verified | 95% | yes | The new branch would be unnecessary | n/a (verified) |
| A4 | `authFailure` and `rateLimited` stop the candidate walk, and a suppressed provider is refused as `provider-suppressed` on the next walk (`hasRecoveryPrecedence` and the `isAvailable` check in `engine/provider-execution.ts`) | verified | 95% | yes | The ladder would advance on auth, or fail to advance on exhaustion | n/a (verified) |
| A5 | The serial loop and the group JOIN both carry the adapter's `authentication` record to `parkOnAuthFailure` (`toStepRunResult` and `runAutonomous` in `step-runners.ts`; `makeNoVerdictOutcome` in `group-core.ts`; the JOIN in `conductor.ts`) | verified | 90% | yes | One path would still fall through to the Claude park | n/a (verified) |
| A6 | A self-host Pi dispatch provisions its throwaway home, and so re-resolves the credential, on every candidate dispatch (the `provisionProviderHome` call in `conductor.ts`) | verified | 90% | no | A resumed self-host retry would reuse the old key and park again until timeout | n/a (verified) |
| A7 | Stub-upstream captures stand in for a real provider 429. Pi's formatting and retry handling are independent of which host answered (E6-E8 against the `error-body.js` and `retry.js` sources) | inferred | 85% | no | A provider whose 429 body changes the prefix would stay unclassified, which fails safe | n/a (not load-bearing) |

## Consequences

### Positive

- Pi rate limits wait and retry like Claude's and Codex's, and Pi usage exhaustion advances the
  ladder.
- A Pi auth failure parks on Pi's own credentials and resumes when they change. It no longer burns
  the retry budget, and it can never wait on Claude's credentials.
- Every anchored signature has a committed capture, so a Pi upgrade that changes a shape breaks a
  named test.

### Negative

- A provider-agnostic `429` prefix is the only rate-limit signal. A gateway that returns 429 for a
  different reason waits and retries instead of failing at once. Pi itself treats every 429 as
  retryable.
- Quota wording outside Pi's vocabulary, and quota errors without a 429, still fail the step.
- An unrelated `auth.json` change, such as an interactive Pi session refreshing another provider's
  OAuth token, ends the park early. The retry then fails and parks again, so each spurious
  recovery costs one upstream request.

### Follow-up Actions

- jstoup111/ai-conductor#3505 tracks upstream model-not-found under an explicit `--provider`, which
  `pi-per-step-model-selection-via-wrapped-providers` Story 5 attributes to #2718. It needs a real
  credential to capture and is outside this intake's desired outcomes.
