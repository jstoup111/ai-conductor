# ADR: Kickback budget recovery uses the existing needs-human halt class and typed ledger evidence

**Date:** 2026-08-29
**Status:** APPROVED
**Deciders:** James Stoup (operator) and conflict-check architecture amendment for
jstoup111/ai-conductor#1760
**Supersedes:** `adr-2026-08-29-operator-authorized-kickback-budget-recovery`
**Carries forward:** that ADR's partial supersession of
`adr-2026-08-12-cumulative-build-review-convergence-bound` D3 for an explicitly raised feature.

## Context

The superseded recovery ADR correctly selected a staged ledger adjustment consumed by daemon resume,
but it also required `HALT.class = kickback-cap`. Repository-wide conflict-check proved that class
contradicts the approved halt taxonomy: every new engine-owned halt is exactly `needs-human` or
`mechanical`. A third class would also fall outside the existing operator-action and committed-record
classifiers, breaking the canonical resume behavior the recovery design intends to preserve.

The recovery design already carries a stronger exact-match authority than a class label: typed
cumulative-cap evidence and a stable halt generation in the kickback ledger, joined to an explicit
operator resume authorization. The halt class can therefore retain its scheduling meaning while the
ledger proves the narrower recovery identity.

## Options Considered

1. Keep `needs-human` and authenticate the recovery through typed ledger evidence and generation.
2. Add `kickback-cap` as a third repository-wide halt class and widen every exhaustive classifier,
   migration, committed-record rule, and test.
3. Keep `needs-human` and infer cap identity from halt prose.

Option 1 preserves both contracts. Option 2 broadens scope without adding authority. Option 3 makes
free text a control input and violates the approved no-prose-matching rule.

## Decision

Choose **Option 1**.

### D1 — Classification remains `needs-human`

A cumulative `build_review` cap terminal writes `HALT.class = needs-human`. `HaltClass`, the
operator-action predicate, legacy migration, generic re-kick classification, and committed-halt
recordability remain unchanged. A cap halt with no valid operator authorization survives every
ordinary sweep exactly like every other needs-human halt.

### D2 — Typed ledger evidence proves the narrower cap identity

Before writing the human halt, the conductor persists typed cumulative-cap evidence carrying gate,
consumed count, effective limit, latest semantic reason, and a stable halt generation. Reset or raise
requires the selected feature, live needs-human marker, typed evidence, current ledger values, and
generation to agree under the kickback-ledger lease. Halt prose is diagnostic only and is never
parsed to authorize mutation.

### D3 — Explicit authorization is consumed before generic needs-human retention

After park and processed-work checks, the daemon halted-feature boundary checks for a resume
authorization bound to the live typed cap evidence and generation. An exact match clears the halt
through the existing canonical lifecycle, resolves its committed record, consumes the authorization,
and resumes normal selection. Missing, malformed, stale, or mismatched authorization falls through
to the existing needs-human retention branch with no clear, sentinel, or dispatch.

This is operator-authorized daemon work, not an autonomous re-kick or auto-expiry. A pre-existing
operator park continues to win before authorization consumption; the operator must explicitly
unpark before the daemon can act.

### D4 — All other recovery decisions carry forward unchanged

The superseded ADR's D1-D8 remain binding except where they name `kickback-cap` as a halt class. In
particular: reset preserves an effective raised limit; raise preserves consumed count; all ledger
read-modify-write paths share the existing bounded lease; the adjustment is staged around an
idempotent same-schema external event; the CLI never directly clears the halt; adjustment history
and the pure budget view remain authoritative; and mechanical-fault state remains separate.

## Amendment

**Amended by:** DECIDE for `plan-growth-allowance-is-spent-on-work-existing-ta` (2026-09-01,
operator-authorized) — D1 is **scoped, not reversed**.

D1 governs the cumulative `build_review` convergence cap terminal only. It does not reach the
remediation-append cap terminals of `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`
decision 4 — the per-gate lap cap and the shared plan-growth allowance for `prd_audit` and
`architecture_review_as_built` — which continue to persist `HALT.class = kickback-cap`.

This corrects a framing error in Options Considered above, which described `kickback-cap` as a
proposed *third* class. It is not new: it is declared in
`src/conductor/src/engine/halt-classification.ts`, adr-2026-07-28-total-halt-classification-legacy-boundary
D1 already reused it rather than adding one, and adr-2026-08-25 decision 4 states the same ("A second
lap, an exceeded allowance, or a no-op escalation halts with the existing `kickback-cap` class... No
new halt class is introduced (adr-2026-07-28 D1 unchanged)") while explicitly deferring to D2 of this
ADR for the typed-ledger authority. The sealed stories of the shipped feature
`every-as-built-blocked-verdict-halts-needs-human-i` require `kickback-cap` at exactly those two
terminals.

Reading D1 as universal would therefore regress a sibling feature's sealed acceptance criterion
rather than fix drift. No code change follows from this amendment; D2-D8 are untouched.

## Consequences

- Recovery adds no halt class and does not widen any existing classifier or migration.
- Exact recovery still cannot be authorized from prose or from the class alone.
- The daemon needs one narrow authorization check before its generic needs-human retention branch.
- Canonical halt-clear events and committed halt-record resolution remain available without special
  cases.
- A needs-human cap halt is visually classified like other operator-action halts; its budget view and
  typed ledger evidence provide the more specific diagnosis.

## Claim and Assumption Ledger

- [verified] The current `HaltClass` union admits `needs-human`, `mechanical`, `protected-artifact`,
  and `plan-gap`, and its operator-action predicate retains needs-human.
- [verified] Accepted halt Story 1 restricts new engine-owned halts to needs-human or mechanical.
- [verified] The committed-halt record lifecycle already records and resolves needs-human halts.
- [operator-approved 2026-08-29] Typed ledger evidence and generation, not a new class, are the
  authority for exact cumulative-cap recovery.

No unconfirmed load-bearing assumption remains.
