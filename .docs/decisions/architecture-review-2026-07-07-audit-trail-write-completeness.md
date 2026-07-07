# Architecture Review: Audit-trail write-completeness for retro under fresh sessions
**Date:** 2026-07-07
**Mode:** lightweight (Tier M) — feasibility + alignment
**Stories reviewed:** none yet (pre-stories review per adr-2026-06-29-architecture-before-stories-convergent-kickback); input = intake issue jstoup111/ai-conductor#328 + `.docs/track/` + `.docs/architecture/audit-trail-write-completeness-for-retro-under-fre.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** pure TypeScript inside `src/conductor/src/engine`; no new dependencies.
  The subscriber pattern (`EventPersister`, `event-persister.ts:56-101`), the
  step→phase accessor (`phaseForStep`, `resolved-config.ts:264-266`), and the friction
  events (`step_retry` `conductor.ts:1395-1401`, `gate_verdict` `:2408`, `kickback`,
  `loop_halt`) all exist. Verified.
- **Prerequisites:** none — #325 (fresh session per step) is already merged;
  #191 is explicitly not a prerequisite (gate records derive from the current
  in-memory `GateVerdict`).
- **Integration surface:** engine-internal (bus subscription + two wiring points +
  daemon watcher callback) plus one skill-doc update (`skills/retro/SKILL.md`).
  No consumer-visible CLI/hook/schema surface.
- **Data implications:** new gitignored run-evidence file
  `.pipeline/audit-trail/events.jsonl`; append-only; no migrations.
- **Performance:** one small synchronous append per step outcome — negligible.
- **Worktree isolation:** records are written into the owning worktree's `.pipeline/`;
  the daemon watcher derives the worktree path from its closure
  (`daemon-deps.ts:294-337`). No shared state across worktrees.

## Alignment

- **Pattern consistency:** subscribe-and-append is the established engine pattern
  (`EventPersister`); O_APPEND whole-line atomicity is the documented convention
  (`engineer-store.ts:262-272`). No new pattern without an ADR — the one novel
  decision (event-sink as the audit contract, cross-cutting observability) is captured
  in `adr-2026-07-07-audit-trail-event-sink.md`.
- **Boundaries:** the writer consumes the bus; it does not reach into step internals.
  Skills remain uninstrumented — consistent with "fix at the engine seam" and with the
  daemon/engine ownership of retries, kickbacks, and HALTs.
- **State:** append-only log; no state machine changes; invalid states not introduced.
- **Diagram accuracy:** feature diagram authored and operator-approved 2026-07-07
  (`.docs/architecture/audit-trail-write-completeness-for-retro-under-fre.md`).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Bus swallows handler errors → silent writer failure recreates the original bug | Technical | Medium | High | Writer self-reports failures (stderr + best-effort `.pipeline/audit-trail/WRITE-FAILED` marker); a test asserts the failure path is loud |
| Daemon wiring forgotten → daemon runs (retro's main habitat) stay unrecorded | Integration | Medium | High | Wiring in `daemon-cli.ts` is an explicit story with a daemon-mode test, not a footnote |
| Event coverage drift: a future friction event type never reaches the subscribe list | Technical | Medium | Medium | Completeness test derives expectation from emitted-event fixtures; ADR names the mapping table as the single place to extend |
| Concurrent appends (daemon watcher + in-process engine) interleave | Data | Low | Medium | Whole-line single `appendFileSync` < PIPE_BUF (documented O_APPEND contract); concurrency test |
| Retro double-counts friction (events.jsonl + legacy batch artifacts) | Knowledge | Low | Low | Retro SKILL.md update names events.jsonl as the gate/rework source; batch artifacts stay for code-review detail |

## ADRs Created

- `adr-2026-07-07-audit-trail-event-sink.md` — **DRAFT**, presented for approval with
  this review (hard gate: must be APPROVED before stories/land).

## Conditions

1. **Dual-mode wiring is non-optional.** The writer must be instantiated in both
   `index.ts` (inline) and `daemon-cli.ts` (daemon). A daemon-mode test must assert
   friction records appear in the worktree's events.jsonl. (Prevents the
   "primitive built but unwired" failure class.)
2. **Writer failures must be loud.** Because `ConductorEventEmitter.emit` swallows
   handler errors, the writer must catch and self-report its own failures; a test
   covers the failure path.
3. **Positive evidence for every executed step**, including non-verdict steps
   (map step completion → `gate_pass`), so the completeness invariant
   "executed steps ⊆ recorded steps" is testable.
