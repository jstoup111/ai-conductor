# Architecture Review: Daemon-dispatched builds emit no OTel telemetry — visualizer wired via shared seam
**Date:** 2026-08-26
**Stories reviewed:** none yet (pre-stories DECIDE pass; input = explore output + technical intent, #1934)
**Mode:** Lightweight (tier M — §2 Feasibility + §4 Alignment; repo-wide ADR sweep delegated and completed)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- Seam exists and is sufficient (verified, 95%): `beginFeatureRun` (`src/conductor/src/daemon-cli.ts:926-942`)
  is the sole build-dispatch scope — it creates the per-feature bus (`startFeatureEventPersistence`)
  and a paired `stop()` the daemon invokes on every dispatch end (clean, HALT, error). The other
  `startFeatureEventPersistence` site (`daemon-cli.ts:1489`) is the scratch-sweep scope, not a build
  dispatch — no visualizer there.
- `OtelVisualizer` lifecycle already fits (verified): `stop()` is idempotent, force-flushes both
  providers, and unregisters its SIGINT/SIGTERM handlers (`engine/otel/otel-visualizer.ts`).
- No new packages, services, migrations, or schema changes. Stack-compatible.
- Worktree isolation: one visualizer per dispatch, pipelineDir = the feature worktree's
  `.pipeline/` — per-worktree `otel.jsonl`, per-feature run id; concurrent features and multiple
  daemons across projects do not conflict (each process exports independently; `conductor.project`
  is a resource attribute).

## Alignment (repo-wide ADR sweep — full pass over 296 decision files)

Governing, conformant:
- `adr-014-otel-observability-exporter` — this change implements its seam in the daemon path;
  additive amendment note recorded in adr-014 (shared wiring helper, both entry points).
- `adr-2026-07-07-audit-trail-event-sink` — exact precedent: same listener wired at BOTH entry
  points; also records the historical "daemon wires no persister" gap class this closes.
- Event-spine principle + `adr-2026-08-08-pipeline-owned-closeout-timestamps`,
  `adr-2026-08-09-*`, `adr-2026-08-24-*` — this attaches a consumer to the existing bus; no
  parallel channel.
- `adr-2026-07-26-concurrent-task-telemetry-…` §1 independently supports per-dispatch (not
  daemon-global) attach.
- `adr-2026-07-29-engine-observed-provider-time-partition` item 8 explicitly left OTel wiring
  open — no collision.
- `adr-2026-07-07-single-generation-stale-respawn` (`process.exit(0)`, never event-loop drain)
  makes per-dispatch flush via `stop()` the required shape — flush-on-exit alone would lose tails.

Conflict found and resolved in-design (condition C1):
- `adr-2026-07-27-cold-start-within-step-retries` Decision 7: `.pipeline/conduct-session-id` is
  written ONLY by the step runner's `this.sessionId`. Today `resolveRunId`
  (`engine/otel/resource.ts:46-61`) mints+writes the file when absent. A visualizer constructed at
  `beginFeatureRun` runs before the first step, so it would become the first writer — the ADR's
  named out-of-contract shape. **Resolution: the daemon path resolves the run id read-only** —
  read `conduct-session-id` if present (resume case), else inject the dispatch's step-runner
  session id (the same uuid the runner will persist) as `ctx.runId`, per the injection precedent
  in `adr-2026-08-09-worktree-local-provider-scratch`. No ADR supersede needed; adr-014 amendment
  note records the constraint.

## Domain Integrity

Not re-derived (lightweight mode); no new domain types or state machines. Run identity reuses the
existing durable id — no new identity scheme (`adr-2026-08-25-…-run-identity` D1 conformant).

## Wiring Surface

| New production surface | Called from (design-time commitment) |
|---|---|
| Shared wiring helper (`wireOtelVisualizer`-shaped, exported from the engine) | `index.ts` `main()` tail (replacing the inline block at `index.ts:1279-1296`) AND `daemon-cli.ts` `beginFeatureRun` |
| Per-dispatch visualizer instance | Attached to the feature-scoped bus in `beginFeatureRun`; stopped/flushed by `beginFeatureRun`'s returned `stop()` |
| Daemon-path `renderer_error` warnings | Existing bus consumers (daemon log renderer) — no new channel |

No new config keys, events, CLI subcommands, or hooks.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Visualizer becomes first writer of conduct-session-id (adr-2026-07-27 D7 violation) | Integration | High (without C1) | High | C1: read-only resolve + caller-injected run id in daemon path |
| Shared helper hand-rolls its event list, breaking EVENT_SINKS exhaustiveness guard test | Technical | Medium | Medium | C2: derive subscriptions from `EVENT_SINKS` (`adr-2026-07-26-event-sink-registry-exhaustiveness`; committed acceptance test inspects `beginFeatureRun`) |
| Silent `mkdirSync`/swallowed write in `resource.ts` becomes a daemon-path `.pipeline` write site | Data | Medium | Medium | C1 removes the daemon-path write entirely; any remaining recreate must warn loudly (`adr-2026-07-11-pipeline-state-durability` D1/D3) |
| N concurrent dispatches accumulate process signal handlers | Technical | Medium | Low | Existing `stop()` unregisters per instance; bounded by max concurrent features — accepted, out of scope (per confirmed scope boundary) |
| Absent stream counts coerced to zero metrics | Data | Low | Low | Carry-never-coerce (`adr-2026-08-19-live-provider-stream-observation` contract 3) |

## ADRs Created

None — no uncovered structural decision. adr-014 received an additive amendment note (shared
seam + read-only run-id constraint); no status changes, nothing superseded, no draft ADRs exist.

## Conditions

- **C1 (blocking-at-build):** daemon path never writes `.pipeline/conduct-session-id` — read-only
  resolve with caller-injected run id fallback (adr-2026-07-27 D7).
- **C2:** the shared helper derives its subscription set from `EVENT_SINKS`, not a literal list.
- **C3:** parity test asserts a signal reaching the interactive exporter also reaches the daemon
  path's (the issue's fifth outcome); covers flush on HALT/error dispatch ends.
