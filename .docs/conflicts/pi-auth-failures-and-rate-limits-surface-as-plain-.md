# Conflict Check: Pi auth failures, rate limits, and usage exhaustion are classified (#2718)

**Date:** 2026-10-28
**New stories:** `.docs/stories/pi-auth-failures-and-rate-limits-surface-as-plain-.md` (Stories 1 to 5)
**Result:** PASSED. Zero blocking conflicts. Two contradictions with accepted Pi stories were
resolved by in-place story amendments committed on this spec branch.

## Inventory

- Every file in `.docs/stories/` was screened by subject: `authFailure` and auth parking,
  `credentials_park`, rate limits and `rateLimited`, usage exhaustion and provider suppression,
  Pi error stops, and Pi classification. Pairs sharing a behavior with a new story were read in
  full and checked in both directions.
- Prior reports in `.docs/conflicts/` contain no recurring pattern for this area.

### ADRs examined (subject overlaps the new stories)

- `adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output`: the governing ADR. Stories 1 to 5 implement D1 to D8. No conflict.
- `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` (D5, D14, D24 to D26): D5 already orders anchored auth and rate-limit signatures and requires capture first, which Story 5 supplies. D14's error stop is the classified channel. D24 already excludes Pi's `auth.json` from the live fingerprint, so watching it trips nothing. No conflict.
- `adr-2026-07-04-auth-failure-park-and-poll` (decisions 1 to 5): Story 4 parks until the credential source changes, with the retry budget intact and a timeout HALT naming the file. No conflict.
- `adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability`: Story 2 uses the existing `suppress` path and the existing `provider-suppressed` refusal. No conflict.

### ADRs narrowed out

Every other APPROVED ADR in `.docs/decisions/` is unrelated: none touches provider failure
classification, auth parking, or provider suppression. Examples are the memory provider ADRs, the
cost and transcript ADRs, and the system-prompt delivery ADR
(`adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability`), whose Pi argv changes do
not touch failure classification.

## Pairs checked and found compatible

| New story | Existing story | Both directions hold? | Note |
|---|---|---|---|
| Story 3 | `sandbox-auth-expiry-park` (auth failure marks no model unavailable and takes no ladder step; a zero-exit mention is not an auth failure) | yes | Story 3's success-text negative is the same rule for Pi. |
| Story 4 | `sandbox-auth-expiry-park` (Claude operator-credential park) | yes | Story 4's last negative keeps the Claude park unchanged for results without an `authentication` record. |
| Story 4 | `codex-readiness-park-970` NP-3 (Claude and API-key recovery keep their behavior) | yes | The new branch runs only for a provider declaring `credentialFileRecovery`; the readiness branch is unchanged. |
| Story 3, Story 4 | `per-step-provider-routing-927` (an auth failure invokes only that provider's recovery path, and no alternate provider is attempted) | yes | Pi's recovery path is its credential-file park, and claude is never invoked. |
| Story 2 | `usage-exhaustion-re-dispatches-the-exhausted-provi` (a suppressed candidate records `invoked: false` with the suppression reason, and suppression is daemon-scoped) | yes | Story 2 reaches that path through `usageExhausted`, unchanged. |
| Story 1 | `daemon-api-rate-limit-episode-cascades-into-mass-h` (rate-limit episode coordination) | yes | A Pi rate limit enters the same episode as any provider's. |
| Story 5 | `pi-as-a-build-provider` Story 5 (default-suite tests never spawn a real Pi) | yes | Story 5's second happy path restates it for the new tests. |
| Story 5 | `pi-runs-report-token-usage-and-cost-into-harness-t` (failed-attempt usage) | yes | Classification leaves failed-attempt usage reporting unchanged. |

## Conflict: `pi-as-a-build-provider` Story 6 forbids Pi auth and rate-limit signals

**Stories involved:** Stories 1 to 3 vs `pi-as-a-build-provider` Story 6
**Files:** `.docs/stories/pi-auth-failures-and-rate-limits-surface-as-plain-.md` vs `.docs/stories/pi-as-a-build-provider.md`
**Type:** contradiction
**Severity:** blocking until resolved

**Description:** Story 6's last negative path said Pi auth-failure or rate-limit output yields an
ordinary failure "because no Pi auth or rate-limit signature is anchored in this feature", and a
Done When item said the adapter anchors none. Both were scoped to #1884 and deferred to a follow-up
intake, which is #2718.

**Resolution:** amended in place (commit `spec: amend pi-as-a-build-provider Story 6 …`). The
criterion now says output matching none of #2718's anchored signatures stays an ordinary failure,
and the Done When says only #2718's verified signatures are anchored. Both stories now hold.

## Conflict: `pi-per-step-model-selection-via-wrapped-providers` Story 7 forbids signals on any error stop

**Stories involved:** Story 3 vs `pi-per-step-model-selection-via-wrapped-providers` Story 7
**Files:** `.docs/stories/pi-auth-failures-and-rate-limits-surface-as-plain-.md` vs `.docs/stories/pi-per-step-model-selection-via-wrapped-providers.md`
**Type:** contradiction
**Severity:** blocking until resolved

**Description:** Story 7 said any exit-0 error stop sets none of `authFailure`, `rateLimited`, or
`modelUnavailable`, and that the `No API key for provider: cline` failure carries that text. Story
3 classifies that message as an auth failure with a fixed, redacted output.

**Resolution:** amended in place (commit `spec: amend pi-per-step-model-selection Story 7 …`). The
`cline` criterion now expects the auth-failure signal, the negative path is scoped to error stops
matching no anchored signature, and the fixture Done When drops the carried-text clause. Story 7's
remaining criteria, a failed result for any error stop and the no-message fallback, still hold.
