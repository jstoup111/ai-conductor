# Conflict Check: Daemon memory observability and exit attribution (#2079)

**Date:** 2026-09-22
**Stories checked:** `.docs/stories/continuous-daemon-grows-to-4-2-gb-in-three-hours-a.md` (Stories 1–7)
**ADR corpus:** `conflict_check.adr_corpus` unset → `change_set`:
`adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` (D1–D10, amended 2026-09-22),
`adr-2026-08-08-pipeline-owned-closeout-timestamps` (D2), `adr-2026-08-09-hook-owned-containment-event-ledger` (E2),
`adr-2026-07-26-event-sink-registry-exhaustiveness`, `adr-010-pidfile-lock-daemon-liveness`,
`adr-2026-07-06-stale-engine-respawn-in-place`, `adr-014-otel-observability-exporter`.
**Result:** Conflict check passed — 0 blocking, 0 degrading.

## Pairs examined (both directions)

| Pair | Shared surface | Verdict | Grounding |
| --- | --- | --- | --- |
| Story 4 vs `daemon-lock-exclusivity-pidfile-boot-refusal-and-p.md` (binding #554 constraint) | Pane foreground command line contains `daemon --continuous` | No conflict (verified, 90%) | That story forbids the *engine* from inspecting any process's command line; holder signals are pidfile fields plus `kill(pid,0)`. The wrapper's command line carrying the literal string is therefore invisible to the census. Story 4 adds no cmdline inspection. |
| Story 4 vs `fix-400-stale-engine-respawn-in-place-stacks-daemo.md` ("count of `daemon --continuous` processes equals exactly 1 at steady state") | Process count after respawn | No conflict (verified, 85%) | The shipped tests count via the pidfile and `respawn-pane`, not `pgrep -f`; no test under `src/conductor/test` greps `/proc` or `cmdline` for the daemon. The wrapper spawns exactly one daemon child, so a pid-based count remains 1. Story 4 Done-when pins "runs the launcher as the single child". |
| Story 4 vs `adr-2026-07-06-stale-engine-respawn-in-place` / hosting ADR D1 (one clean foreground, no double-fork) | `respawn-pane -k` kills the pane's process tree | No conflict | The daemon is the wrapper's only child and receives the same pty hangup it receives today as the direct child. A planned stale-engine exit (code 0) is witnessed like any other exit; no story requires otherwise. |
| Story 4 vs `adr-2026-08-08` D2 / `adr-2026-08-09` E2 (one writer per ledger file) | `.daemon/` ledgers | No conflict | Story 4's negative path pins that the witness never opens `.daemon/events.jsonl`; `.daemon/exit-events.jsonl` has one writer. Same shape as `record-land-gate-rejections-on-the-event-spine.md`'s composer ledger. |
| Stories 1–2 vs `no-daemon-level-metrics-queue-depth-halts-and-gate.md` Story 3 (`conductor.daemon.up` goes stale on hard-kill) | Daemon death signal | No conflict | OTel untouched (sink rows `otel: false`); the stale-series behavior stands and Story 5's status rendering is an additional, not replacement, surface. |
| Story 1 vs `daemon-dispatched-builds-emit-no-otel-telemetry-th.md` (step runner is the only writer of `.pipeline/conduct-session-id`) | Feature `.pipeline/` | No conflict | Story 1 writes daemon-origin records to `.daemon/events.jsonl` only and pins that none reach the feature ledger. |
| Story 7 vs `evidence-stamps-sync-to-task-status-rows-so-progre.md`, `unify-build-completion-evidence-derivation-fix-der.md` | Task re-seed from trailers + `task-status.json` | No conflict | Story 7 asserts the existing union semantics (row ∪ trailer) and adds no new derivation; it is a verification story. |
| Story 7 vs `daemon-reaps-a-feature-worktree-at-pr-open-before-.md` | Worktree lifetime | No conflict | Reap is deferred to the shipped record on main; a killed mid-build feature has no shipped record, so its worktree and `.pipeline/` survive. |
| Story 3 vs Story 4 | Heap abort exit (134/SIGABRT) | No conflict; sequencing is Story 3 → 4 | Story 3's negative path depends on Story 4's witness; both hold when satisfied together. |
| Story 2 vs Story 1 | Sampler feeds the dump trigger | No conflict | One dump per daemon lifetime is compatible with per-boundary sampling; oscillation test passes both ways. |
| Story 5 vs Story 6 | Both read `.daemon/exit-events.jsonl` | No conflict | Same reader, two callers; neither mutates the ledger. |

## Oscillation check

No pair produced two "no" answers. The only mutual dependency (Story 3 negative → Story 4) is
one-directional.

## Notes

- No `[AS-BUILT]` stories in scope.
- No ADR was superseded; no story text changed.
