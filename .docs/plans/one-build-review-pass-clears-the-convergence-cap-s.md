# Implementation Plan: One build_review PASS clears the convergence cap

**Date:** 2026-08-18
**Design:** .docs/decisions/adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md
**Stories:** .docs/stories/one-build-review-pass-clears-the-convergence-cap-s.md
**Stories status:** Accepted; Stories 1–5
**Conflict check:** Clean as of 2026-08-18
**Review conditions:** .docs/decisions/architecture-review-2026-08-18-one-build-review-pass-clears-the-convergence-cap-s.md

## Summary

Eleven tasks that stop a `build_review` PASS from zeroing the gate's convergence counters, and credit
those laps back only when a rebase actually invalidated the gate. Closes ai-conductor#1694.

## Technical Approach

**The defect is an over-broad trigger, not a missing bound.** `adr-2026-08-12` D2 authorized clearing
`cumulative` on a PASS to protect one case — a rebase invalidating a legitimate PASS. The
implementation clears it on **every** PASS (`conductor.ts:8521`), and `build_review` is re-opened by
far more than a rebase: any BUILD repair invalidates the prior verification round, so a `manual_test`,
`prd_audit`, `simplify`, or `finish` kickback routes through `build` and re-runs it. A feature that
oscillates PASS → FAIL never accumulates. Over the 15 features with kickback history in
`.daemon/evals-raw` the cap fired on 4; the longest run reached 16 laps.

**The change is to re-key the exemption onto the occurrence that justifies it.** The PASS reset is
deleted. Where `advanceTail` handles a `changed` rebase outcome, the loop that re-opens each
invalidated gate credits `build_review`'s convergence counters back before re-opening it. The
condition is **inherited**, never recomputed: the loop already keys on a verdict with
`satisfied === false && kickback.from === 'rebase'`, which is exactly `adr-2026-07-20`'s invalidated
set, so the credited set and the invalidated set cannot drift. Review condition §4.1 makes that
binding; a second implementation of that ADR's partition at this site is a rejection.

**Why this cannot re-open the hole.** `adr-2026-07-20` preserves `build_review` iff the rebase delta
is empty, so every file-changing rebase invalidates it — which made "the refund is as broad as the
reset" the live risk. Counted over the same corpus: rebase-origin invalidations of `build_review`
occur **once**, against 95 consumed kickbacks. Task 1 re-derives that ratio in-tree; if it comes back
materially different the ADR's approval basis has changed and the task halts rather than proceeding.

**Why no new counter and no new cap.** Both were designed and withdrawn. A floor beside `cumulative`
answers the same question with a different reset rule and owes a third unevidenced threshold; a
lifetime re-read of `cumulative` fires on 7 of 15 features at cap 5 and, at cap 8, only after roughly
nine laps of spend. `adr-2026-08-17`'s per-rubric bound is the early trip and is measured at 5 of 5
on spin; this change exists so it cannot be zeroed.

