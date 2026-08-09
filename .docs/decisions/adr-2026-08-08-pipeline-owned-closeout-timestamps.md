# ADR: Pipeline emits closeout events onto the bus from its own process

**Date:** 2026-08-08
**Status:** APPROVED
**Deciders:** Operator (decoupling direction and single-telemetry-spine direction given during DECIDE for intake #1176; ratified at spec-PR merge)

## Context

The `build` step is one opaque provider session. Measured across all 43 worktree ledgers on
2026-08-08: 28 `build` windows, 24 with a usable task-completion tick, **202 post-task
tail-minutes**. Reading the sessions' own summaries, **~197 of those 202 minutes are real
rework** — gate kickbacks returning to `build` for repairs (`bin-teardown` re-entered `build`
8 times, `live-daemon-e2e` 9 times). Genuine idle ceremony is ~2 windows, ~5 minutes. In every
re-entry `provider ≈ active ≈ wall` (6.8/6.6, 14.9/14.8, 5.1/5.0 min), so the step is ~97% LLM
time and there is no unconditional idle to remove.

None of that was knowable from the ledger. It required reading prose summaries by hand. The
engine cannot today distinguish task execution from kickback remediation from closeout
ceremony inside a `build` window, which means every proposed latency fix is unfalsifiable.

Constraints (verified against source, 2026-08-08):

- `adr-2026-07-10-intra-step-build-progress-events` is **APPROVED** and owns the live
  intra-step signal. It chose the engine-side `BuildProgressWatcher` and **rejected**
  runner-push on the grounds that `task-cli` runs in a separate process with no bus access,
  so pushing would need "an IPC channel or an append file the conductor must still poll/read".
- `build_progress` populates `commitCount` **only** on a change-driven tick where HEAD moved;
  heartbeat ticks hard-code `commitCount: undefined`
  (`src/conductor/src/engine/build-progress-watcher.ts:376`). An absent `commitCount` cannot be
  distinguished from "HEAD did not move", so a classifier built on it **under-counts real
  work** — three windows initially scored as ceremony had in fact committed (`3b91faa29`,
  `8ba2d35be`, `6a97b6e16`).
- `computeTimingRollup` (`timing-rollup.ts`, from #1101) is **step-level only** and returns
  `{ state: 'measured' | 'partial' | 'unavailable' }`. The post-task tail is *intra*-step.
- **`EventPersister` is the only writer of `.pipeline/events.jsonl`**, via `appendFileSync`
  (`event-persister.ts:125`), one JSON line per event, `ts` stamped at write.
- **`parseLedger` returns `null` on any single malformed line** (`timing-rollup.ts:26-39`),
  which degrades the *entire* rollup to `{ state: 'partial' }`. One interleaved write poisons
  every rollup computed over that ledger.
- `EventPersister.ALL_EVENT_TYPES` — named as a hand-maintained drift hazard in
  adr-2026-07-10 — **no longer exists** in the source.
- `build_progress` consumers: `daemon.ts`, `daemon-cli.ts`, `ui/create-renderer.ts`,
  `ui/subscriber.ts`, `otel/otel-visualizer.ts`, `event-sinks.ts`. All read named fields, so
  additive optional fields are backward-compatible.
- Precedent for a pipeline-side process writing engine-owned state: `task-cli` flips
  `.pipeline/task-status.json` from inside the build worktree
  (adr-2026-07-05-engine-owned-task-status), and the engine reads it as ground truth.

**Binding operator directions:**
1. The pipeline must be **decoupled** from the engine so it can run **inline** — invoked
   directly in a session with no conductor driving it — and still produce a complete closeout
   timeline. The engine is a *consumer* of pipeline telemetry, never its source.
2. Telemetry belongs **on the bus**. Closeout timing must be first-class `ConductorEvent`s in
   the existing event schema, not a second, parallel telemetry channel.

These two directions are in tension with adr-2026-07-10's rejection of runner-push, and
resolving that tension is the substance of this ADR.

## Options Considered

### Option A: Engine-side closeout-artifact observer
Extend `BuildProgressWatcher` to poll the closeout artifact paths and emit an event per
obligation as each file appears.
- **Cons:** violates direction 1 — an inline run with no engine produces no closeout timeline.
  Widens engine-to-skill path coupling whose failure mode is *silence*: a renamed artifact
  reads as "no closeout happened". Poll granularity becomes the timing floor.

### Option B: Artifact-carried timestamps, read post-hoc
Each obligation stamps its completion time into the artifact it already writes; the rollup
reads those artifacts offline.
- **Pros:** satisfies direction 1; no new event type.
- **Cons:** violates direction 2 — closeout timing never reaches the bus, so the daemon log,
  UI, and OTel exporter cannot see it, and the repository ends up with two telemetry channels.
  Also forces a permanent reader adapter over three different timestamp conventions
  (`summary.json` snake_case, `test-suite-evidence.json` camelCase, two Markdown artifacts with
  none), and tempts a `FULL_SUITE_EVIDENCE_VERSION` bump that would invalidate the
  fingerprint-reuse evidence `test_suite` depends on.

### Option C: Pipeline appends `ConductorEvent`s to the shared `events.jsonl`
A `conduct-ts` primitive appends closeout events to the same ledger the engine writes.
- **Pros:** one spine, works inline.
- **Cons:** two processes appending to one file. `appendFileSync` is atomic only for writes
  under `PIPE_BUF` (4096 bytes on Linux), and existing `step_completed` records routinely
  exceed that — they carry `tail` arrays and token usage. An interleaved line is not a
  degraded line: `parseLedger` nulls out and **every** rollup over that ledger becomes
  `partial`. Unacceptable failure mode for a corruption that is invisible until read.

### Option D: Pipeline emits `ConductorEvent`s to its own ledger file; readers merge — CHOSEN
A `conduct-ts` primitive appends closeout events, **in the existing `ConductorEvent` schema**,
to a pipeline-owned sibling ledger (`.pipeline/pipeline-events.jsonl`). Readers merge the two
ledgers by `ts`. The engine additionally tails the sibling and re-emits onto the live bus, so
existing subscribers see closeout events in real time.
- **Pros:** satisfies direction 2 — one event *schema*, one union, one reader path, and the
  events do reach the bus and its subscribers. Satisfies direction 1 — the CLI writes the file
  with no engine present, so an inline run is fully instrumented. **Single writer per file**
  eliminates the interleaving corruption in Option C. The rollup needs no artifact adapter, so
  no `FULL_SUITE_EVIDENCE_VERSION` bump and no three-convention reader. Reconciles with
  adr-2026-07-10 on that ADR's own terms: it rejected runner-push because it would need "an
  IPC channel or an append file the conductor must still poll/read" — here the append file *is*
  the deliverable, the polling is a tail the engine already knows how to do (`daemon-log.ts`
  polls at 1s), and no IPC is introduced.
- **Cons:** two files where there was one; readers must merge and tolerate clock skew between
  writers (mitigated — both write `ts` from the same host clock). The engine's tail-and-re-emit
  path is new lifecycle code. A malformed line in the sibling still degrades the merged rollup,
  but blast radius is confined to pipeline-authored events.

### Option E: Filesystem mtime as the time source — REJECTED
- **Cons:** mtimes do not survive worktree recreation (`.pipeline/` loss is a known failure,
  issue #497) and change on copy. Recorded so it is not re-proposed.

## Decision

**Adopt Option D.** Four sub-decisions:

**D1 — Closeout telemetry is `ConductorEvent`s, not artifact fields.** A new event kind carries
the obligation name and its start/end, added to the existing union in
`src/conductor/src/types/events.ts`. No closeout artifact schema changes; in particular
`FULL_SUITE_EVIDENCE_VERSION` is **not** bumped, preserving `test_suite`'s fingerprint-reuse
path (`build_member_evidence_reused`).

**D2 — One writer per ledger file.** The engine keeps `.pipeline/events.jsonl`; the pipeline
owns `.pipeline/pipeline-events.jsonl`, written by a `conduct-ts` primitive. Readers merge by
`ts`. This is chosen specifically because `parseLedger` fails closed on a single malformed
line, making cross-process append to one file a whole-ledger corruption risk rather than a
localized one.

**D3 — Emission is gate-enforced, reading is tolerant.** The existing blocking batch-boundary
gate (`skills/pipeline/SKILL.md:288-299`, which today stat-checks `review.json` for
non-emptiness) extends to require that the obligation's event was recorded — enforcement at the
moment of the mistake, per this repository's "deterministic where possible; never rely on
prompt discipline" principle. The **reader** must tolerate absence and report the obligation as
`unrecorded`, because the baseline corpus (piece 4) predates the event entirely. Fail-closed
forward, tolerant backward.

**D4 — Degradation mirrors `TimingRollup`.** `computeBuildTailRollup` returns
`{ state: 'measured' | 'partial' | 'unavailable' }`, matching `timing-rollup.ts`. On an inline
run there is no engine ledger and therefore no `build` window boundaries, so the
task-execution and remediation segments are uncomputable: the result is `partial` carrying the
closeout timeline only. An inline run is a supported mode, **not** an error.

**Relationship to adr-2026-07-10.** This ADR does **not** supersede it. That ADR owns the live
task-progress signal and its engine-side watcher; piece 1 of this feature (tick provenance) is
an additive extension of that watcher and stays consistent with it. Its rejection of
runner-push was scoped to replacing the progress watcher with an IPC protocol; Option D
introduces no IPC and no protocol, only a second append-only ledger in the same event schema.

## Consequences

### Positive
- One telemetry schema and one reader path. Closeout obligations become visible to the daemon
  log, UI, and OTel exporter like any other event, rather than living in a parallel channel.
- An inline `pipeline` run is fully instrumented with no conductor present.
- No artifact schema changes at all, so no `FULL_SUITE_EVIDENCE_VERSION` bump and no reader
  adapter over three timestamp conventions.
- Per-obligation timing comes from the obligation's own clock, not the poll interval.
- `tickReason` + `headMoved` make the ceremony-vs-remediation split machine-derivable — which
  the three mis-scored windows above prove is impossible today.
- The deferred reduction candidates become decidable from data rather than argued from
  intuition.

### Negative
- Two ledger files where there was one; every reader must merge them.
- New engine lifecycle code to tail and re-emit the sibling ledger onto the live bus.
- The baseline corpus has no closeout events, so the first baseline reports `unrecorded`
  obligations and is weaker than steady-state data will be.
- A new blocking condition in the batch gate: a missing closeout event now fails where it
  previously passed. Intended, but it is a new way for a build to block.
- This feature delivers **no latency reduction**. That is the accepted cost of not optimizing
  against an unfalsifiable metric.

### Follow-up Actions
- [ ] Re-target intake #1176's "p95 tail reduced ≥50%" outcome once the rollup exists — as
      written it conflates remediation with ceremony and could be satisfied by shipping less.
- [ ] File the deferred reduction candidates as v1 follow-ups blocked on this telemetry.
- [ ] File the rework-churn finding (`build` re-entered 8-9× per feature, ~197 of 202
      measured tail-minutes) separately — it is the larger problem and out of #1176's scope.
