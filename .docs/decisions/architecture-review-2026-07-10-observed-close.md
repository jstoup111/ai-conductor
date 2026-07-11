# Architecture Review: Observed-close — issues close on first production observation (#492)
**Date:** 2026-07-10
**Mode:** Lightweight (Tier M) — feasibility + alignment; pre-stories, technical track
**Stories reviewed:** none yet (pre-stories review per adr-2026-06-29-architecture-before-stories-convergent-kickback); input = explore output + operator-locked approach
**Verdict:** APPROVED

## Feasibility

- **Stack:** no new dependencies. Registry/sweep/gh idioms all exist in-tree
  (`mergeable-sweep.ts`, `pr-labels.ts` gh helpers, `daemon-log.ts` read primitives).
  Verified 100% (read directly).
- **Prerequisites:** none at runtime. Spec-time: engineer flow must author the new
  `.docs/observation/<plan-stem>.md`; `engineer land` gains one assertion. Both are
  additive; legacy specs without a marker keep today's close-on-merge path.
- **Integration surface:** 4 seams, all verified — `daemon-cli.ts` post-run block
  (conditional `Closes`/`Refs` + enrollment), `issue-ref.ts` (`closeIssueOnImplementationMerge`
  signature extension), `daemon.ts` `sweepBestEffort` (third best-effort call),
  `engineer land` artifact gate. No schema/DB, no external services beyond gh.
- **Durability trap resolved:** per-worktree `.pipeline/events.jsonl` dies at worktree
  teardown → v1 observation surface is the repo-durable `.daemon/daemon.log` (+ `.1`
  rotation file), which already carries rendered `ConductorEvent` lines
  (`renderDaemonEvent`). Verified against `daemon-log.ts` (1 MB single-file rotation) and
  event wiring.
- **gh quota:** awaiting-merge PR polls throttled to ≥5 min per entry (operator's standing
  REST-budget rule); log scans are local and free. The existing 5 s idle tick does not leak
  into gh call cadence.

## Alignment

- **Deterministic-first (CLAUDE.md design principle):** fully mechanical — no LLM anywhere
  in the close path. The signature is declared once at spec time (judgement), everything
  downstream is plain code.
- **Pattern consistency:** mirrors the mergeable-watch registry + sweep exactly (append-only
  `.daemon/*.jsonl`, best-effort/non-throwing, survivors rewrite). One deliberate
  improvement: explicit `v: 1` schema tag on entries.
- **State management:** explicit per-entry state machine (awaiting-merge → watching →
  closed | no-show | pruned) derived from persisted fields (`mergedAt` presence,
  `enrolledAt + windowDays`), not boolean flags. Invalid states unrepresentable: a
  `watching` entry always carries `mergedAt`.
- **Failure semantics:** every gh/fs failure is logged and swallowed; the sweep can never
  block or fail a build — matches `sweepBestEffort` contract (FR-15 lineage).
- **Boundaries:** issue-ref.ts stays the sole owner of trailer formatting; daemon-log.ts
  stays the sole owner of log-path/rotation knowledge (scan helpers go there);
  no cross-repo state (registry is per-repo `.daemon/`).
- **Worktree isolation:** registry and log live under the primary repo's `.daemon/` —
  written only by the daemon process, never by build worktrees. No new ports/services/DBs.
- **Security:** no new inputs beyond the committed marker (authored via the gated engineer
  flow); gh calls use existing authenticated runner; signature is matched with substring or
  anchored regex — regex compile failure at land time is a gate error, at sweep time is
  logged + entry pruned as malformed (fail-loud, never crash the loop).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Signature line rotated away before any sweep scan (daemon restarts with >1 MB logs between observations) | Technical | Low | Medium | Scan both daemon.log and daemon.log.1; sweep runs every idle tick + startup; window no-show flags rather than silently closing |
| Weak signature also emitted by old code → false close | Data | Medium | Medium | Matches count only after PR `mergedAt`; guidance in stories: signature should be a line only new code emits |
| gh close/comment fails transiently | Integration | Medium | Low | Entry survives, retried next tick; idempotent (already-closed → prune) |
| `observation:no-show` label add fails on Projects-classic (gh edit bug) | Integration | Medium | Low | Use REST `gh api .../labels` (PR #172 precedent) |
| Daemon never runs again → issue never closes/flags | Knowledge | Low | Low | Accepted: daemon is production here; issue simply stays open (fail-open-to-visible) |
| Marker/plan stem mismatch → watch never enrolled | Technical | Low | Medium | Land gate stem-matches marker to plan (same mechanism as complexity tier gate) |

## ADRs Created

- `adr-2026-07-10-observed-close-watch-registry.md` — DRAFT, presented for operator
  approval (must reach APPROVED before land).

## Conditions

None — clean APPROVED, contingent only on the ADR reaching APPROVED status via the
operator gate below (interactive engineer session; no autonomous downgrade possible).