**The rule is the entry's, not one counter's (ADR D6, operator decision).** No lap-counting field on
`KickbackGateEntry` is cleared by a PASS, and every one is credited by an invalidating rebase. This
binds `adr-2026-08-17`'s `rubricFailures` (merged, unimplemented) and #1629's mechanical-fault
allowance (spec PR #1724, unmerged). `count` is excluded by construction — it is a no-op detector
with its own approved per-tree reset. Tasks 4 and 9 make the generic shape and the exclusion explicit
so a later counter inherits the rule without a further change to the PASS path.

**Observability is not optional scope.** Per the event-spine skill the durable counters are legal as
exception C only because the occurrence is emitted; a silent credit would leave "why did the bound not
fire?" answerable only by ledger archaeology. The credit rides an additive optional field on the
existing `kickback` member — not a new union member, which
`adr-2026-07-26-event-sink-registry-exhaustiveness` would oblige to declare a sink, and not a
`refundedAt` stamp in the ledger, which is the event-spine corollary violation.

## Task Dependency Graph

```
Task 1 (re-derive the ratio)
  └── Task 2 (RED: PASS no longer clears)
        └── Task 3 (GREEN: delete the reset)
              ├── Task 4 (RED+GREEN: credit is generic over the entry's lap counters)
              │     └── Task 5 (RED: credit only on an invalidating rebase)
              │           └── Task 6 (GREEN: conditional one-shot credit at the re-open loop)
              │                 ├── Task 7 (RED+GREEN: credit rides the kickback event)
              │                 │     └── Task 8 (negative: no new union member, no sink change)
              │                 └── Task 9 (negative: count excluded; no PASS reset anywhere)
              └── Task 10 (remove the dead helper from the exported surface)
                    └── Task 11 (documentation upkeep)
```

---

### Task 1: Re-derive the invalidation ratio from the persisted corpus
**Story:** 2
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Count consumed `build_review` kickbacks per feature across
   `.daemon/evals-raw/features/*/events.jsonl` and any live worktree ledgers.
2. Count `kickback` records with `from: 'rebase'` and `to: 'build_review'` over the same corpus.
3. Record both figures and the ratio in the commit message. The spec's basis is 95 kickbacks to 1
   rebase-origin invalidation across 15 features.
4. If rebase-origin invalidation is no longer rare relative to consumed kickbacks, stop and halt for
   the operator — the ADR's approval rests on that ratio and a materially different one changes
   whether the refund's trigger is narrow enough to be worth having.
5. Commit an empty commit carrying `Evidence: skipped establishes findings only`.

**Files likely touched:**
- none

**Dependencies:** none

---

### Task 2: RED — a build_review PASS no longer clears the convergence counters
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that a gate entry with a non-zero cumulative lap count still
   reads that count after `build_review` completes with a PASS.
2. Add a failing test asserting a later consumed kickback increments from the retained value rather
   than from 1.
3. Add a failing test asserting the cap is reached when consumed kickbacks exceed
   `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW` with PASSes interleaved among them.
4. Add a test asserting `count` and its per-tree reset behave exactly as before across the same
   sequence.
5. Verify RED.
6. Commit: "test(kickback-ledger): a build_review PASS retains the convergence counters".

**Files likely touched:**
- `src/conductor/test/engine/kickback-ledger.test.ts` — retention, accumulation, cap reachability
- `src/conductor/test/engine/conductor-*.test.ts` — the step-completion path assertion

**Dependencies:** Task 1

---

### Task 3: GREEN — delete the PASS reset from the step-completion path
**Story:** 1
**Type:** happy-path

**Steps:**
1. Remove the `resetKickbackGateCumulativeInLedger` call from the `build_review` branch of the
   step-completion path in `conductor.ts` and its now-unused import.
2. Update any existing test that asserted a PASS zeroes the counter to the new contract — amend the
   assertion, do not delete the test (Story 4 negative path).
3. Verify GREEN, and verify the amended assertions fail against the pre-change behavior.
4. Commit: "fix(build-review): a PASS no longer clears the gate's convergence counters".

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — step-completion path, imports
- `src/conductor/test/engine/kickback-ledger.test.ts` — amended assertions

**Dependencies:** Task 2

---

### Task 4: The credit is generic over the entry's lap counters
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: crediting an entry that carries only the cumulative count succeeds; crediting
   one that also carries a per-rubric tally clears both; crediting one that carries an unknown
   additional lap-counting field clears it too.
2. Add a failing test asserting `count`, `treeHash`, `lastReason`, `priorVerdict`, and
   `resolvedBefore` are preserved unchanged by a credit.
3. Verify RED.
4. Implement the credit helper in `kickback-ledger.ts` over whichever lap-counting fields the entry
   carries, preserving every other field.
5. Verify GREEN.
6. Commit: "feat(kickback-ledger): credit a gate's lap counters without touching its budget state".

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — the credit helper
- `src/conductor/test/engine/kickback-ledger.test.ts` — generic credit, field preservation

**Dependencies:** Task 3

---

### Task 5: RED — the credit is issued only by a rebase that invalidated the gate
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that a `changed` rebase which invalidates `build_review` credits
   its counters before the gate is re-opened.
2. Add a failing test asserting a `changed` rebase whose delta misses `build_review`'s judged surface
   — so `classifyGateInvalidation` preserves it — issues no credit and leaves the counts standing.
3. Add a failing test asserting only `build_review`'s entry is credited when several gates are
   invalidated together.
4. Add a failing test asserting a second consumed kickback after the same rebase issues no further
   credit.
5. Add a failing test asserting the fail-closed fallback — delta or feature surface uncomputable, so
   every gate is invalidated — does issue the credit.
6. Verify RED.
7. Commit: "test(conductor): rebase credit fires only for an actually-invalidated build_review".

**Files likely touched:**
- `src/conductor/test/engine/conductor-rebase-*.test.ts` — invalidated, preserved, scoped, one-shot,
  fail-closed

**Dependencies:** Task 4

---

### Task 6: GREEN — conditional one-shot credit at the re-open loop
**Story:** 2
**Type:** happy-path

**Steps:**
1. In `advanceTail`'s `lastRebaseOutcome.kind === 'changed'` branch, inside the existing loop over
   candidate targets, credit `build_review`'s lap counters when that target is `build_review` and the
   loop's existing predicate holds — the verdict is `satisfied === false` with
   `kickback.from === 'rebase'`.
2. Do **not** call `classifyGateInvalidation` or otherwise recompute the invalidated set at this site;
   the predicate the loop already evaluates is the condition (review condition §4.1).
3. Apply the credit where the gate is re-opened so it is not re-evaluated on later laps.
4. Verify GREEN.
5. Commit: "feat(conductor): a rebase that invalidates build_review credits its convergence laps".

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — the rebase-outcome re-open loop

**Dependencies:** Task 5

---

### Task 7: The credit rides the existing kickback event
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test asserting the `kickback` record emitted for the invalidated `build_review`
   carries the credit and names the gate it applied to.
2. Add a failing test asserting a preserved gate's path emits no credit.
3. Verify RED.
4. Add the additive optional field to the `kickback` member of `ConductorEvent` and populate it at
   the emission site co-located with the credit, one-to-one with it.
5. Verify GREEN, and confirm the field round-trips through the persisted ledger.
6. Commit: "feat(events): the kickback record carries the convergence credit it accompanied".

**Files likely touched:**
- `src/conductor/src/types/events.ts` — `kickback` member
- `src/conductor/src/engine/conductor.ts` — emission at the credit site
- `src/conductor/test/engine/` — emission and round-trip tests

**Dependencies:** Task 6

---

### Task 8: Negative — no new event type and no sink declaration change
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a test asserting `EVENT_SINKS` declares the same set of event types as before this change.
2. Write a test asserting a consumer reading a `kickback` record without the credit field parses it
   unchanged.
3. Verify the tests pass against the implementation and fail if the field is promoted to its own
   union member.
4. Commit: "test(events): the convergence credit adds no event type and no sink".

**Files likely touched:**
- `src/conductor/test/engine/event-sinks.test.ts` — type-set stability
- `src/conductor/test/engine/` — optional-field tolerance

**Dependencies:** Task 7

---

### Task 9: Negative — count is excluded and no PASS reset survives anywhere
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write a test asserting a credit leaves `count` untouched — it is a no-op detector with its own
   per-tree reset, not a lap counter.
2. Write a test asserting that after a `build_review` PASS no lap-counting field on the entry is
   cleared, expressed over the entry rather than over named fields so a later counter is covered.
3. Verify GREEN.
4. Commit: "test(kickback-ledger): the reset rule is the entry's, and count is excluded".

**Files likely touched:**
- `src/conductor/test/engine/kickback-ledger.test.ts` — exclusion, entry-wide assertion

**Dependencies:** Task 6

---

### Task 10: Remove the dead reset helper from the ledger's exported surface
**Story:** 4
**Type:** refactor

**Steps:**
1. Confirm by grep that `resetKickbackGateCumulativeInLedger` has no remaining production caller.
2. Remove the function and its export from `kickback-ledger.ts`, and remove or repoint any test that
   exercised it directly.
3. Verify the full suite is green and the symbol is absent from the source tree.
4. Commit: "refactor(kickback-ledger): drop the now-unreachable cumulative reset helper".

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — removal
- `src/conductor/test/engine/kickback-ledger.test.ts` — removed or repointed coverage

**Dependencies:** Task 3

---

### Task 11: Documentation upkeep
**Story:** 1
**Type:** documentation

**Steps:**
1. Correct `docs/reference/configuration.md` under `cumulative_kickback_bound`, which currently
   states "A passing `build_review` resets the counter" — replace it with the retained-across-PASS
   behavior and the rebase credit, naming the ADR.
2. Check `docs/explanation/gates.md` and `docs/runbooks/stalled-or-stuck-feature.md` for any
   statement about the cumulative bound's reset and correct anything stale.
3. Commit: "docs: the convergence bound is retained across a PASS and credited by an invalidating
   rebase".

**Files likely touched:**
- `docs/reference/configuration.md` — the `cumulative_kickback_bound` section

**Dependencies:** Task 10

---

## Out of scope

- Any change to `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW`, `MAX_RUBRIC_FAILURES_BUILD_REVIEW`, or
  `MAX_KICKBACKS_PER_GATE`. This change makes an approved cap reachable; it does not re-decide one.
- `prd_audit` and `manual_test`, left by `adr-2026-08-12` D6 for whichever issue produces their
  evidence.
- Implementing `adr-2026-08-17`'s `rubricFailures` or #1629's mechanical allowance. This feature
  states the reset rule those counters inherit; it does not build them.
- Editing another feature's spec artifacts. #1724's plan task-6 amendment is recorded as a
  precondition in the conflict artifact, not performed here.
