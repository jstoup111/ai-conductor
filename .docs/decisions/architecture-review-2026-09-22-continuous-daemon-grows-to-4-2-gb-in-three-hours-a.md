# Architecture Review: Daemon memory observability and exit attribution (#2079)

**Date:** 2026-09-22
**Verdict:** APPROVED (lightweight review — Tier M, technical track)
**ADR:** `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` amended (D8–D10, APPROVED); no new ADR
**Reviewed against:** `.docs/architecture/continuous-daemon-grows-to-4-2-gb-in-three-hours-a.md`, `.docs/track/continuous-daemon-grows-to-4-2-gb-in-three-hours-a.md`
**Scope boundary (binding):** observability and recovery only — memory samples on the spine, a
threshold heap dump, a heap cap, an out-of-process exit witness, resume verification. No growth
fix, no OpenTelemetry instrument, no per-dispatch child-process isolation.

## What was reviewed

The proposal to (a) emit `daemon_memory_sample` and `daemon_heap_dump_written` from the in-process
gate loop at step boundaries, (b) cap the daemon's V8 heap in `DAEMON_FOREGROUND_COMMAND`, (c) make
the tmux pane foreground a wrapper that records `daemon_exited` when the daemon dies, (d) render the
last exit cause and last sample from `daemon status` / `ensureRunning`, and (e) verify that an
abruptly killed feature resumes from `Task:` trailers with its worktree `.pipeline/` intact.

## Findings

### F1 — A second writer on `.daemon/events.jsonl` violates the one-writer-per-ledger rule (resolved)

The first draft had the wrapper append `daemon_exited` to `.daemon/events.jsonl`, the file the
engine's `startDaemonEventPersistence` already writes. `adr-2026-08-08-pipeline-owned-closeout-timestamps`
D2 and `adr-2026-08-09-hook-owned-containment-event-ledger` E2 reject exactly that shape:
`appendFileSync` is atomic only under `PIPE_BUF`, and `parseLedger` fails closed on one torn line,
so a cross-process append risks the whole ledger. The wrapper writes only after the daemon has
exited, but a respawn-in-place can start a new daemon while the old wrapper is still writing, so
the window is real. **Resolution:** the wrapper owns `.daemon/exit-events.jsonl`; readers merge
by timestamp. Recorded as D10 of the amended hosting ADR; diagram updated.

### F2 — "One clean foreground process" is preserved (verified, 90%)

`adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` D1 requires no double-fork and one
long-lived foreground process. tmux runs the pane command through a shell (`newDetachedSession`
passes it as the final `new-session` argument; `respawnPane` already builds a `cat …; exec …`
shell string), so a wrapper of the form `launcher daemon --continuous; rc=$?; launcher daemon
exit-witness --code $rc` adds one shell parent and no second long-lived process. The daemon is
the shell's only child; `remain-on-exit` semantics are unchanged. Recorded as D9. Confidence is
inferred from source reading, not a live run; Story coverage must include a real-tmux fixture on a
private socket (repo test policy).

### F3 — The witness cannot distinguish OOM from any other SIGKILL (accepted)

The wrapper sees exit status 137 for every SIGKILL. Attributing it to the kernel OOM killer needs
`dmesg`/journal access the wrapper does not have. The record therefore says `signal: SIGKILL` plus
the last memory sample the engine wrote; the operator reads the two together. This is enough to
stop `execution interrupted before a terminal event was emitted` being the only account, which is
the stated outcome. Not a blocker.

### F4 — The heap cap converts one failure into another; that is the intent (accepted)

`--max-old-space-size` makes growth end as `FATAL ERROR: … JavaScript heap out of memory` with a
stack in `.daemon/daemon.log` and exit code 134 (SIGABRT), which the witness records. The default
must sit below the host's practical ceiling; it is operator-tunable via a flat `daemon_*` key
following `daemon_concurrency`'s validator pattern. Note the cap bounds only V8 old space; `rss`
also includes external/native memory, so the sampler must report `rss`, `heapUsed`, and `external`
separately or the curve will mislead.

### F5 — Resume is already built; this feature proves it (verified, 85%)

