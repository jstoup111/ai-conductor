---
name: event-spine
description: "Use BEFORE designing any new way to observe, report, or coordinate something in the ai-conductor repository — a watcher, a poller, a sidecar file, an ad-hoc log, a second telemetry path, or a timestamp stamped into an artifact to be read back later. Also use when adding a member to the `ConductorEvent` union, introducing a new `.pipeline/*.jsonl` ledger, deciding whether something 'should be an event', or reaching for a channel outside the bus because the bus looks inconvenient. Decides whether the existing spine (`ConductorEventEmitter` → `ConductorEvent` → `EventPersister` → `.pipeline/events.jsonl`) already carries the concern, applies the schema-not-file test, and names the only three exceptions that justify a separate write. Invoke it even when the new mechanism looks small, obviously correct, or too minor to count as telemetry — a parallel channel is cheap to prevent at design time and near-impossible to remove once consumers depend on it."
---

# Event Spine

**Extend the existing event spine; never add a parallel channel.**

This repository has exactly one telemetry spine. Every mechanism that observes, reports, or
coordinates work is expected to ride it. A design that invents a second channel for a concern the
spine already carries is a defect at design time, not a style preference — and it is the specific
mistake this skill exists to catch, because it is invisible in review and expensive to unwind.

Run this before the design is written down, not after. The cost of the check is one question; the
cost of missing it is a permanent second source of truth.

---

## 1. The spine

```
ConductorEventEmitter
  → the ConductorEvent union (src/conductor/src/types/events.ts)
    → EventPersister (src/conductor/src/engine/event-persister.ts)
      → .pipeline/events.jsonl
```

Consumers subscribe to the emitter or read the ledger: the daemon and its CLI, the UI renderer and
subscriber, the OTel visualizer, and the event sinks. Do not hard-code that list into a design
document — grep for it when you need it. The point is not who reads today, it is that **everything
that reads, reads here.** A channel outside this path is seen by none of them.

---

## 2. Decision procedure

Answer in order. The first YES that survives step 3 settles it.

**Step 1 — Is the thing you are adding a channel?**

You are adding a channel if the design introduces any of these:

- a watcher or poller that observes state to infer that something happened
- a sidecar file, a bespoke log, or a second ledger with its own format
- a timestamp, counter, or status stamped into an artifact so a later reader can reconstruct timing
- an IPC path, a status endpoint, or any out-of-band signal between components

If none of those, this skill does not apply. Stop.

**Step 2 — Does the bus already carry this concern?**

Ask it literally: *is this an occurrence in time that some component needs to know about?* If yes,
the bus carries it, whether or not a variant for it exists today. A missing variant is not evidence
that the bus is the wrong mechanism — it is the work.

- **YES** → extend the spine. Add a variant to the `ConductorEvent` union and emit it. Additive
  optional fields on an existing variant are backward-compatible; consumers read named fields.
- **NO** → the concern is probably durable state, not an occurrence. Check exception C in §4 before
  concluding.

**Step 3 — Apply the schema-not-file test (§3) to whatever you landed on.**

A design that emits `ConductorEvent`s is compliant even if it writes them somewhere new. A design
that writes a bespoke format is a violation even if it writes to a file that already exists.

---

## 3. The test: schema, not file

This is the sharpest distinction in the skill and the one most often gotten backwards.

| | Verdict |
|---|---|
| A sibling ledger written in the *same* `ConductorEvent` schema, merged by the same reader | **One spine. Fine.** |
| A bespoke sidecar with its own format, its own field names, its own reader | **A parallel channel. Violation.** |

The unit of duplication is the **schema and the reader path**, not the file. Splitting a write
across two files for a mechanical reason (see §4) keeps one union, one parser, one merge. Inventing
a second format forks the reader path forever, and every consumer must then be taught about both —
which in practice means none of them are, and the new signal is visible only to the code that wrote
it.

Corollary: "I'll just add a field to an artifact we already write" is **not** the cheap option. It
is a new channel wearing an existing file as a disguise, and it is invisible to every bus consumer.

---

## 4. The only three exceptions

These move the *write*. **None of them change the schema.** If a proposed exception also changes the
schema, it is not one of these — it is a parallel channel.

**A — A separate OS process with no bus access.**
The writer runs outside the conductor process and cannot reach the emitter.
Evidence: `adr-2026-07-10-intra-step-build-progress-events` rejected runner-push on exactly this
ground. Its resolution is the pattern to copy — a single-writer append-only ledger **in the same
event schema**, tailed by the engine, not a different mechanism.

**B — An atomicity limit forcing one writer per file.**
Two processes appending to one ledger can interleave. `appendFileSync` is atomic only for writes
under `PIPE_BUF` (4096 bytes on Linux), and records routinely exceed it; `parseLedger` in
`timing-rollup.ts` returns null on **any** malformed line, degrading the whole rollup rather than
one record. One writer per ledger file is therefore a correctness requirement, and a sibling file is
the correct remedy — still the same union, still merged by `ts`.

**C — Durable state, not an occurrence in time.**
Gate evidence artifacts and committed design docs are *state*: they answer "what is true now",
survive as the record, and are read by name. Events answer "what happened, when". Do not force state
onto the bus, and do not reconstruct occurrences from state.

**"Faster to bolt on" is not an exception.** Neither is "the bus doesn't have a variant for this
yet", "this is only for debugging", or "it's just one field".

---

## 5. When a new channel is genuinely right

Sometimes it is. The bar is an **ADR** that states why the existing spine could not carry the
concern, in `.docs/decisions/`, approved before the code is written. The ADR must name:

1. the concern, and why it is an occurrence rather than state
2. which of §4's exceptions applies, or why none do and a new mechanism is still required
3. what the new channel's consumers are, and why the existing consumers do not need the signal
4. the migration or reconciliation story, if both channels will carry overlapping information

Absent that ADR, a second channel is a finding — kick it back at `architecture-review`, not at
review time after the code exists.

---

## 6. Worked example — intake #1176

DECIDE for #1176 produced two designs, and the operator rejected both:

1. **An engine-side watcher polling artifact paths** to observe pipeline closeout obligations. It
   made the poll interval the timing floor and made a renamed artifact read as "nothing happened",
   and an inline run with no engine produced nothing at all.
2. **Closeout completion timestamps stamped into five existing artifacts**, read back post-hoc. This
   is the §3 corollary in its purest form — no new file, and still a second telemetry channel that
   the daemon log, the UI, and the OTel exporter could never see.

The accepted design (`adr-2026-08-08-pipeline-owned-closeout-timestamps`) emits real
`ConductorEvent`s. Because the pipeline writes from its own process, exceptions A and B both apply,
so the events go to a single-writer sibling ledger **in the same union**, merged by `ts` and
re-emitted onto the live bus. One schema, one reader path, no parallel channel — and note that the
sibling file, by §3, was never the violation.

---

## Output

State the verdict explicitly before authoring the design:

```
Event spine
  Channel?    yes | no                          — <what is being added>
  Concern:    occurrence | durable state        — <why>
  Verdict:    extend the union | sibling ledger, same schema | new channel (ADR required)
  Exception:  A | B | C | none                  — <the mechanical reason, if any>
```

## Verification

- [ ] The design was checked before it was written down, not after the code existed
- [ ] "Does the bus already carry this concern?" answered explicitly, not skipped because no variant
      exists yet
- [ ] Judged by schema and reader path, not by file count
- [ ] A separate write location is justified by exception A, B, or C — and does not change the schema
- [ ] No timestamp, counter, or status was stamped into an existing artifact to stand in for an event
- [ ] A genuinely new channel carries an approved ADR naming why the spine could not carry it
