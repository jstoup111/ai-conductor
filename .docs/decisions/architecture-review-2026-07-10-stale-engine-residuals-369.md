# Architecture Review: Stale-engine auto-restart residuals (#369)
**Date:** 2026-07-10
**Mode:** lightweight (tier M — feasibility + alignment)
**Input:** explore output + technical intent (issue jstoup111/ai-conductor#369); stories/plan do not exist yet
**Verdict:** APPROVED

## Feasibility

All three gaps are repairable inside `src/conductor` with no new dependencies, schema, or
infrastructure. Claims verified by direct read on 2026-07-10:

- **Gap 1 (wiring).** `initStaleEngineState` (engine/stale-engine-init.ts) has zero
  production callers (verified: grep — only tests import it); `daemon-cli.ts:561-601`
  duplicates its Task 8-10 logic inline. Parity deltas between the two, enumerated so the
  wiring task closes them deliberately:
  1. The primitive does NOT create the `staleEngineChecker` — the caller keeps doing that
     from the returned identity (intended seam, verified against both bodies).
  2. The primitive logs ARMED/DISARMED from its `flag` param and documents that the caller
     must pass the already-gated value — daemon-cli must pass
     `(config?.auto_restart_on_stale_engine ?? false) && isSelfHost`, not the raw flag.
  3. The primitive passes `log` to `clearRestartMarker`; the inline block doesn't (benign).
  4. The primitive currently contains the SAME suppression-key bug as the inline block
     (`recordSuppression(engineIdentity, …)`) — wiring alone does not fix gap 3; both
     change together.
- **Gap 2 (log identities).** Two verdict sites in `engine/daemon.ts` need the identity
  pair: the rebuild path (`rebuildAndMaybeRestartForStaleEngine`, log at ~692) and the
  idle-tick path (~885-905, which currently logs nothing at the verdict itself). Both
  already have `fromIdentity`/`targetIdentity` in scope — log-line change only.
- **Gap 3 (suppression).** `recordSuppression`'s parameter is named `suppressedTarget`
  (restart-intent.ts:196) but receives the fresh boot identity; `isSuppressed` is consulted
  with the checker's on-disk `targetIdentity` (daemon.ts:687, 889; daemon-cli.ts:1088).
  `clearSuppression` exists (restart-intent.ts:307, `rm --force`, never throws) with zero
  production callers. Fix = pass `marker.targetIdentity` at the record site + call
  `clearSuppression` on a converged handshake. No signature changes.

## Alignment

- **adr-2026-07-03-daemon-auto-restart-stale-engine §4 (APPROVED)** defines the loop-guard:
  suppression fires when a restart fails to converge and holds "until the on-disk identity
  changes again." The shipped code records the fresh boot identity, which can never match a
  same-boot stale verdict (stale requires on-disk ≠ captured = fresh) — the implementation
  **diverged from the approved ADR**. This fix restores the ADR as written; therefore **no
  new ADR and no supersession** is needed. The decision categories in §7 are untouched
  (no new pattern, integration, stack, or infrastructure change).
- **adr-2026-07-06-stale-engine-respawn-in-place / adr-2026-07-07-single-generation-stale-respawn**:
  untouched — this change is upstream of the requester (record/log/clear only).
- **Deterministic-first (CLAUDE.md/HARNESS.md):** the repair is pure machinery — no LLM
  step, no prompt discipline.
- **Worktree isolation:** suppression state stays in `<repo>/.daemon/` (per-checkout), no
  shared resources introduced.
- **Diagrams:** `.docs/architecture/2026-07-10-stale-engine-residuals-369.md` (+ sequence)
  added this session and approved by the operator; the 2026-07-03 diagram remains accurate
  for the unchanged machinery.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Boot-path regression while swapping inline block for the primitive (identity capture, ARMED gating, marker clear ordering) | Technical | Low | High | Parity acceptance test re-pointed at the REAL path (asserts daemon-cli boots through `initStaleEngineState`); enumerate the four parity deltas above as explicit test assertions |
| Suppression fix validated only by injected-fake tests (the exact false-green pattern of #307/#367) | Technical | Medium | High | Story requires a real-flow acceptance test: record via the actual handshake, verdict via the actual checker, assert hold within the same boot |
| Self-host release gate's path classifier may flag `daemon-cli.ts` as a breaking surface | Integration | Low | Low | Internal-only behavior repair — if flagged, the migration-gate waiver path (adr-2026-07-06-migration-gate-waiver) applies |

## ADRs Created

None — the change restores an existing APPROVED ADR (adr-2026-07-03 §4). No decision
category from §7 is touched.

## Conditions

None. Verdict is a clean APPROVED; the High-impact risks are mitigated by story-level
acceptance requirements (negative-path + real-flow tests), which /stories must carry.
