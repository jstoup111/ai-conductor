# Architecture Review: daemon-stale-engine-origin-advance

**Date:** 2026-07-22
**Mode:** Lightweight (Tier M) — feasibility + alignment, pre-stories (technical track, no PRD)
**Input reviewed:** Approach C (operator-approved at /explore), architecture doc
`.docs/architecture/2026-07-22-daemon-stale-engine-origin-advance.md`, intake #598
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** No new packages, services, or infrastructure. Reuses
  `fastForwardRoot` (daemon-backlog.ts:149, already exported and imported by
  `src/daemon-cli.ts`), `publish-engine.mjs`, the stale-engine checker, and the #400 restart
  transport. Verified in source.
- **Prerequisites:** None beyond existing self-host wiring; `rebuildEngine` dep pattern
  (`src/daemon-cli.ts:1280`) is the template for the new `refreshEngineSource` dep.
- **Integration surface:** Two files own the behavior change (`engine/daemon.ts`,
  `daemon-cli.ts`) plus `publish-engine.mjs` for the SHA stamp — under the 3-boundary flag
  threshold.
- **Data implications:** One new sidecar file per published engine version. No schema,
  no migrations.
- **Performance:** A git fetch at quiescent boundaries — mitigated by the ADR's mandatory
  throttle (min-interval, default ~idle-poll cadence). No unbounded work.
- **Worktree isolation:** Operates only on the daemon's own root checkout; per-feature
  worktrees untouched. `fastForwardRoot` already refuses non-default-branch/dirty roots.

## Alignment

- **Existing decisions honored:** quiescent-only + fail-closed + suppression
  (adr-2026-07-03-daemon-auto-restart-stale-engine), relink-before-handoff
  (adr-2026-07-06-stale-engine-respawn-in-place), single-generation
  (adr-2026-07-07-single-generation-stale-respawn), launch-never-manage (ADR-005),
  pidfile liveness (ADR-010). The design adds a step *inside* the existing guarded gate
  rather than a new restart point — no drift.
- **Pattern consistency:** Injected-dependency wiring mirrors `rebuildEngine`; warning
  dedup mirrors non-convergence suppression's "don't spam a persistent condition" posture.
- **State management:** No new persistent state machine; the SHA stamp is write-once-per-
  publish observability data, never a restart trigger (restart remains content-hash keyed).
- **New-pattern ADR:** Created — `adr-2026-07-22-origin-refresh-before-engine-rebuild`
  (infrastructure decision category: engine refresh trigger semantics).

## Wiring Surface (design-time)

| New surface | Wired from (production) |
|---|---|
| `refreshEngineSource` injected dep (runs `fastForwardRoot`) | `src/daemon-cli.ts` daemon deps block (alongside `rebuildEngine:` at :1280), invoked by `rebuildAndMaybeRestartForStaleEngine` in `src/conductor/src/engine/daemon.ts` at the existing pre-dispatch + drained-idle call sites |
| Source-SHA sidecar stamp | `src/conductor/scripts/publish-engine.mjs` publish flow (next to `.engine-source-key` stamping), executed by `npm run build` / `rebuildEngineFromSource` |
| Loud staleness warning (cause + reload path, deduped) | Emitted via the daemon `log` sink inside the same quiescent gate (self-host degraded paths) and the advisory probe branch (non-self-host / flag off) |
| Fetch-throttle interval (config-derived) | Read once at daemon startup in `src/daemon-cli.ts` config resolution, passed into the deps block |
| Docs | `docs/daemon-operations.md`, `docs/configuration.md`, `src/conductor/README.md` per Documentation Upkeep |

**Early overlap scan (advisory):** `conduct-ts overlap-scan` reports ~20 unmerged spec
branches touching `src/conductor/src/engine/daemon.ts` — it is the repo's hot file. The
change here is small and additive inside one function; expect routine rebase conflicts,
none structural. No overlap reported on `publish-engine.mjs` or `daemon-backlog.ts`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Fetch at every quiescent boundary adds network chatter/latency | Performance | Medium | Low | Mandatory min-interval throttle (ADR §2); throttled skip is silent |
| Warning spam on persistent dirty/diverged root | Technical | Medium | Low | Dedup per cause+SHA (ADR §4) |
| `fastForwardRoot` heal path misbehaving at new call site | Technical | Low | Medium | Reused verbatim (not forked); existing containment try/catch; same guards already exercised on refresh paths |
| Restart loop if refresh+rebuild oscillates | Technical | Low | High | Existing non-convergence suppression unchanged; restart trigger stays content-hash (proven fail-closed) |
| daemon.ts overlap with ~20 unmerged spec branches | Integration | High | Low | Additive change inside one function; routine rebase |

## Domain Integrity

N/A beyond the above — no new domain types; the SHA stamp is an opaque string sidecar,
explicitly never parsed into restart decisions (fail-closed on absence).

## ADRs Created

- `adr-2026-07-22-origin-refresh-before-engine-rebuild` — DRAFT at creation; presented to
  the operator for approval in this session (engineer flow gates land on APPROVED).

## Conditions

None — the throttle and dedup requirements are binding via the ADR itself.
