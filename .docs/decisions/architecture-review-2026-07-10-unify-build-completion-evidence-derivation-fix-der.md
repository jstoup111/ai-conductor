# Architecture Review: Unified Build-Completion Evidence Derivation (#456 + #463)
**Date:** 2026-07-10
**Mode:** Lightweight (tier M, technical track — pre-stories; sections 2 and 4 only)
**Inputs reviewed:** explore notes, feature architecture diagram, issues jstoup111/ai-conductor#456 and #463, source (autoheal.ts, artifacts.ts, conductor.ts, rebase.ts, task-seed.ts, task-evidence.ts, task-cli.ts), daemon.log incident window
**Verdict:** APPROVED

## Feasibility

- Pure engine change in `src/conductor/src/engine/` — no new packages, services, schema, or
  infrastructure. Stack-compatible. (verified: all touched files read directly)
- Prerequisites: none beyond existing helpers; `originDefaultBranch()` already exists in
  `daemon-backlog.ts` (verified) — may need extraction to a shared module (mechanical).
- Integration surface: the completion-verdict seam only (build gate, auto-heal hook, post-rebase
  pre-verify). All three already funnel through `deriveCompletion`/`checkStepCompletion`
  (verified), so the unification is a narrowing, not new coupling.
- Data implications: `.pipeline/` sidecar semantics only — gitignored engine state, no committed
  data. Old sidecar files with `migrationGrandfather` remain loadable (field tolerated, inert).
- Worktree isolation: no new shared resources; all state stays per-worktree under `.pipeline/`.
- Performance: one extra `merge-base` subprocess per derivation in the fallback path — negligible
  against the git log walk already performed; the corrected range is dramatically SMALLER
  (~25 commits vs ~800), so corroboration work shrinks.

## Alignment

- **Deterministic-first (CLAUDE.md design principle):** the fix is pure machinery — range
  computation and gate resolution; no prompt discipline involved. Directly follows the precedent
  line (#426 engine-side path matching, #433 engine-stamped task ids).
- **Fail-closed convention:** every degenerate case (no merge-base, no remote, absent sidecar)
  resolves to "not completed" — consistent with the evidence gate's existing posture (H6/H7) and
  with the post-#444 pre-verify.
- **Default-branch discovery convention:** replaces hardcoded `origin/main` (getEvidenceRange ×2,
  listCommits) with the derived origin default branch — closes a documented convention violation
  in the same seam being touched.
- **Prior ADR check:** no APPROVED ADR mandates the genesis fallback or grandfathering as
  load-bearing behavior; both are implementation details of the 2026-07-07 cutover feature. The
  two new ADRs supersede nothing — they harden the same design's stated intent ("the gate never
  trusts task-status.json rows", artifacts.ts H6/H7 comment, verified).
- **Domain boundaries:** all changes inside the evidence-derivation module cluster; callers keep
  their signatures (deriveCompletion's optional anchorArg preserved for explicit callers).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Residual pre-cutover worktree loses grandfathered completions → tasks rebuilt | Data | Low | Low | Fail-closed by design; bounded re-work; none known in flight (2026-07-10) |
| Tests relying on genesis fallback / `-n 100 HEAD` window break | Technical | High | Low | Rewrite those tests with a real branch base (isolated repos, daemon:true where rebase-gated) |
| `merge-base --fork-point` fails in fresh daemon worktrees | Technical | Medium | Medium | Ladder rung 3: plain `merge-base`; covered by a dedicated negative-path test |
| In-flight features mid-build when this merges see range shrink | Integration | Low | Low | Range shrinks toward correctness; genuine commits stay in range |

## ADRs Created

- `adr-2026-07-10-evidence-range-anchor-resolution` — APPROVED
- `adr-2026-07-10-retire-migration-grandfather` — APPROVED

Both record operator direction (issues #456/#463 assigned and dispatched by the operator);
final human authority is the spec PR merge, which only the operator performs.

## Conditions

None. Stories must carry the adversarial/negative-path scenarios named in both ADRs
(foreign-history trailers, forged rows with absent sidecar, fork-point failure fallthrough,
gate/pre-verify verdict agreement).
