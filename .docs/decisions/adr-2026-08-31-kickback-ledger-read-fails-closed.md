# ADR: An unreadable kickback ledger fails closed, and audit history is separable from enforcement state

**Date:** 2026-08-31
**Status:** APPROVED
**Deciders:** James Stoup (operator)
**Supersedes:** nothing. This decides read-failure semantics that were previously
encoded only in a source comment and never carried by an approved decision.

## Context

`readKickbackLedger` documents its own failure behavior:

```text
Read the durable kickback state. Missing, malformed, and incompatible
ledgers deliberately fail open to an empty budget and never interrupt a run.
```

For a **budget** record that direction is backwards. An unreadable ledger does not make the cap
stricter — it removes the cap. The one state that most needs enforcement, a record the engine can no
longer interpret, is the state in which no enforcement happens at all.

Three properties of the current implementation compound it:

1. **Rejection is whole-ledger, not whole-entry.** `isKickbackLedger`
   (`src/conductor/src/engine/kickback-ledger.ts:219`) applies
   `Object.values(ledger.gates).every(isKickbackGateEntry)`, so one malformed gate entry invalidates
   every gate's counts, not just its own.
2. **The engine can corrupt its own ledger without any external damage.**
   `creditKickbackGateLaps` (`kickback-ledger.ts:164,185`) zeroes every numeric field outside
   `count`/`resolvedBefore`, so an authorized `effectiveLimit` of 8 becomes 0 on a qualifying rebase.
   A persisted `effectiveLimit: 0` then fails `isPositiveSafeInteger` in `isKickbackGateEntry`
   (`kickback-ledger.ts:273`), and the ledger becomes unreadable. An ordinary rebase can therefore
   uncap a feature.
3. **Audit detail and enforcement state share one validity verdict.** A malformed attribution field
   on a historical adjustment discards the current count and effective limit alongside it, though
   neither depends on the other.

The sealed story for `the-cumulative-kickback-cap-never-resets-so-a-reco` already separates these
two concerns in its first negative path:

> Given one stored adjustment lacks required attribution or before/after data, when inspection runs,
> then it does not silently omit or fabricate that entry; it marks adjustment history unavailable
> while preserving any independently trustworthy current budget values.

The plan chose whole-entry rejection instead, and the shipped source enforces that choice — the
as-built review recorded this as design finding AB-13. This ADR does not overturn the story; it
records the read-failure semantics the story implies and the fail-closed direction the budget
requires.

## Decision

1. **A kickback ledger read never yields a more permissive budget than the durable record.** When
   enforcement state cannot be validated, the read fails closed: the affected gate is treated as
   exhausted and routed to the existing `needs-human` halt class. Falling through to an empty budget
   is forbidden, for missing, malformed, and version-incompatible ledgers alike.

   A genuinely absent ledger — a feature that has never been kicked back — remains the empty-budget
   base case. Absence is not corruption, and this decision does not turn a first dispatch into a
   halt.

2. **Audit history and enforcement state are validated independently.** Malformed adjustment history
   marks history unavailable and preserves independently validated current budget values, exactly as
   the sealed story requires. Malformed enforcement values do not silently drop history that is
   itself well-formed.

3. **Entry validity is scoped to its own gate.** One malformed gate entry never invalidates a
   sibling gate's counts. Whole-ledger rejection is reserved for a ledger whose envelope — version or
   `gates` container — cannot be interpreted.

4. **No partial trust within a value.** A field that fails validation is never repaired, defaulted,
   or inferred from an adjacent field. This decision widens what survives a malformed neighbour; it
   does not weaken what any single value must prove about itself.

5. **Lap credit preserves the authorized limit.** No credit path may write an `effectiveLimit` that
   its own validator would reject. This closes the self-corruption route in Context 2 at the writer
   rather than compensating for it at the reader.

## Consequences

**Accepted.** A corrupt ledger now stops a feature instead of silently uncapping it, so a class of
failure that previously ran to completion becomes an operator interruption. That is the intended
trade: for a budget gate, a false halt is recoverable and a silent uncap is not.

**Accepted.** `readKickbackLedger`'s signature must express failure rather than always returning a
ledger, so its callers can distinguish absence from corruption. That is a mechanical change across
its call sites.

**Rejected — fail open, as today.** Keeps every run uninterrupted at the cost of removing the cap in
exactly the state where the record is least trustworthy. The feature this decision arises from exists
because a cap that stops capping is the failure mode with the highest cost.

**Rejected — whole-entry rejection with a fail-closed fallback.** Preserves the current validity
scope and fixes only the direction. It still discards a valid count because an unrelated audit field
is malformed, and still lets one gate's corruption halt every other gate.

## Compliance

- `readKickbackLedger` returns a typed result distinguishing absent, readable, and unreadable.
- No production path treats an unreadable ledger as an empty budget.
- A malformed historical adjustment leaves `count` and `effectiveLimit` readable when they
  independently validate.
- A malformed entry for one gate leaves sibling gates' entries readable.
- No lap-credit path writes an `effectiveLimit` value that `isKickbackGateEntry` would reject.
