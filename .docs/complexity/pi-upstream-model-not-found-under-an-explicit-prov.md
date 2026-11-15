# Complexity: Pi upstream model-not-found under an explicit provider is an ordinary failure

Tier: S

## Rationale

- One production file: `src/conductor/src/execution/pi-provider.ts` gains one anchored signature and
  sets the existing `modelUnavailable` result field when the terminal error stop matches it. Two new
  committed fixtures under `src/conductor/test/fixtures/pi/` and tests in the existing Pi adapter
  and Pi fallback test files.
- No engine change. The model ladder already walks on `modelUnavailable` for every provider
  (`ModelAvailability.invokeWithLadderResolved` in `engine/model-availability.ts`), and the Pi
  ladder is already wired per provider (`provider-execution-pi-fallback.test.ts`, "walks the
  configured Pi ladder").
- No new module, layer, dependency, CLI flag, hook, settings key, or persisted format.
- Stays inside the approved Pi classification design
  (adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output D2 channels and
  D3 precedence). Its D1 list is amended to add the newly captured signature; D1 already deferred
  this class only for want of a verified shape.
- Three stories.

## Evidence: Pi 1.0.0 output, captured 2026-11-15

Captured with operator approval using `pi -p "say hi" --no-session --mode json --provider <p>
--model nonexistent-model-xyz`, under `env -i`, with a throwaway `HOME` and `PI_CODING_AGENT_DIR`
holding only that provider's real credential, and stdin closed. Both runs exited 0, wrote
`Warning: Model "nonexistent-model-xyz" not found for provider "<p>". Using custom model id.` on
stderr, and ended with a terminal assistant `message_end` with `stopReason: "error"` and all usage
and cost fields 0, so nothing was billed.

| # | Upstream | Terminal `errorMessage` (verbatim; request id masked) |
|---|---|---|
| E10 | OpenRouter | `400: {"message":"nonexistent-model-xyz is not a valid model ID","code":400}` |
| E11 | DeepSeek | `402: {"message":"Insufficient Balance (request_id: 00000000-0000-0000-0000-000000000000)","type":"insufficient_balance_error","param":null,"code":"invalid_request_error"}` |

DeepSeek refused the request for account balance before it judged the model, so no DeepSeek
unknown-model shape exists. By operator decision (2026-11-15) only the OpenRouter shape is anchored;
every other upstream stays unclassified.

## Assumptions

| Assumption | Confidence | Basis | Impact if wrong | Status |
|---|---|---|---|---|
| OpenRouter's unknown-model body starts `400: {"message":"<model> is not a valid model ID"` for any requested id, not only the captured one | 85% | inferred | another id's rejection stays an ordinary failure, which fails safe | APPROVED by operator 2026-11-15 |
| No non-unknown-model failure produces an error stop beginning with that text | 95% | inferred | a different failure would walk the ladder; the phrase names the model as invalid, so this is narrow | APPROVED by operator 2026-11-15 |

Per tier rules, architecture-diagram, architecture-review, conflict-check, coherence-check, and
plan-review are skipped.
