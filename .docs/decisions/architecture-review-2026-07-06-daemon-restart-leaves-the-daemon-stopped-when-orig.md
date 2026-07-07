# Architecture Review: Stale-engine restart respawn wiring (#353)
**Date:** 2026-07-06
**Mode:** Lightweight (tier M — feasibility + alignment)
**Track:** technical (no PRD; input = explore output + approved Approach A)
**Stories reviewed:** none yet — pre-stories review per adr-2026-06-29-architecture-before-stories-convergent-kickback
**Verdict:** APPROVED (adr-2026-07-06-stale-engine-respawn-in-place operator-APPROVED 2026-07-06)

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependencies. tmux 3.2a `set-option -w` form verified live; `respawnPane`, `triggerSelfRestart`, `relinkSkillsForSelfBuild`, boot handshake all exist and are tested. |
| Prerequisites | None outstanding: #215 (transport) CLOSED, #320/#321 (rebuild + hash fixes) MERGED. #266 (origin-refresh timing) remains open and is explicitly out of scope. |
| Integration surface | Contained to `src/conductor/src/{engine/daemon-tmux.ts, engine/daemon.ts, engine/install-freshness.ts, engine/daemon-supervisor-cli.ts, daemon-cli.ts, index.ts}` + tests. No API/schema/consumer-repo surface. |
| Data implications | None (two JSON marker files, schemas unchanged). |
| Performance risk | Relink adds a `bin/install --update` run to restart handoffs — seconds, at an idle/pre-dispatch boundary; acceptable. |
| Worktree isolation | All state under the repo's `.daemon/`; tmux session name is repo-derived; no shared-resource contention between worktrees. Tests needing real tmux must use isolated session names (existing smoke-test pattern). |

## Alignment

- **adr-2026-07-03-daemon-auto-restart-stale-engine (APPROVED):** amended, not violated —
  gates, marker schema, boot handshake, suppression loop-guard all preserved; only the
  "requester never respawns" contract changes, which that ADR itself marked as deferred to
  #215's transport. Amendment recorded in adr-2026-07-06-stale-engine-respawn-in-place.
- **adr-2026-07-04-pending-restart-queue (APPROVED):** non-autonomy clause preserved —
  daemon-side code never writes the hyphen marker; the autonomous respawn trigger is the
  "separate, explicitly gated decision" that ADR anticipated. The "never exits without a
  successor arranged" invariant is strengthened (respawn failure → stay alive; headless →
  durable marker + revivable pane).
- **adr-2026-07-04-respawn-in-place-restart (APPROVED):** this feature consumes its
  transport unchanged; fixing `setRemainOnExit` corrects that ADR's own stated mechanism
  ("remain-on-exit (already set)" — it never was).
- **ADR-005 launch-never-manage / adr-010 pidfile:** untouched — the daemon still only
  ever terminates/replaces itself; pidfile succession mirrors the tested CLI respawn path.
- **Pattern consistency:** injected-deps seam style (`triggerSelfRestart` optional dep)
  matches existing daemon.ts/T28 conventions; no new patterns introduced.
- **Diagram accuracy:** feature diagrams authored and operator-approved
  (`.docs/architecture/daemon-restart-leaves-the-daemon-stopped-when-orig.md` + sequence);
  the two superseded 2026-07-03 diagrams carry pointer notes.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Respawn loop on non-converging engine | Technical | Low | High | Existing suppression loop-guard (boot handshake) unchanged and already tested |
| Relink failure leaves daemon stale-but-alive | Technical | Low | Medium | Loud log; deliberate fail-safe direction (beats down-and-blocked); operator backstop via `daemon start` gate |
| tmux option-target parsing changes across versions | Integration | Low | High | Smoke test pins `show-options` result + survive-own-exit behavior; verified on deployment target 3.2a |
| Injected-runner tests pass on wrong argv (prior harness lesson) | Knowledge | Medium | High | Real-binary/real-tmux smoke required in stories (feedback: injected-runner needs real-binary smoke) |

## ADRs Created

- `adr-2026-07-06-stale-engine-respawn-in-place` — **APPROVED** by the operator on
  2026-07-06 (interactive engineer session).

## Conditions

None beyond the ADR-approval gate above.
