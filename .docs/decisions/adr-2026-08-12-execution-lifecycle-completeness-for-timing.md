# ADR: Every started execution closes on the ledger, or the rollup names why it could not

**Date:** 2026-08-12
**Status:** APPROVED (operator-approved 2026-08-12)
**Deciders:** James Stoup (operator), engineer session for ai-conductor#1260

## Context

`adr-2026-07-29-engine-observed-provider-time-partition` (APPROVED, #1101) established the timing
partition and, in its contract 4, required that *step lifecycle terminal evidence carries an
engine-observed active interval*. It did not require that terminal evidence **exist**. That gap is
now the sole reason the measurement is empty in production.

Measured on 2026-08-12 by running the shipped `computeTimingRollup` against all six live worktree
ledgers:

| ledger | rollup | open executions |
|---|---|---|
| loop-halt-never-reaches-events-jsonl-so-a-halt-is- | partial | `parallel:wiring_check` ×1 |
| re-kick-sentinel-can-strand-an-active-feature-outs | partial | `step:build` ×3, `parallel:wiring_check` ×1 |
| off-tag-checkout-reports-up-to-date-forever-tagged | partial | `step:build` ×2 |
| interrupted-self-host-runs-leak-provider-homes-unt | partial | `parallel:wiring_check` ×5, `step:build_review` ×1 |
| repeated-build-review-semantic-failures-can-churn- | **measured** (`activeMs` 484268, `providerActiveMs` 467554, `noProviderActiveMs` 16714) | none |
| require-explore-to-ask-the-operator-how-comprehens | partial | `step:architecture_review_as_built` ×1 |

Every terminal event present carried an `activeInterval` (17/17, 4/4, 1/1 across the sampled
ledgers) and no `provider_attempt` was invoked-but-empty, so neither `activeEvidenceIncomplete` nor
`providerEvidenceIncomplete` is firing. The single blocking route is `openExecutions.size > 0`
(`timing-rollup.ts:144`, `:159`). Confidence 90%, basis: verified by execution.

Two mechanical facts constrain any fix:

- `activeInterval` is stamped by `EventPersister` at persist time from its own `openSteps` /
  `openGroups` maps (`event-persister.ts:95-100`), not by the emitter. **The terminal event is the
  sole carrier of an execution's active duration.** An execution that never emits a terminal loses
  its duration outright, not merely its close marker. Confidence 100%, basis: verified in source.
- Those maps are per-process; `.pipeline/events.jsonl` is per-worktree and append-only across every
  dispatch. A start written by one dispatch can never be paired by a later process — only the
  whole-ledger reader sees both. Counts above one (`step:build` ×3, `parallel:wiring_check` ×5)
  are therefore stale starts from earlier interrupted dispatches, not a step currently running.
  Confidence 95%, basis: verified by measurement.

The committed record compounds this: `shipped-record.ts:226-230` writes a reason-free
`state: partial`, so which of `calculateTimingRollup`'s five routes fired is unrecoverable from the
artifact, and timing evidence lives in gitignored `.pipeline/` state that dies with the worktree.

## Options Considered

### Option A: Reader-side reconciliation in `timing-rollup.ts`

Treat a re-start of an execution key as implicitly closing the prior one, so stale starts stop
blocking the rollup.

- **Pros:** Smallest possible change, confined to one function; fixes every historical ledger
  immediately; no emission paths touched.
- **Cons:** The lost terminal *was* the `activeInterval` carrier. Closing an interrupted execution
  reader-side discards its real active time while promoting the record to `measured` — a total that
  silently undercounts by an unbounded amount and declares itself exact. Directly contradicts
  `adr-2026-07-27-cost-unmetered-is-a-first-class-state`, which requires unknown measurements to
  remain absent rather than fabricated. It also patches one consumer while leaving the same ledger
  gap visible to every other reader of the spine.

### Option B: Emission completeness on interrupt paths, plus a named degrade reason

Guarantee that every catchable interrupt emits its execution's terminal event, carrying the
`activeInterval` the persister still holds; leave genuinely unrecoverable cases `partial` and record
which route produced them.

- **Pros:** Satisfies both "a normal ship reaches `measured`" and "an incomplete run degrades rather
  than fabricating". The ledger becomes self-describing for every spine consumer, not just the
  timing rollup. Extends the existing union additively; no new channel.
- **Cons:** Touches several interrupt paths rather than one function; historical ledgers stay
  `partial` (correctly — their time is genuinely lost); overlaps in-flight #1477, which edits the
  same halt emission neighborhood.

### Option C: Record the degrade reason only

Ship the reason field, make no attempt to reach `measured`.

- **Pros:** Cheap, independently valuable, zero risk to the emission paths.
- **Cons:** Leaves the KPI blank forever, which is the filed defect.

## Decision

Choose **Option B**, extending `adr-2026-07-29-engine-observed-provider-time-partition` rather than
superseding it. Its contracts 1-8 remain in force; this ADR adds the completeness invariant that
contract 4 assumed but never stated:

1. **Every execution start emits exactly one terminal.** For every `step_started` /
   `parallel_started` written to the ledger, the process that wrote it emits a corresponding
   terminal event on every path it can still run code on — normal completion, failure, halt,
   live-boundary abort, and graceful shutdown. The terminal carries the `activeInterval` the
   persister holds for that key, by the existing `event-persister.ts` mechanism and clock; no new
   interval source is introduced.

2. **The rollup never closes an execution the ledger left open.** Reader-side reconciliation is
   rejected. When `openExecutions` is non-empty the rollup stays `partial`, because the missing
   terminal is also the missing duration and any total computed without it understates active time
   while claiming to be exact.

3. **A `partial` names the route that produced it.** `calculateTimingRollup` returns, alongside the
   state, which of its five conditions fired — empty active union, `activeEvidenceIncomplete`,
   open executions, provider-outside-active mismatch, or `providerEvidenceIncomplete` — and, for
   open executions, the execution keys still open. The shipped record's `## Time` block carries it
   as an additive field, following the tolerant-additive pattern of
   `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates`.

4. **Backward compatibility is preserved in both directions.** Records already committed — with a
   reason-free `state: partial`, or with no `## Time` block at all — continue to parse to exactly
   the state they parse to today. The reason is read by name and its absence is not an error.

5. **Unrecoverable death stays honest.** A process killed without the chance to run code (SIGKILL,
   host loss) cannot emit its terminal, and its active time is not recoverable. That run's record
   remains `partial`, now naming the open executions, and no attempt is made to synthesize an
   interval for it.

## Consequences

### Positive

- A feature that ships through an uninterrupted daemon run reaches `measured` with all three
  values — verified reachable today on the one live ledger with no open executions.
- Interrupted-but-recoverable runs stop losing their active time, so re-dispatched builds
  contribute their real durations instead of poisoning the whole feature's rollup.
- A genuine `partial` is diagnosable from the committed artifact alone, without re-running the
  build — which matters because `.pipeline/` evidence dies with the worktree and is not
  backfillable.
- Every other consumer of `.pipeline/events.jsonl` gains a ledger where execution lifecycles
  balance, including the halt-class consumers #1477 is reviving.

### Negative

- Interrupt paths gain an emit obligation that a future path can forget. The mitigation is the
  single-emit-path shape #1477 adopts for `loop_halt` (one private conductor-owned emitter, no
  call site free to omit the field) rather than a prose rule.
- Historical ledgers and every already-committed shipped record stay `partial`. The KPI's measured
  sample count starts from zero and grows only with new ships.
- `#1477` touches the same halt emission neighborhood; whichever lands second rebases onto the
  other. Flagged for `/conflict-check`.

### Follow-up Actions

- [ ] Enumerate the catchable interrupt paths that currently exit without emitting a terminal, and
      emit one from each.
- [ ] Return the degrade route from `calculateTimingRollup` and render it into the `## Time` block.
- [ ] Prove the round trip: `shipped-record` writes the reason, `kpi-report` reads it, and both
      historical shapes still parse unchanged.
- [ ] Pin that a zero-measured aggregate reports its counts and computes no average.
- [ ] Update `docs/reference/cli.md` and `docs/reference/artifacts.md`, which both document the
      `## Time` block's fields.
