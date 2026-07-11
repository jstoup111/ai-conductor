# Architecture Review: Fix #400 — single-generation stale-engine respawn
**Date:** 2026-07-07
**Mode:** lightweight (tier M, technical track) — feasibility + alignment
**Input reviewed:** explore output + approved diagrams (`.docs/architecture/fix-400-stale-engine-respawn-in-place-stacks-daemo.md`, `sequences/…`); stories/plan do not exist yet
**Verdict:** APPROVED (conditional on ADR approval — adr-2026-07-07-single-generation-stale-respawn)

## Feasibility

- **Stack:** no new dependencies, services, or schema. All changes land in four existing
  modules: `daemon.ts` (idle-branch break), `daemon-cli.ts` (requester exit + loser exit),
  `daemon-lock.ts` (bounded wait), `.ai-conductor/config.yml` (flag re-enable).
- **Prerequisites:** none — #353's remain-on-exit fix (already merged) is what makes the
  unconditional-exit design safe (dead pane stays revivable).
- **Integration surface:** confined to the daemon lifecycle; no cross-domain reach. The
  guarded `RESTART-PENDING` verb path shares no flag or marker with this change.
- **Test surface:** the #393 suite pins the buggy behavior — `daemon-cli-restart-requester.test.ts`
  asserts session-hosted "no lock release, no exit" and MUST flip (assert release + exit-0 on
  fired trigger; retain trigger-failure stay-alive). New coverage required: repeated-idle-poll
  single-fire, predecessor-pid-gone, bounded lock takeover, loser explicit exit, real-tmux
  e2e asserting `pgrep` count == 1 across the transition.
- **Worktree isolation:** touched tests spawn real tmux/daemons — must honor the existing
  env kill-switch guard for production spawns and per-worktree isolation conventions.

## Alignment

- **adr-2026-07-06-stale-engine-respawn-in-place:** the "fire and don't exit" clause is the
  proven-wrong assumption; the new ADR **amends that clause only**. The ADR's core invariant
  (exit leaves a running successor or a revivable dead pane) and its fail-safe direction on
  trigger failure (stay alive, retry) are preserved verbatim.
- **adr-010-pidfile-lock-daemon-liveness:** the loser-exit change *enforces* what ADR-010
  already specifies ("loser no-ops/exits 0"); bounded wait stays inside the lock module
  boundary ADR-010 designated as swappable; single-winner O_EXCL semantics unchanged.
- **adr-2026-07-04-pending-restart-queue:** untouched — nothing daemon-side writes the hyphen
  marker; `restartTriggeredSuccessfully` remains verb-path-only.
- **Pattern consistency:** the idle-branch break mirrors the existing dispatch-boundary
  `stopReason: 'engine_restart'` precedent; no new pattern introduced without an ADR.
- **State management:** the fired/failed trigger distinction is made explicit in
  `requestRestart`'s return contract rather than an implicit boolean flag left set across
  loop iterations.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Trigger reports success, successor never boots → daemon down until nudged | Technical | Low | High | Remain-on-exit dead pane + marker survive; `ensureRunning`/`start` revives; e2e asserts successor liveness |
| Bounded-wait window too short → spurious loser exits during slow handoffs | Technical | Medium | Low | Generous bound (seconds, module-confined constant); loser exit is clean + next nudge converges |
| Flipped #393 assertions mask a regression on the trigger-failure path | Knowledge | Low | Medium | Retain stay-alive-on-failure assertions unchanged; flip only fired-trigger assertions |
| Re-enabled flag before fix proven → recurrence of stacking | Technical | Low | High | Config flip rides the same change set as the fix and its e2e evidence; single PR |

## ADRs Created

- `adr-2026-07-07-single-generation-stale-respawn` (DRAFT → pending operator approval;
  amends adr-2026-07-06 narrowly, enforces adr-010).

## Conditions

1. The ADR must reach APPROVED before stories/land (hard gate).
2. Fired-trigger vs failed-trigger semantics must be kept distinct in tests (flip only the
   former).
3. Real-tmux e2e must assert the single-generation invariant (`pgrep` count == 1 and
   predecessor pid gone), the assertion shape #393's suite lacked.
