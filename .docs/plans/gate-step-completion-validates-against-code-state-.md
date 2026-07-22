# Implementation Plan: Gate-step completion validates against code state, not evidence timestamp

**Source:** jstoup111/ai-conductor#817
**Track:** Technical • **Tier:** Medium
**Stories:** `.docs/stories/gate-step-completion-validates-against-code-state-.md`
**ADR:** `.docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md`

Generalize the post-rebase delta-aware gate preservation (ADR-2026-07-20's `GATE_SURFACE` +
`partitionDelta`) to the re-dispatch/resume path. Stamp each in-scope judged verdict with its code
baseline; on completion check, preserve a `PASS` verdict whose surface is unchanged, fail-closed to
re-run otherwise. In scope: `build_review`, `prd_audit`, `architecture_review_as_built`, `manual_test`.
Out of scope and MUST stay byte-identical: `wiring_check`, `acceptance_specs`, `task-status.json` resume,
the per-task evidence ledger (#773), and the rebase-path invalidation itself (reused, not modified).
Honor coexistence invariants C1–C5 in `.docs/conflicts/`.

## Task Dependency Graph

```
T1 (codeStamp type + write helper)  ─┐
T2 (gate-code-validity helper: reachable? + delta + GATE_SURFACE miss, fail-closed) ← needs T1
        │
        ▼
T3 (stamp on verdict write: build_review) ← needs T1
T4 (stamp on verdict write: prd_audit / arch_review_as_built / manual_test) ← needs T1
        │
        ▼
T5 (wire validity branch into build_review predicate) ← needs T2,T3
T6 (wire validity branch into prd_audit / arch_review_as_built / manual_test predicates) ← needs T2,T4
T7 (gate sweepStaleReviewArtifacts on the validity helper) ← needs T2
        │
        ▼
T8 (config kill-switch, default new behavior) ← needs T5,T6,T7
        │
        ▼
T9 (unit tests: validity helper — reachable/orphan/uncomputable/surface hit-miss) ← needs T2
T10 (acceptance: preserve-on-unchanged + re-run-on-surface-change across re-dispatch) ← needs T5,T6
T11 (acceptance: fail-closed missing/orphaned stamp; kickback invalidates; no-op kickback preserves) ← needs T5,T6
T12 (acceptance: sweep spares valid / deletes invalid; attempt-floor intact on re-run) ← needs T6,T7
T13 (regression: wiring_check / acceptance_specs / task-status.json unchanged) ← needs T5,T6
        │
        ▼
T14 (docs: CHANGELOG [Unreleased] + README + src/conductor/README) ← needs T8
T15 (typecheck + full src/conductor suite green) ← needs all
T16 (repo integrity suite: test/test_harness_integrity.sh) ← needs T14,T15
```

---

## T1 — Add the `codeStamp` shape + a write helper
Define an additive `codeStamp` field (the HEAD SHA a verdict was formed against) and a small helper that
returns the current HEAD SHA for stamping (null when non-git). Reuse the existing HEAD-read used by
`wiring_check` / `CompletionContext.getHeadSha` rather than introducing a new git call site.
- **Files:** `src/conductor/src/engine/artifacts.ts` (verdict interfaces + a `stampCode(ctx)` helper)
- **Dependencies:** none
- **Verify:** `BuildReviewVerdict` (and the other three evidence shapes) accept an optional `codeStamp`;
  typecheck passes; non-git path yields no stamp.

## T2 — Add the `gate-code-validity` helper (the preserve decision)
Add a shared helper `gateVerdictStillValid(ctx, gate, codeStamp)` that returns `preserve | rerun`:
(1) if `codeStamp` absent → `rerun`; (2) resolve the baseline, if unreachable in history → `rerun`
(#766); (3) compute `git diff --name-only baseline..HEAD` filtered by the existing code/test path
predicates, if uncomputable → `rerun`; (4) `partitionDelta` by the gate's `GATE_SURFACE` kind — surface
**miss** → `preserve`, surface **hit** → `rerun`. Exactly one `preserve` exit (invariant C5). Reuse
`GATE_SURFACE`, `partitionDelta`, and the path predicates from `gate-invalidation.ts`/`rebase.ts`.
- **Files:** new `src/conductor/src/engine/gate-code-validity.ts` (or a section of `gate-invalidation.ts`);
  imports from `gate-invalidation.ts`
- **Dependencies:** T1
- **Verify:** unit-level truth table (T9) — reachable+miss→preserve; reachable+hit→rerun;
  orphan→rerun; uncomputable→rerun; no-stamp→rerun.

## T3 — Stamp `build_review` verdicts on write
At the point `build-review.json` is written (judge dispatch), attach `codeStamp = stampCode(ctx)`. Do not
change the PASS/FAIL/rubric shape or `validateBuildReviewVerdict`'s fail-closed parse (an absent stamp
still parses).
- **Files:** `src/conductor/src/engine/artifacts.ts` (+ the build_review verdict writer / step runner)
- **Dependencies:** T1
- **Verify:** a freshly written `build-review.json` carries `codeStamp` = current HEAD; parse of a
  stamp-less legacy file still succeeds.

## T4 — Stamp `prd_audit` / `architecture_review_as_built` / `manual_test` verdicts on write
Same additive stamp at each of those three write points. `manual_test` already records a `headSha` FAIL
marker — add `codeStamp` without disturbing that marker.
- **Files:** `src/conductor/src/engine/artifacts.ts` (+ the respective writers)
- **Dependencies:** T1
- **Verify:** each artifact carries `codeStamp`; the `manual_test` FAIL→PASS `headSha` guard is unchanged.

## T5 — Wire the validity branch into the `build_review` predicate
In `build_review`'s completion predicate (`artifacts.ts:1442`), before the mtime rejection: if a valid
`PASS` verdict has a `codeStamp` and `gateVerdictStillValid(...) === preserve` → return `done` without
re-run. Otherwise fall through to today's mtime behavior (invariant C2). Kill-switch off → skip the
branch entirely.
- **Files:** `src/conductor/src/engine/artifacts.ts`
- **Dependencies:** T2, T3
- **Verify:** T10/T11 acceptance; mtime-predates-floor alone no longer forces a re-run when surface is
  unchanged.

## T6 — Wire the validity branch into the three remaining in-scope predicates
Same branch in `prd_audit` (`:1325`), `architecture_review_as_built` (`:1381`), and `manual_test`
(`~:1230`). Use each gate's own `GATE_SURFACE` kind. Do NOT touch `wiring_check` or `acceptance_specs`
(invariant C3).
- **Files:** `src/conductor/src/engine/artifacts.ts`
- **Dependencies:** T2, T4
- **Verify:** T10/T11; regression T13 shows the two out-of-scope gates unchanged.

## T7 — Gate `sweepStaleReviewArtifacts` on the validity helper
Before deleting a swept step's prior-session artifact (`STALE_SWEEP_STEPS`), consult
`gateVerdictStillValid`; a still-valid verdict is spared so the completion check can preserve it
(Story 7 / invariant C5). Invalid/absent-stamp verdicts are deleted as today.
- **Files:** `src/conductor/src/engine/artifacts.ts` (`sweepStaleReviewArtifacts`, callers
  `conductor.ts:2730`, `group-core.ts:408`)
- **Dependencies:** T2
- **Verify:** T12 — sweep spares a valid verdict, still deletes an invalid one.

## T8 — Additive config kill-switch
Add an additive, defaulted-on flag (e.g. `build_review.reuseValidVerdictOnRedispatch` or a shared
`gates.codeValidityReuse`) that, when off, restores pure mtime-freshness (no stamp read/preserve). Thread
it through `CompletionContext`/config as the existing gate flags are.
- **Files:** config schema + `resolved-config.ts` + `artifacts.ts` reads
- **Dependencies:** T5, T6, T7
- **Verify:** flag off ⇒ behavior byte-identical to pre-change (mtime governs); flag on (default) ⇒
  preservation active.

## T9 — Unit tests for the validity helper
Truth table for `gateVerdictStillValid`: reachable+surface-miss→preserve; reachable+surface-hit→rerun;
unreachable baseline→rerun; uncomputable delta→rerun; no stamp→rerun. Per `GATE_SURFACE` kind
(`any-codetest`, `all-runtime`, `feature-runtime`).
- **Files:** `src/conductor/test/engine/gate-code-validity.test.ts`
- **Dependencies:** T2
- **Verify:** all cases pass; fail-closed paths asserted explicitly.

## T10 — Acceptance: preserve-on-unchanged, re-run-on-surface-change (re-dispatch)
Drive a real re-dispatch (fresh `session_started_at`) with a stamped `PASS` verdict: (a) surface
unchanged → step `done`, no judge dispatch; (b) surface changed → re-run. Cover `build_review` +
one `feature-runtime` gate.
- **Files:** `src/conductor/test/engine/...redispatch-gate-validity.acceptance.test.ts`
- **Dependencies:** T5, T6
- **Verify:** (a) no re-run despite older mtime; (b) re-run on feature-surface change.

## T11 — Acceptance: fail-closed + kickback semantics
Assert: missing stamp → re-run; orphaned baseline (rebase/reset) → re-run, no wedge/halt; uncomputable
delta → re-run; kickback changing surface → invalidates; no-op kickback (docs-only) → preserved.
- **Files:** same acceptance suite as T10
- **Dependencies:** T5, T6
- **Verify:** each direction proven; no "uncreditable-undemotable" state produced.

## T12 — Acceptance: sweep + attempt-floor interplay
Assert: `sweepStaleReviewArtifacts` spares a valid swept-step verdict and deletes an invalid one; when a
gate DOES re-run, the per-attempt floor still scores a non-rewritten verdict "no fresh verdict"
(incident-2026-07-12 guard intact, invariant C2).
- **Files:** same acceptance suite / `artifacts` sweep test
- **Dependencies:** T6, T7
- **Verify:** sweep behavior both directions; attempt-floor regression green.

## T13 — Regression: out-of-scope gates + task resume unchanged
Assert `wiring_check` (HEAD-anchored preserve), `acceptance_specs` (content-validate + RED self-heal),
and `task-status.json` build resume are byte-identical to pre-change.
- **Files:** existing suites for those gates (extend/assert)
- **Dependencies:** T5, T6
- **Verify:** no diff in their observable behavior; existing tests green.

## T14 — Docs
CHANGELOG `[Unreleased]` (Changed/Fixed): gate steps resume-preserve on unchanged code instead of
re-running by timestamp. Update `README.md` and `src/conductor/README.md` gate/resume sections.
- **Files:** `CHANGELOG.md`, `README.md`, `src/conductor/README.md`
- **Dependencies:** T8
- **Verify:** `[Unreleased]` non-empty; READMEs describe the code-validity resume behavior.
- **Note:** internal-behavior change; if the self-host release gate flags a breaking surface, a
  `.docs/release-waivers/` waiver (internal-only) is the correct discharge — no consumer CLI/hook/schema
  behavior changes (the config flag is additive). Assess at build time.

## T15 — Typecheck + full suite green
- **Files:** —
- **Dependencies:** all
- **Verify:** `src/conductor` typecheck + full vitest suite pass.

## T16 — Repo integrity suite
- **Files:** —
- **Dependencies:** T14, T15
- **Verify:** `test/test_harness_integrity.sh` passes (SKILL frontmatter, model table, CHANGELOG
  `[Unreleased]`, VERSION semver).
