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

   > **Amended 2026-08-28 by #2006:** a second *typed* progress shape now shares this
   > exemption — see the Amendment section below. The shape-only rule itself is unchanged
   > and is strengthened: no `retry_finish`, and no reason string, is ever exempt.

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

## Amendment — 2026-08-28 (#2006): judged-deficiency progress is its own typed shape

**Amended by:** James Stoup (operator), engineer loop (#2006). **Status is unchanged: the
decision stands.** Discrimination is still on the result shape, never on a reason string. This
amendment names a second progress shape the original decision did not anticipate; it re-decides
nothing about the five synthesised reasons, and it does not relax decision 4 — it closes the
loophole a reason-string exemption had opened underneath it.

**What forced it.** The `revision_required` prose lap adopted by the 2026-08-28 amendment to
`adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns`
routes a judged-deficient revision back to `author_pr_prose`. That lap is an advance of the
author→judge machine, and the same amendment states it is bounded by the publication-progress
allowance rather than by `finish`'s retry budget. The shipped implementation reached that outcome
by matching the reason string `authoring_required_after_judgment` on a `retry_finish` route,
decrementing `attempt`, and re-entering FINISH without charging (`conductor.ts:8412-8422`) —
exactly the reason-string exemption decision 4 exists to forbid, with an unchecked
`as Extract<…>` cast at the branch as the tell that the shape did not carry the meaning. The
as-built architecture review recorded this as blocking finding AB-1 on 2026-08-28.

Making every `retry_finish` charge instead was considered and rejected: it would contradict the
already-approved outcome that non-converging author→judge laps terminate at the
publication-progress allowance, converting a bounded lap into a retry-budget exhaustion halt with
a different and less accurate meaning.

**Decision 4 is extended, not relaxed.**

5. `PublicationDisposition` gains `{ kind: 'publication_revision_progress'; transition:
   'author_pr_prose'; detail?: string }`: an advance of the author→judge machine reported by
   `mapPrProseJudgmentResult` when a persisted `revision_required` verdict (reason `placeholder`
   or `structurally_incomplete`) requires another authoring pass. It is distinct from
   `publication_progress` (a verified effect completed by the coordinator) and from
   `publication_retry` (a failure). `detail` carries the judge's objection when the verdict
   supplied one.
6. `FinishPublicationRoute` gains `{ kind: 'revision_progress_finish'; transition; detail? }`, and
   `routeFinishPublicationDisposition` returns it for the new kind.
7. Exactly two routes re-enter FINISH without charging `stepMaxRetries`: `progress_finish` and
   `revision_progress_finish`. Every `retry_finish` charges exactly as decision 4 states, and no
   reason string ever exempts one. The conductor holds no branch on a retry reason for accounting
   purposes, and `authoring_required_after_judgment` is retired from the `author_pr_prose` retry
   vocabulary in the same change so the exemption cannot be recreated by string.
8. Bounded accounting is preserved: every `revision_progress_finish` re-entry is charged to the
   existing publication-progress allowance (`FINISH_PUBLICATION_PROGRESS_ALLOWANCE`, unchanged in
   value and derivation), exactly as `progress_finish` is. Neither progress shape may re-enter
   without charging that allowance, so a non-converging author→judge pair still terminates at the
   bound.
9. `isExactDisposition` widens to the new kind under the same exact-key discipline the other kinds
   get: `kind` + `transition`, or `kind` + `transition` + a non-empty string `detail`, with
   `transition` restricted to `author_pr_prose`. A malformed adapter result still halts rather
   than being read as progress.
10. The retry-path freshness rule from the 2026-08-13 amendment continues to govern this shape: a
    `publication_revision_progress` naming a transition the fresh observation would not select
    resolves `human_required`, and a halted PR still resolves `halt_state_pr` first. Changing the
    shape must not smuggle the disposition past that reconciliation.

## Consequences of the amendment

- The accounting rule becomes readable from the type alone: which shapes are exempt is a closed
  union, checked by the compiler and by the fail-closed validator, instead of a string comparison
  in the serial loop that no exhaustiveness check can find.
- A future transition that legitimately advances a sub-machine follows the same path — add a typed
  shape and charge it to the allowance — rather than adding a reason string to the exemption
  branch.
- The disposition union widens again, so the fail-closed validator moves with it in the same change
  or a correct adapter result routes to a HALT (unchanged discipline, restated because it now
  applies to two progress kinds).
- Dispositions exist only in memory for the duration of a FINISH attempt, so retiring the reason
  string carries no on-disk or cross-version compatibility obligation.
- The `finish_publication_disposition` event union is unchanged: `progress_finish` emits no
  disposition event today, and `revision_progress_finish` follows that precedent, so no consumer of
  the event spine changes.
