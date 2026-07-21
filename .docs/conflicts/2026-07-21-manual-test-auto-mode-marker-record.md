# Conflict Check: manual_test auto-mode marker record

**Date:** 2026-07-21
**New stories:** `.docs/stories/manual-test-auto-mode-marker-record.md` (7 stories)
**Scanned against:** all `.docs/stories/`, with focus on the `manual_test`-adjacent set —
`manual-test-fail-routing.md` (#367), `parallel-validation-phase-fan-out-manual-test-prd-.md`,
`retry-log-lines-carry-the-completion-check-reason-.md`,
`add-a-judgement-gate-at-the-build-manual-test-seam.md` (#401),
`unify-build-completion-evidence-derivation-fix-der.md`.

**Verdict:** PASS — zero blocking conflicts. Two examined overlaps documented and accepted as
non-blocking (both reasoned compatible, not papered over).

---

## Overlap 1 (accepted, non-blocking): SKIP sentinel vs manual-test-fail-routing "auto-skip closed"

**Stories involved:** "completion predicate accepts a fresh SKIP sentinel as done" (new) vs
`manual-test-fail-routing` Story 1 negative "auto-skip closed" (#367).
**Type:** behavioral overlap · **Severity:** degrading → resolved to non-conflict.

**Description.** fail-routing #367 removed the advisory branch that silently *auto-skipped a
failing* manual_test after retries; manual_test is now `gating`, a failure HALTs, and the
recovery-menu `skip` is refused. Surface reading: "the new feature lets manual_test pass without
testing," which could look like reopening that closed door.

**Why it is not a conflict (verified in code, confidence ~90%):**
- The SKIP sentinel makes the completion predicate return `done: true` via *recorded, reasoned
  evidence*; it does **not** set the step's status to `skipped`. The only path to step-status
  `skipped` remains the explicit committed `steps.manual_test.disable` config key
  (`steps.ts:182-187`, `skippableForTiers: []`). Confirmed manual_test has no tier or
  feature-type auto-skip on `main`.
- The sentinel is valid only on a **no-FAIL** latest attempt (new whitewash-guard story), and a
  SKIP recorded after a FAIL without new commits still returns not-done. So it can never launder
  a failure — which is exactly what fail-routing's "auto-skip closed" protects against.
- fail-routing targets *skipping a failure*; this targets *completing a not-applicable* (no
  endpoint/UI stories), with the reason recorded. Different subjects.

**Resolution.** No story change to fail-routing. New Story 3 carries an explicit distinction
note (SKIP → `done`, never step-status `skipped`) so the boundary is legible to future readers.

**D5 addendum (S-tier skip):** Story 8 (D5) makes `manual_test` `skippableForTiers: ['S']`,
which DOES set step status `skipped` for S-tier features — but via the same deterministic,
pre-run selector tier-skip already used by `conflict_check`/`acceptance_specs` (both gating).
This still does not reopen fail-routing's "auto-skip closed": that rule removed the *advisory
silent skip of a FAILING manual_test after retries*; D5 is a pre-run complexity policy that
never changes enforcement (manual_test stays `gating` + in `ENFORCEMENT_LOCKED_STEPS`) and, at
M/L tier, a failing manual_test still HALTs. Examined-compatible, non-blocking.

---

## Overlap 2 (accepted, non-blocking, forward note): parallel-validation's assumed feature-type skip

**Stories involved:** "a no-endpoint/UI feature completes manual_test…" (new) vs
`parallel-validation-phase-fan-out` "Fan-out width respects existing skip rules" (its line ~78:
"technical track + S tier + no HTTP/UI stories" → all members skipped).
**Type:** overlap / potential future duplication · **Severity:** degrading (that spec is
unbuilt — no shipped-record).

**Description.** The parallel-validation spec *assumes* a manual_test "no HTTP/UI stories"
skip when composing the SHIP fan-out group. That skip does **not** exist on `main` (only
prd_audit's technical-track skip and architecture_review_as_built's S-tier skip do). This
feature supplies the actual mechanism for the no-endpoint case — but as *completion via SKIP
sentinel* (`done`), not as step-status `skipped`.

**Why it is not a blocking conflict:** parallel-validation is not built; nothing on `main`
depends on the assumed skip today. This feature does not remove or contradict any shipped
behavior it relies on.

**Resolution / forward note.** When parallel-validation is built, it MUST reconcile with this
feature on both axes:
- **S-tier case — now delivered by D5.** An S-tier feature's `manual_test` is a `skipped` group
  member (contributes no verdict) via `skippableForTiers: ['S']`. parallel-validation's assumed
  "S tier … → skipped" premise is satisfied by D5; it must NOT add a second S-tier skip path.
- **M/L no-endpoint case — delivered by the SKIP sentinel.** A non-trivial feature with no
  endpoint/UI stories reaches the group as a member that *completes via SKIP sentinel* (`done`,
  no FAIL verdict). Again, no second "feature-type skip" should be added.
Recorded here so that build does not create a duplicate skip path on either axis.

---

## Pairs examined and cleared (no interaction)

- **`retry-log-lines`** (Story 6 edits `buildRetryHint`, the retry *prompt* text): distinct from
  the retry-log-lines feature, which populates the `step_retry` *event* `reason` for the daemon
  `↻ retry` log line (`completion.reason`). Different surfaces; no shared code path changed.
- **`add-a-judgement-gate-at-the-build-manual-test-seam` (#401 build_review):** runs strictly
  between build and manual_test; does not read or write the manual_test completion marker. No
  interaction.
- **`unify-build-completion-evidence-derivation`:** scoped to the `build` step's evidence
  currency; this feature touches only `manual_test`. No interaction.
- **`manual-test-fail-routing` Story 3 (FAIL→build kickback) & Story 4 (whitewash):** this
  feature's Story 4 and Story 7 explicitly preserve both; the SKIP path is gated off the same
  no-FAIL condition. Compatible by construction.

## Conflict types coverage

Contradiction — none. Behavioral overlap — 2 (both resolved non-blocking, above). State
conflict — none (SKIP → `done` is distinct from step-status `skipped`; no impossible state).
Resource contention — none (results-file shape is preserved: append-an-attempt-section; SKIP
adds a recognized section, no schema break for the parallel-validation reader). Sequencing —
none.
