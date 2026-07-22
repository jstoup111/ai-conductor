# ADR: Judged-gate evidence is preserved on re-dispatch by code-state validity, not timestamp freshness

**Date:** 2026-07-22
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #817), operator-directed
**Relates to:** `adr-2026-07-20-post-rebase-delta-aware-invalidation.md` (reuses its `GATE_SURFACE` +
`partitionDelta` machinery and its fail-closed-on-uncomputable stance; extends the *same* delta-aware
preservation principle from the rebase path to the re-dispatch/resume path) and
`adr-2026-07-12-wiring-check-gate.md` (adopts its HEAD-anchored evidence model as the precedent for the
other judged gates)
**Guards against:** #766 (`sidecar-stamp-reachability`) SHA-orphan wedge; #773 per-task evidence-ledger
gating (this is per-GATE-STEP, not per-task)

## Context

Issue #817. Every daemon re-dispatch of a feature re-runs **completed** judged gate steps
(`build_review` ~17 min, `prd_audit`, `architecture_review_as_built`, `manual_test`) from scratch, even
when the code is byte-identical to what the gate already passed against.

**Verified mechanism.** `Conductor.run()` unconditionally re-stamps the freshness floor on every entry
(`conductor.ts:1578-1581`: `state.session_started_at = Date.now()`). The judged-gate completion
predicates in `artifacts.ts` reject a recorded verdict whose file mtime predates that floor
(`verdictFreshnessComparand`, `artifacts.ts:161-165`, via `fileIsFreshSinceSession` `:108-119`), and
`sweepStaleReviewArtifacts` (`:338-355`) deletes prior-session evidence for
`{manual_test, prd_audit, architecture_review_as_built}` on failed/kickback re-entry. So a resume moves
the floor forward and every prior-session `PASS` verdict is scored stale and re-run — invalidated by
**wall-clock time**, not by any code change.

**Verified scope corrections (reshape the fix).**
- `wiring_check` is **already** code-anchored: it validates `wiring-evidence.json.head` against the
  current HEAD (`validateWiringEvidence`, `artifacts.ts:781-786`) and preserves the evidence when HEAD
  is unchanged. It is the **precedent**, not a victim — untouched here.
- `acceptance_specs` has **no** mtime freshness guard (`artifacts.ts:1163-1195`); its observed re-run is
  genuine RED-evidence *absence* healed by `selfHealAcceptanceRed` (#733) — a separate
  evidence-durability problem (cf. #497), out of scope for this ADR.

The in-scope gates (`build_review`, `prd_audit`, `architecture_review_as_built`, `manual_test`) are
exactly those declared in `GATE_SURFACE` (`gate-invalidation.ts:44-53`) — the map ADR-2026-07-20 already
uses to decide, on the rebase path, whether a code delta touches a gate's surface. That mechanism is not
wired into the re-dispatch path.

## Decision

**Preserve a judged-gate verdict across re-dispatch when, and only when, the code under that gate's
declared surface is unchanged since the verdict was recorded — reusing `GATE_SURFACE` + `partitionDelta`.
Replace the cross-dispatch mtime-freshness rejection with this code-validity check; keep the
within-dispatch mtime attempt-floor unchanged.**

1. **Stamp.** When a judged-gate verdict artifact is written (at judge dispatch), record a `codeStamp`
   = the current HEAD SHA the verdict was formed against, as an additive field on the verdict JSON
   (`build-review.json` etc.). This mirrors `wiring_check`'s `evidence.head` and the `manual_test`
   `headSha` marker.

2. **Validate on completion check (re-dispatch).** In each in-scope verdict predicate, before the
   existing mtime rejection: if a valid `PASS` verdict carries a `codeStamp`, run a shared
   `gate-code-validity` helper that
   - resolves the stamped baseline; if it is **unreachable** in history (rebase/reset-orphaned) → the
     verdict is **not** preserved (re-run). *(This is the #766 fail-closed stance — never wedge on an
     orphaned anchor.)*
   - computes the delta `baseline..HEAD`; if the delta is **uncomputable** → re-run (mirrors
     ADR-2026-07-20's invalidate-all-on-uncomputable).
   - partitions the delta by the gate's `GATE_SURFACE` kind (`partitionDelta`); if the delta **misses**
     the gate's surface → **preserve** the verdict (step is `done`, no re-run); if it **hits** the
     surface → re-run.

3. **Legacy / opt-out fallback.** A verdict with **no** `codeStamp` (authored before this change, or the
   kill-switch is off) falls back to today's mtime-freshness behavior — i.e. re-run on resume. Fail-safe:
   the change never makes an un-stamped verdict *more* trusted than today.

4. **Sweep coupling.** `sweepStaleReviewArtifacts` gates its delete on the same validity helper, so a
   still-valid prior-session verdict is not deleted before the completion check can preserve it.

5. **Within-dispatch freshness preserved.** When a gate *is* re-run (surface changed, no stamp, or
   invalidated), the existing per-attempt floor (`verdictFreshnessComparand`, tolerance
   `VERDICT_FRESHNESS_FS_TOLERANCE_MS`) still requires the judge to write a fresh verdict *this* attempt
   — the guard for a judge that declines to rewrite (incident 2026-07-12-wiring-reachability-gate) is
   untouched.

6. **Kill-switch.** An additive config flag reverts to pure mtime-freshness (no stamp read/preserve),
   defaulting to the new behavior.

## Alternatives considered

- **Raw HEAD tree-hash equality** (preserve only if the whole tree is byte-identical). Rejected — a
  foreign/test-only change between dispatches would re-run *every* gate, discarding most of the benefit;
  `GATE_SURFACE` exists precisely so a gate re-runs only for *its* surface.
- **Suppress the `session_started_at` reset on resume when nothing changed.** Rejected — one global floor
  is the wrong granularity; a change under one gate's surface must not force unrelated gates to re-run,
  and "nothing changed" is itself the per-surface question this ADR answers.
- **Exact-SHA pin** (preserve iff the verdict's commit SHA equals current HEAD). Rejected — revives the
  #766 orphan wedge and re-runs everything after any commit, even a docs-only one.

## Consequences

- **Positive:** a resume/re-dispatch with unchanged code skips the judged tail it already passed (the
  ~17 min `build_review`, etc.); halt→re-dispatch churn stops re-paying completed gate work; the fix is
  deterministic and reuses existing, already-reviewed machinery (Design Principle).
- **Preserved invariants:** fail-closed (missing/unreachable/uncomputable → re-run); no stale/forged
  verdict can satisfy a gate; the within-dispatch attempt-floor; `wiring_check`; `task-status.json`
  build resume; the rebase-path invalidation (complementary — different baseline, same `GATE_SURFACE`).
- **Negative / watch:** adds an additive field to verdict artifacts and a git delta computation on the
  resume completion path (cheap: `git diff --name-only baseline..HEAD`, already used on the rebase path).
  A verdict `PASS` recorded against a genuinely-unchanged-but-wrong build is preserved exactly as long as
  it is today within a session — this ADR changes *when* a valid verdict is discarded, not the grader's
  correctness.
- **Out of scope (separate intake):** `acceptance_specs` RED-evidence durability on resume; any change
  to the grader's PASS/FAIL judgment.
