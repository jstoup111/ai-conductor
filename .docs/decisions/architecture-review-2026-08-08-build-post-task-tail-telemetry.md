# Architecture Review: BUILD post-task tail telemetry

**Date:** 2026-08-08
**Tier:** Medium (lightweight mode — Sections 2 and 4 in full; 3 and 5 skipped per the skill)
**Track:** technical (no PRD — review input is the `/explore` output and technical intent)
**Source:** intake jstoup111/ai-conductor#1176
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Compatible. No new dependencies. The rollup is a pure function over files, modeled on the existing `computeTimingRollup` (`timing-rollup.ts`). Confidence 95%, *verified* — that module is a self-contained reader over `.pipeline/events.jsonl` with no injected I/O beyond `readFile`. |
| **Prerequisites** | None blocking. #1101 (step-level timing) is CLOSED as of 2026-07-30; its `activeInterval` (`startedAtMs` + `durationMs`) is present on `step_completed` and supplies window end times. |
| **Integration surface** | Three boundaries: `BuildProgressWatcher` (additive event fields), the pipeline skill's closeout artifact writes, and a new `conduct-ts` reporting subcommand. Below the 3+ *module* threshold in spirit — none of the three changes the other's behavior. |
| **Data implications** | No database, no migration, and — after the bus revision — **no artifact schema changes at all**. Closeout timing is carried as `ConductorEvent`s in a pipeline-owned sibling ledger. `FULL_SUITE_EVIDENCE_VERSION` is untouched, preserving the fingerprint-reuse evidence consumed by `test_suite`'s `build_member_evidence_reused` path. |
| **Performance risk** | Negligible at write time (one timestamp per obligation). The rollup is offline and reads one ledger plus ≤5 small artifacts per window. No new polling: piece 1 adds fields to ticks the watcher already emits, and the rejected Option A (artifact polling) would have been the only change to poll cost. |
| **Worktree isolation** | Clean. All inputs are per-worktree (`.pipeline/`), all outputs are per-worktree or a committed doc. No ports, no shared services, no cross-worktree state. |

## Alignment

**Prior decisions.** `adr-2026-07-10-intra-step-build-progress-events` is APPROVED and
authoritative for the live intra-step signal. Checked for conflict in both directions:

- Piece 1 (tick provenance) is an **additive extension of that ADR's chosen Option A** watcher.
  Consistent.
- Piece 2 does **not** reintroduce that ADR's rejected Option B (runner-push). Nothing is
  pushed; durable artifacts are read offline with no IPC and no bus access from the pipeline.
  The new ADR states this relationship explicitly and does not supersede.

Its recorded constraint that `EventPersister.ALL_EVENT_TYPES` is a hand-maintained drift hazard
is now **stale** — that symbol no longer exists in the source. Piece 2's redesign removed the
new event type anyway, so no registration is required either way.

**Pattern consistency.** The rollup follows `timing-rollup.ts`'s established shape: a pure
reader returning a discriminated `{ state: 'measured' | 'partial' | 'unavailable' }` union. The
`Completed-At:` line convention for Markdown artifacts matches this repository's existing
grep-a-literal-line patterns (`Tier:` in complexity markers, `Status:` in ADRs).

**Single telemetry spine.** The first draft of this review approved artifact-carried
timestamps, which would have created a second telemetry channel invisible to the daemon log,
UI, and OTel exporter. Operator direction corrected it: closeout timing is now first-class
`ConductorEvent`s in the existing union. One schema, one reader path, and the events reach the
same six subscribers as every other event.

**Design principle — deterministic over prompt discipline.** Satisfied, and this was the
sharpest question in the review. The closeout events are emitted by an LLM-driven session
calling a CLI, which looks like prompt discipline. It is not, because the obligation that
emits them is *already* under a blocking gate (`skills/pipeline/SKILL.md:288-299` stat-checks
`review.json` for non-emptiness and halts the pipeline if it is missing). The ADR extends that
existing gate to require the recorded event, so a forgotten emission fails at the moment of the
mistake rather than degrading telemetry silently. Precedent for a pipeline-side process writing
engine-consumed state: `task-cli` already flips `.pipeline/task-status.json` from inside the
build worktree (adr-2026-07-05-engine-owned-task-status).

**State management.** No booleans standing in for states. Both the rollup result and the
per-obligation stamp status are explicit unions (`measured`/`partial`/`unavailable`;
`stamped`/`unstamped`), which is what keeps "no closeout observed" distinguishable from
"closeout took zero time" — precisely the absent-vs-zero ambiguity that makes today's
`commitCount` unusable.

**Security boundaries.** No new endpoints, no external input, no secrets. Timestamps are
non-sensitive. No change to authentication or authorization surfaces.

**Production DI defaults.** Not applicable — no injected stores. The rollup reads the
filesystem directly, as `computeTimingRollup` does.

**Diagram accuracy.** `.docs/architecture/build-post-task-tail-telemetry.md` was revised during
this review to remove the engine-side observer after the operator's decoupling direction, and
re-validated (`render-diagrams --check`, 2 diagrams, exit 0).

## Wiring Surface

