# Architecture Review: Daemon rate-limit episode coordinator

**Date:** 2026-07-05
**Complexity tier:** L (full review)
**Source:** jstoup111/ai-conductor#270
**Verdict:** APPROVED (pending ADR approval)

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✅ Pure TS module + existing dep-injection seams. No new packages, services, or infra. |
| Prerequisites | None. Builds on shipped `waitSeconds` provider contract (#222/PR #343). |
| Integration surface | 3 files edited (`conductor.ts`, `daemon.ts`, `daemon-cli.ts`) + 1 new module + 1 pre-step call site (`project-prelude.ts`). Within-repo; no external API surface added. |
| Data implications | None — no schema, no persistence (episode is in-memory, transient). |
| Performance risk | Positive: replaces N independent 300s sleeps with one coordinated wait; escalating re-probe caps wasted wall-clock. |
| Worktree isolation | ✅ No new ports/DBs/shared files. Coordinator is per-daemon-process in-memory state; one daemon per repo. |

## Complexity

L tier (already assessed by `/conduct` complexity step). Novel state machine (episode lifecycle),
cross-component coupling (conductor ↔ dispatch loop), in-process concurrency across N features, and
signal-handling correctness. Not split — the four changes are tightly coupled around one coordinator
and are best landed together for coherent test coverage.

## Alignment

- **Dep-injection purity:** the dispatch gate and coordinator are injected via `DaemonDeps` with
  optimization-never-authority semantics (absent dep → today's behavior), matching the established
  `isHalted?`/`sleep?`/`watchHaltCleared?` pattern.
- **Shared in-process object precedent:** mirrors the already-injected `ConductorEventEmitter`
  (daemon-cli.ts:388/471) and the `waker.ts` module shape from the event-driven-wake plan.
- **Composition, not duplication:** event-driven-wake (#111) handles fast self-heal *after* a HALT
  clears; this feature prevents the HALT during an episode. No overlap in mechanism.
- **State management:** episode is an explicit lifecycle (idle → active(deadline) → re-probe →
  cleared), not a boolean flag; deadlines are values, timers injected.

## Domain Integrity

- Deadlines represented as injected `nowMs`/`untilMs` numbers (timer-injected for tests), not
  wall-clock reads inside the module — keeps it pure and deterministically testable.
- No primitive-obsession concern: the coordinator exposes intent-named methods (`enter`/`active`/
  `clear`), not raw flag mutation.
- Exhaustive: the dispatch gate has two arms (active → suppress new picks; inactive → normal), no
  catch-all default over episode state.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| SIGTERM handler leaks listeners if not `off()`-ed at every conductor exit | Technical | Medium | Medium | Mirror the existing SIGINT `off()` at all ~13 exit sites; add a leak test. |
| Dispatch gate races with in-flight teardown / double-dispatch | Technical | Medium | High | Gate only suppresses NEW `pickEligible`; in-flight untouched; negative-path tests for wake-during-active. |
| Escalating re-probe never clears if the account stays limited | Technical | Low | Medium | Cap the interval; each re-probe is a real retry (`attempt--` preserved) so it makes progress when the limit lifts. |
| A pre-step invoke site other than `project-prelude` also drops `rateLimited` | Integration | Medium | Medium | Story audits ALL non-step `provider.invoke` call sites; assert each propagates or routes rateLimited. |
| Restart mid-episode loses coordination | Data | Low | Low | Accepted — transient; daemon re-discovers backlog and re-enters episode on the next limited call. |

## ADRs Created

- `adr-2026-07-05-daemon-rate-limit-episode-coordinator.md` (DRAFT → needs operator approval):
  chooses the in-process coordinator (Option B) over the file marker (Option A), and specifies the
  dispatch gate, signal-responsive wait, and call-site classification.

## Conditions

None blocking. One tracked verification (folded into a story): audit every non-step
`provider.invoke` call site for `rateLimited` propagation (project-prelude confirmed; enumerate the rest).
