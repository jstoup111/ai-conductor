# ADR: Publication progress is its own disposition, not an exempted retry reason

**Date:** 2026-08-06
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer loop (#1342)

## Context

`finish-publication-production.ts:338-356` takes a verified, successful transition —
`advanceFinishPublication` returning `{ kind: 'advanced', transition }` — and rewrites it
into `{ kind: 'publication_retry', transition, reason }` with one of five synthesised
reasons. `finish-publication.ts:563` routes every `publication_retry` to
`{ kind: 'retry_finish' }`, and `conductor.ts:5519` gates that on
`if (attempt < stepMaxRetries)` with `max_retries` resolving to 6 for `finish`. So each
successful advance spends one of six failure retries.

Observed twice on 2026-08-06 (PRs #1337 and #1338), both succeeding at try 5/6 with one
attempt of margin. Every `↻ finish retry` line in those logs directly follows a `✓`.

The filed issue proposed exempting the five enumerated reasons —
`pr_identity_not_verified_after_establish`, `shipped_record_not_verified_after_write`,
`judgment_completed_reobserve`, `presentation_not_verified_after_repair`,
`outcome_record_not_verified_after_write` — from budget consumption, on the stated basis
that `PUBLICATION_RETRY_REASONS` already distinguishes them.

**That basis does not hold, and was verified false by reading (~95% confidence).** Four of
those five strings are also returned by `advance` itself for genuine failures:

| Reason | Progress site | Genuine-failure site |
|---|---|---|
| `pr_identity_not_verified_after_establish` | production adapter `:347` | `finish-publication.ts:1085` — push published but re-observation found no single PR |
| `shipped_record_not_verified_after_write` | adapter `:349` | `:1132` — write returned but the record did not observe as valid |
| `presentation_not_verified_after_repair` | adapter `:353` | `:1201` — repair ran but the PR is not ready/accepted |
| `outcome_record_not_verified_after_write` | adapter `:354` | `:1230`, `:1269` — recorder ran or PR identity absent, marker not valid |

Exempting by reason string would make each of those genuine failures retry with a budget
that is never spent — converting a spurious HALT into an unbounded publication loop, which
the issue's own third desired outcome explicitly forbids.

## Decision

Discriminate on the **result shape**, not the reason string.

1. `PublicationDisposition` gains `{ kind: 'publication_progress'; transition }`.
2. The production adapter maps `{ kind: 'advanced', transition }` to that kind instead of
   synthesising a `publication_retry`. The five synthesised reason strings stop being
   produced by the adapter entirely; they remain valid failure reasons emitted only by
   `advance`.
3. `FinishPublicationRoute` gains `{ kind: 'progress_finish'; transition }`, and
   `routeFinishPublicationDisposition` returns it for the new kind.
4. Only `progress_finish` re-enters FINISH without charging `stepMaxRetries`. Every
   `retry_finish` charges exactly as it does today.

`isExactDisposition` is extended to accept the new kind under the same exact-key
discipline it applies to the others, so the fail-closed boundary keeps rejecting a
malformed adapter result rather than treating it as progress.

## Consequences

- A genuine `*_not_verified_after_*` failure is unaffected: it still arrives as
  `publication_retry`, still charges the budget, still halts on exhaustion.
- The full six-retry budget survives an entire successful publication and remains available
  to absorb a real transient — the budget's stated purpose is restored, not removed.
- `AdvanceFinishPublicationResult` is unchanged; the adapter's mapping is the only place
  that previously discarded the distinction.
- The disposition union widens, so the fail-closed validator must widen with it in the same
  change or a correct adapter result routes to a HALT.
- This is deliberately finish-only. #1006 (rate-limit retries charging the step budget) and
  #1107 (finish's STOP refusal retried as an ordinary failure) are the same conflation
  elsewhere and are not addressed here.

## Alternatives rejected

- **Exempt the five reason strings** (as filed). Rejected: the strings are ambiguous, so
  this exempts real failures and removes their termination guarantee.
- **Stop verifying after each effect and complete the whole machine in one attempt.**
  Rejected: `finish-publication-production.ts:338` documents the one-effect-per-attempt
  rule as deliberate — it exists so completion is never manufactured from an unverified
  write. The defect is the accounting, not the verification discipline.
- **Raise `finish`'s `max_retries`.** Rejected: it buys margin without fixing the
  conflation, and scales the wrong number — a longer machine would silently reintroduce it.