| New/changed production surface | Where it is called from in production |
|---|---|
| `tickReason` + `headMoved` fields on `build_progress` | Emitted from `BuildProgressWatcher.tick()`, already wired into the conductor's `build` dispatch. Consumed unchanged by the existing subscribers: `daemon.ts`, `daemon-cli.ts`, `ui/create-renderer.ts`, `ui/subscriber.ts`, `otel/otel-visualizer.ts`, `event-sinks.ts`. Additive optional fields — no consumer change required. |
| New closeout `ConductorEvent` kind | Added to the union in `types/events.ts`. Emitted by the new `conduct-ts` primitive below; consumed by the merged-ledger readers and, once re-emitted, by the same six existing bus subscribers. |
| `conduct-ts` closeout-event primitive | Called from the pipeline skill's existing closeout obligation steps (`skills/pipeline/SKILL.md`), following the established pattern of pipeline-side CLI primitives (`task-cli`, `scoped-run`, `test-suite-cli`). Writes `.pipeline/pipeline-events.jsonl`. |
| Engine tail-and-re-emit of `.pipeline/pipeline-events.jsonl` | Started/stopped alongside the existing `BuildProgressWatcher` lifecycle in the conductor's `build` dispatch; re-emits onto the live bus so `daemon-cli.ts`, the UI renderers, and `otel-visualizer.ts` see closeout events without their own file access. Polling follows the existing 1s tail pattern in `daemon-log.ts:146`. |
| Extended batch-boundary gate (closeout event recorded) | The same hard gate that today stat-checks `review.json` before the next batch starts. |
| `computeBuildTailRollup` | Invoked by a new `conduct-ts` reporting subcommand registered in the CLI command table, following the pattern of the existing report CLIs (`evidence-cli.ts`, `test-suite-cli.ts`). |
| Committed baseline artifact | No runtime wiring — a committed document produced by running the subcommand above. |

**Early overlap scan (advisory).** `conduct-ts overlap-scan` over the wiring-surface paths
returns `build-progress-watcher.ts` as overlapping with ~35 open spec branches. That breadth
makes the result low-signal rather than a specific collision warning; treated as advisory only,
it does not affect the verdict. Recommend `/plan` keep the watcher edit narrow and additive so
a rebase against any of those branches stays mechanical.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Baseline is computed from a corpus with no closeout events, making the first reference point weaker than steady-state data | Data | High | Medium | Reader reports `unrecorded` per obligation rather than zero (ADR D3); the baseline document states its own coverage explicitly instead of implying completeness |
| New blocking condition: a missing closeout event fails a gate that previously passed | Technical | Medium | Medium | Intended and stated in the ADR's negative consequences. `/plan` sequences the emitter ahead of the gate so no in-flight build blocks on an event nothing writes yet |
| A pipeline-authored malformed line degrades the merged rollup to `partial` | Technical | Low | Medium | Blast radius confined to the sibling ledger by ADR D2's one-writer-per-file rule; the shared `events.jsonl` stays single-writer, so engine telemetry is never poisoned by a pipeline write |
| Tail-and-re-emit adds timer lifecycle to the build dispatch (leak risk) | Technical | Medium | Low | Mirror the existing `BuildProgressWatcher` lifecycle exactly — `.unref()`'d interval stopped in a `finally` — which adr-2026-07-10 already established as the pattern for this exact hazard |
| Watcher edit collides with one of ~35 open spec branches touching the same file | Integration | Medium | Low | Keep the change additive and narrow; the overlap scan above is on record for `/plan` |
| Rollup silently mis-attributes a window because poll granularity straddles the task/closeout boundary | Technical | Medium | Medium | Closeout segment times come from artifact-carried stamps (the obligation's own clock), not from poll ticks; only the window boundaries depend on the ledger |
| The measurement that justifies this scope is a one-off script, not reproducible by a reviewer | Knowledge | Medium | Medium | Piece 3 productionizes exactly that computation; the exploratory numbers are recorded in `.memory/decisions/2026-08-08-build-post-task-tail-measured-not-ceremony.md` with their gotchas |

## ADRs Created

- `adr-2026-08-08-pipeline-owned-closeout-timestamps.md` — **APPROVED**. Settles: closeout
  telemetry is first-class `ConductorEvent`s on the bus (operator direction), emitted by a
  `conduct-ts` primitive from the pipeline's own process so an inline run is fully instrumented;
  one writer per ledger file with merge-on-read, because `parseLedger` fails closed on a single
  malformed line and cross-process append to the shared ledger is therefore a whole-ledger
  corruption risk; gate-enforced emission with tolerant reading; `measured | partial |
  unavailable` degradation for inline runs; mtime and artifact-carried timestamps both recorded
  as rejected, with reasons, so neither is re-proposed.

  The ADR keeps its original filename stem for citation stability; its title and decision now
  reflect the bus-based design that replaced artifact stamping during this review.

No existing ADR superseded.

## Conditions

1. **Emitter before gate.** `/plan` must sequence the closeout-event *emission* ahead of the
   gate *validation*, so no in-flight build blocks on an event nothing yet produces.
2. **One writer per ledger file.** No task may have the pipeline append to
   `.pipeline/events.jsonl`. `parseLedger` fails closed on a single malformed line, so a
   cross-process interleaved append degrades *every* rollup over that ledger to `partial` —
   a corruption that is invisible until read. This is ADR D2 and is not negotiable at plan time.
3. **Reader tolerates unrecorded obligations.** The baseline corpus predates the event; a
   reader that treats absence as zero reproduces the exact under-counting bug this feature
   exists to fix (three windows mis-scored as ceremony that had in fact committed).
4. **Watcher edit stays additive.** No restructuring of `tick()` beyond adding the two fields,
   given the overlap breadth on that file.
5. **Intake #1176's ≥50% p95 outcome is not in scope** and must not appear as an acceptance
   criterion in stories — the metric conflates remediation with ceremony and is re-targeted as
   an ADR follow-up.
