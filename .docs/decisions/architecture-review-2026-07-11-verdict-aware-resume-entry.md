# Architecture Review: Verdict-Aware Resume Entry (#532)
**Date:** 2026-07-11
**Mode:** Lightweight (tier M, technical track) — feasibility + alignment
**Stories reviewed:** none yet (pre-stories review per adr-2026-06-29-architecture-before-stories-convergent-kickback); input = explore output + issue #532 trace
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TypeScript change inside `src/conductor` — no new packages, services, or infrastructure. |
| Prerequisites | None. `readAllVerdicts`, `gateSatisfied`, `selectNextGate`, `deriveGateTopology` all exist and are exported/pure (verified in worktree at f31bcee3). |
| Integration surface | One seam: `conductor.run()` startIndex derivation. Both callers (daemon-cli resume:true, operator CLI --resume) flow through it — no per-caller changes. `checkGate`, `findResumeIndex` internals, and the loop tail are untouched. |
| Data implications | None. Reads existing `.pipeline/gates/*.json`; writes nothing new. |
| Performance risk | One extra verdict-directory read per resume — negligible (resumes are rare, per-feature). |
| Worktree isolation | No new shared resources; operates on the feature worktree's own `.pipeline`. |

## Alignment

- **Pattern consistency:** reuses the loop tail's existing verdict authority (`selector.ts`)
  rather than introducing a second satisfaction predicate — the same "one authority" principle
  behind #436/#516's shared `recordRebaseStepCompletion`.
- **Deterministic-first (CLAUDE.md design principle):** the fix is engine machinery that fails at
  the point of violation; no prompt-level discipline involved.
- **Prior ADR fit:** complements `2026-07-08-post-rebase-gate-first-reverify` (memory) and the
  kickback-verdict design — kickback verdicts written by a file-changing rebase become effective
  on resume, not only inside a live loop.
- **State management:** state file remains the record of step *status*; verdicts remain the record
  of gate *satisfaction*. The clamp reads both, mutates neither at entry (Option C's
  side-effectful reconciliation was rejected for exactly this boundary).
- **Failure direction:** any verdict anomaly pulls the resume backward (re-run work), never
  forward (false ship) — fail-safe.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Negative-path regression: clamp accidentally drags all-satisfied resumes backward/forward | Technical | Low | Medium | Backward-only min() formulation; pinned negative-path test (ADR follow-up 3) |
| Front-half resumes dragged forward to `stories` by pending loop gates | Technical | Medium (if formulated naively) | Medium | Explicit backward-only rule in ADR §Decision.1 + dedicated test (follow-up 4) |
| `in_progress` finish not re-clamped on second resume | Technical | Low | High | ADR §Decision.2 covers both branches; #532 fixture test includes `finish: in_progress` |
| Verdict file corruption pulls resume far backward | Data | Low | Low | Wasted compute only, bounded by existing kickback/selection caps |

## ADRs Created

- `adr-2026-07-11-verdict-aware-resume-entry.md` — DRAFT, presented for operator approval this
  session (interactive DECIDE; must be APPROVED before stories/land).

## Conditions

None. Clean approval contingent on the ADR reaching APPROVED status (operator gate, this session).