Task re-seed from `Task:` trailers and `task-status.json` exists (runbook
`worktree-and-evidence-recovery.md`, `stalled-or-stuck-feature.md`), and the daemon does not reap
worktrees on death. No engine change is warranted for outcome (e); the story is a negative-path
acceptance test (kill the daemon mid-build, redispatch, assert completed tasks are not redone) and
a runbook entry for "daemon died abruptly, no HALT". If the test falsifies the claim, that is a
separate intake, not scope creep here.

## Feasibility

| Check | Result |
| --- | --- |
| Stack | Node ≥26: `process.memoryUsage()` and `v8.writeHeapSnapshot()` are built in. No new dependency. |
| Prerequisites | None. `.daemon/` exists; `shellQuote` exists in `canonical-launcher.ts`. |
| Integration surface | `types/events.ts`, `event-sinks.ts`, `daemon-tmux.ts`, `daemon-command.ts` (subverb table), `daemon-cli.ts` root-bus wiring, `daemon-observe-cli.ts`, `daemon-lock.ts`, `config.ts` — within one daemon domain. |
| Data | Two append-only ledgers plus bounded heap snapshots under `.daemon/heap/` (gitignored, retention cap). A heap snapshot of a 4 GB process can be gigabytes; write once per run and cap retention. |
| Performance | `process.memoryUsage()` is microseconds; a step-boundary cadence is tens of samples per hour. `writeHeapSnapshot` blocks the event loop for seconds — acceptable once per run at a threshold. |
| Worktree isolation | Everything lives under `<mainRoot>/.daemon/`, already excluded from the live boundary. |

## Alignment

- **Event spine:** samples, dump records, and exits are occurrences and become `ConductorEvent`
  variants; sink registry entries are required (`adr-2026-07-26-event-sink-registry-exhaustiveness`).
  The wrapper is exception A; the sibling ledger is exception B's prescribed shape.
- **Liveness:** adr-010 pidfile liveness untouched; `daemon_exited` is telemetry, not a liveness
  input. `ensureRunning` gains a report on its existing `onReclaim` seam.
- **OTel:** adr-014 untouched by operator decision; the sink rows carry `otel: false`.
- **Machinery over prompt:** all four surfaces are engine code; no skill text changes.
- **Release gate:** the foreground command change is daemon-internal, not one of the four canonical
  breaking surfaces; no migration block expected. If the release classifier flags it, a waiver
  under `.docs/release-waivers/` is appropriate.

## Wiring Surface

| New surface | Called from in production |
| --- | --- |
| `daemon_memory_sample`, `daemon_heap_dump_written` events | Emitted by a sampler subscribed to the root `ConductorEventEmitter` in `daemon-cli.ts`, wired beside `startDaemonEventPersistence`, on `step_started`/`step_completed`. Persisted by the existing daemon persister. |
| `daemon_exited` event + `.daemon/exit-events.jsonl` | Written by `ai-conductor daemon exit-witness`, invoked by the shell wrapper `DAEMON_FOREGROUND_COMMAND` builds in `daemon-tmux.ts` (both `newDetachedSession` and `respawnPane`). Subverb registered in `daemon-command.ts`. |
| Heap cap flag | Part of `DAEMON_FOREGROUND_COMMAND`; value from config validated in `engine/config.ts`. |
| Exit-ledger reader | `daemon-observe-cli.ts` status sweep (rendered beside `session-up/process-dead`) and `daemon-lock.ts::ensureRunning` on reclaim of a dead pid. |
| Runbook entry | `docs/runbooks/daemon-recovery.md` — abrupt death, no HALT. |

Overlap scan over these paths: no overlap detected, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Heap snapshot of a multi-GB process fills disk or stalls the loop | Performance | Medium | Medium | Once per run, threshold-gated, retention cap, size logged in the event |
| Wrapper quoting breaks the pane command on a path with spaces | Technical | Low | Medium | Build with `shellQuote`; real-tmux fixture on a private socket |
| Default heap cap too low kills healthy builds | Technical | Low | Medium | Default generous (≥ 2× observed fresh baseline × safety), operator-tunable, documented |
| Existing tests assert the exact `DAEMON_FOREGROUND_COMMAND` string | Technical | High | Low | Four named test files updated in the same diff |

## ADRs Created

None. `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` amended in place with D8–D10
(heap-capped foreground; exit witness as pane foreground; sibling ledger, one writer per file).
Amendment ratified by the operator in this DECIDE session.
