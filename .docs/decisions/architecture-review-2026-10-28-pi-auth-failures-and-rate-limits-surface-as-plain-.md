# Architecture Review: Pi auth failures and rate limits surface as plain step failures
**Date:** 2026-10-28
**Inputs reviewed:** no PRD and no stories. This is the pre-stories lightweight review (Tier M,
technical track). Its inputs are:
- `.docs/track/pi-auth-failures-and-rate-limits-surface-as-plain-.md`
- `.docs/complexity/pi-auth-failures-and-rate-limits-surface-as-plain-.md`
- the approved diagram `.docs/architecture/pi-auth-failures-and-rate-limits-surface-as-plain-.md`
- intake jstoup111/ai-conductor#2718

**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Plain TypeScript in the existing adapter and engine, with no new dependency. The park reuses `waitForCredentialsChange` (`engine/self-host/operator-credentials.ts`) and its `contentClassifier` seam, which the daemon-token park already uses. |
| Prerequisites | None. Pi 1.0.0 is installed, and every anchored shape was captured on 2026-10-28 (ADR Evidence). |
| Integration surface | `execution/pi-provider.ts` (classification), `execution/llm-provider.ts` (the `authentication` record type), `execution/provider-catalog.ts` (the declared capability and file), and `engine/conductor.ts` (`parkOnAuthFailure`). Everything is in-process. |
| Data implications | None persisted. The park reads the operator's Pi `auth.json` mtime and checks only that it parses; it never logs or copies its content. |
| Performance risk | One extra pass of line-anchored matching over a failed Pi result. The park polls once per second, as the Claude park does. |
| Worktree isolation | No ports or services. The watched file is the operator's live Pi home, which the self-host live fingerprint already excludes as Pi's selected auth path (adr-2026-09-24 D24 and D26). |

**Verified facts behind the design (2026-10-28):**

- The Pi 1.0.0 output shapes in the ADR's Evidence table were captured by running the local `pi`
  CLI against refusing endpoints and a local stub upstream. Confidence 95%, verified.
- `parkOnAuthFailure` enters its readiness branch only when `supportsProviderCapability(descriptor,
  'readiness')` holds. Otherwise it reaches the self-host api-key or daemon-token branch, or the
  operator `.credentials.json` poll. Confidence 95%, verified (`engine/conductor.ts`).
- `hasRecoveryPrecedence` makes `classifyProviderCandidateFailure` return `undefined` for
  `authFailure` and `rateLimited`. The candidate loop then returns the result instead of
  advancing. Confidence 95%, verified (`engine/provider-execution.ts`).
- The serial `result.rateLimited` branch calls `providerAvailability.suppress(provider, deadline)`
  only when `usageExhausted === true` and `actualProvider` is set. The next walk refuses a
  suppressed provider with `provider-suppressed`. Confidence 95%, verified (`engine/conductor.ts`,
  `engine/provider-execution.ts`).
- The adapter's existing D14 branch returns early for an exit-0 error stop, after the
  missing-structured-result return. A rate-limited native-schema dispatch therefore currently
  reports `missing structured result`. Confidence 95%, verified (`execution/pi-provider.ts`).
- `pi auth check --json` reports `ready` for a present but invalid key. Confidence 95%, verified by
  running it in a throwaway home.

## Alignment

- **`adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` D5 and D14.** D5 already places
  anchored auth and rate-limit signatures in the classification order, and requires confirmation
  against real output first. This design supplies the confirmation and keeps every unconfirmed
  shape an ordinary failure. D14's error-stop channel is the main channel classified. Aligned, with
  no amendment: no assertion in the ADR is falsified.
- **`adr-2026-07-04-auth-failure-park-and-poll`.** Auth classification precedes model availability
  and retry, never consumes budget, and parks until the credential source changes, with a timeout
  HALT that names the file. Aligned. The new branch is that ADR's D5 identity seam applied to a
  second credential file.
- **Catalog principle: declared, not inferred.** The park is selected by a declared capability and
  file, never by comparing provider ids. Aligned.
- **Event spine.** The park emits the existing `credentials_park` event. No new channel, file, or
  event type is added. Aligned.
- **Codex adapter precedent.** Rate limits precede auth, usage exhaustion is a rate limit with an
  hour-scale wait, and auth output is replaced with a fixed safe sentence. Aligned.
- **Diagram accuracy.** The approved diagram reflects this design.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| Pi signature classification | `PiProvider.invoke`, which every Pi dispatch reaches through `createProviderRuntimeSet`. |
| `credentialFileRecovery` capability and `credentialRecoveryFile` | Declared in the Pi descriptor in `BUILT_IN_PROVIDERS`. Read by the new `parkOnAuthFailure` branch. |
| Credential-file park branch | `parkOnAuthFailure`, which the serial loop, the group JOIN, and the attribution verifier already call. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A Pi upgrade changes an error shape | Integration | Medium | Medium | Fails safe to an ordinary failure. Fixture tests name each captured shape |
| A non-limit 429 waits instead of failing | Technical | Low | Low | Bounded by the existing rate-limit wait and episode caps |
| An unrelated `auth.json` write ends the park early | Technical | Medium | Low | The retry fails and parks again; each cycle costs one request and no budget |
| The Pi branch shadows a Claude or Codex park | Technical | Low | High | Selected only by the declared capability; Claude and Codex park tests stay unchanged (C3) |
| Provider error bodies leak into HALT text or events | Security | Low | Medium | Fixed output sentence and a HALT built only from the path and remedy (C2) |

## ADRs Created

- `adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output` (APPROVED
  2026-10-28; every load-bearing assumption is verified).

## Conditions

- **C1.** No signature outside the ADR's D1 table is anchored, and each anchored one has a committed
  fixture copied from the Evidence table.
- **C2.** No Pi auth, rate-limit, or exhaustion result, HALT reason, or event contains the provider's
  error body.
- **C3.** Claude's and Codex's park branches behave identically for every result they handled
  before, proven by their existing tests passing without edits.
- **C4.** A Pi auth failure never waits on Claude's credentials, proven by a test in which a
  `$CLAUDE_CONFIG_DIR/.credentials.json` refresh during a Pi park does not resume it.
