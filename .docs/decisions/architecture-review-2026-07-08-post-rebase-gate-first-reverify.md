# Architecture Review: Post-rebase gate-first re-verify (#420)

**Date:** 2026-07-08
**Mode:** Lightweight (tier M) — feasibility + alignment
**Input reviewed:** explore output + approved approach (`.memory` decision
2026-07-08-post-rebase-gate-first-reverify), architecture diagrams
`.docs/architecture/post-rebase-build-invalidation-dispatches-a-full-b.md` (+ sequence)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Seam exists and is clean (verified).** `applyRebaseVerdicts` (`rebase.ts:725-782`) is the
  single writer of rebase-invalidation verdicts; the `changed`-outcome branch (`:756-781`) is
  the exact insertion point. Its caller `runRebaseStep` (`conductor.ts:2859-2933`) has access to
  `this.completionCtx(state)` and `checkStepCompletion` — the same pair the post-step gate uses
  (`conductor.ts:1514-1558`) — so the pre-verify capability can be injected without `rebase.ts`
  importing `artifacts.ts`.
- **The mechanical check is trustworthy for `build` post-rebase (verified).** The build
  predicate re-derives from git evidence trailers on every evaluation (`artifacts.ts:651-688`,
  H7); `deriveCompletion`'s anchor is the repo **root commit** (`autoheal.ts:678-697`), not a
  pre-rebase sha, and rebase preserves commit messages (trailers), so the derivation range
  covers the replayed feature commits. Failure direction is safe: a derivation miss →
  invalidate → dispatch (today's behavior, no regression).
- **Non-daemon path unaffected (verified).** `runRebaseStep` forces a `noop` outcome when
  `!this.daemon` (`conductor.ts:2868-2875`); `noop` never reaches the invalidation branch.
- No new dependencies, schema, storage, or infrastructure. Worktree-isolation neutral (all
  writes stay under the feature worktree's `.pipeline/`).

## Alignment

- **Preserves the Phase 9.0 contract** (`.docs/specs/2026-06-25-phase-9.0-rebase-on-latest.md`
  FR-5/FR-6): invalidation still flows through the verdict/kickback machinery; only the set of
  gates *actually invalidated* becomes evidence-conditional for `build`. No parallel control
  flow (NFR "reuse over reinvention" upheld).
- **Corrects a flaw in the initially-approved shape.** "Pre-verify all candidate gates and let
  predicates decide" was falsified: `manual_test` (`artifacts.ts:831-906`, session-freshness +
  FAIL scan + whitewash marker) and `build_review` (artifact-presence glob) do **not** attest
  the rebased tree — a same-session pre-rebase artifact would falsely confirm. The design is
  narrowed: **pre-verify `build` only**; `build_review`/`manual_test` stay unconditionally
  invalidated. Eligibility bar recorded in the ADR (predicate must mechanically re-verify the
  current tree/history).
- **Oscillation guard:** pre-verify lives only inside the rebase invalidation path;
  `kickback.from !== 'rebase'` rework is structurally unreachable by it.
- **Anti-oscillation interplay:** a passing pre-verify *reduces* gate re-selections (build is
  never re-opened), so `MAX_GATE_SELECTIONS` pressure strictly decreases; no new HALT mode.
- Architecture diagrams updated in the same pass to show the build-only pre-verify.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Semantic conflict (clean rebase, broken code) no longer caught by the redundant build agent's suite run | Technical | Low | Medium | `manual_test` still re-runs; PR review + CI backstop (ship→CI kickback loop, spec #421); documented as accepted delta in the ADR; suite-run extension noted as future hardening |
| `advanceTail` resets `done→pending` for a hardcoded step list rather than the actual kicked-back set | Technical | Medium | Medium | Condition C1: reset must derive from `applyRebaseVerdicts`' returned `kickedBack` list — pin with a test that build stays `done` on a passing pre-verify |
| Pre-verify capability absent in some caller → silent behavior change | Technical | Low | Low | Absence fail-closes to today's unconditional invalidation; pinned by a unit test |
| Evidence trailers legitimately present but code overwritten by the rebase (task evidence stale w.r.t. final tree) | Data | Low | Medium | Same exposure exists today (post-dispatch gate passes on the same derive); path corroboration (`autoheal.ts:640`) already requires plan-path overlap |

## ADRs Created

- `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md` — DRAFT, presented for
  operator approval with this review.

## Conditions

- **C1:** `advanceTail`'s kickback re-emission and `done→pending` reset must operate on the
  `kickedBack` list returned by `applyRebaseVerdicts` (not a hardcoded
  `['build','build_review','manual_test']`), verified by a test where build passes pre-verify
  and retains `done` status.
- **C2:** The pre-verify confirm must WRITE a fresh objective verdict for build (new
  `checkedAt`, explicit reason) and emit a structured event — a silently-retained stale verdict
  is not acceptable evidence for forensics (same observability bar as #405's daemon.log gap).
- **C3:** `test/integration/rebase-loop.test.ts` must keep a case pinning `buildRuns === 2`
  when evidence is genuinely missing post-rebase, alongside the inverted evidence-intact case
  (`buildRuns === 1`).
