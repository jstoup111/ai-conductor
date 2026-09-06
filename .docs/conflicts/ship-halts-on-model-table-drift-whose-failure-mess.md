# Conflict Check: Bounded mechanical remediation in the self-host release gate

**Date:** 2026-09-06
**Stories checked:** `.docs/stories/ship-halts-on-model-table-drift-whose-failure-mess.md` (Stories 1–4) against every file in `.docs/stories/`
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml`)
**Result:** 1 degrading conflict, resolved; 0 blocking

## ADR corpus

**Examined (subject overlaps the stories):** adr-2026-06-30-halt-based-release-gates (amended 2026-09-06 by this spec),
adr-2026-07-06-migration-gate-waiver, adr-005-non-autonomy-and-read-only-governor,
adr-2026-06-30-self-host-detection-seam, adr-2026-08-17-structural-live-checkout-containment,
adr-2026-07-03-generated-model-table-single-source, adr-2026-07-22-phase-scoped-docs-write-guard,
adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts,
adr-2026-08-02-plan-scope-containment-at-commit-boundary, adr-2026-08-23-committed-halt-record,
adr-2026-07-28-total-halt-classification-legacy-boundary,
adr-2026-07-08-post-rebase-gate-first-mechanical-reverify,
adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch, adr-2026-07-13-retry-classify-rerun-vs-route,
adr-2026-07-05-retry-as-escalation-ladder, adr-2026-08-19-unretryable-step-runner-failures-route-by-kind,
adr-2026-07-23-session-hook-repair-before-halt, adr-2026-07-10-daemon-stall-remediation,
adr-2026-08-11-halt-events-ride-the-persisted-spine, adr-2026-07-26-event-sink-registry-exhaustiveness,
adr-2026-08-09-reseal-audit-rides-the-existing-event-spine, adr-2026-07-07-audit-trail-event-sink,
adr-2026-08-03-uncommitted-work-floor-under-build-completion, adr-2026-08-03-fail-closed-decide-entry,
adr-2026-07-03-version-gate-semver-escalation, adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity,
adr-2026-08-09-conductor-block-single-source-of-truth, adr-2026-07-23-commit-movement-liveness-floor.

**Narrowed out:** the remaining approved ADRs in `.docs/decisions/` (memory providers, intake and
claim, PR labelling, cost rollups, build_review rubrics, provider auth, migrations, UI) — none
addresses the release gate, the integrity suite, engine commits, halt classes, or the event spine.
No examined ADR was excluded on supersession grounds; adr-2026-06-30 is retained with its
2026-09-06 amendment, which is the decision the stories implement.

**ADR-versus-story result:** no conflict. The only opposing sentence in the corpus —
adr-2026-06-30's "Every self-host guardrail that cannot self-satisfy calls the existing `writeHalt()`
… it never prompts and never proceeds" — was reconciled by the additive amendment recorded during
architecture review before these stories were written, and the amended text is what Stories 2 and 3
assert. adr-2026-08-19 D3 ("the re-check reads; it never writes") governs the dispatch-boundary
tree-attesting re-check, of which this gate is not a member; the review records the bounded
departure. Both directions of the oscillation heuristic were run on every examined pair.

## Conflict: An earlier story asserts every non-zero integrity exit halts

**Stories involved:** Story 2 (The release gate self-heals an allowlisted mechanical failure once) vs "HALT when the integrity suite fails on a self-build"
**Files:** `.docs/stories/ship-halts-on-model-table-drift-whose-failure-mess.md` vs `.docs/stories/harness-self-host-guardrails.md`
**Type:** contradiction
**Severity:** degrading

**Story opposing sentence (verbatim, harness-self-host-guardrails):** "Given the integrity script exits non-zero, when the gate runs, then it calls `writeHalt()` with a reason naming "harness integrity suite failed" (and, when the script surfaces them, the failing check) and the PR is NOT opened."
**Story opposing sentence (verbatim, Story 2):** "Given the suite fails with one deterministic record naming `bin/generate-model-table`, when the release gate runs, then it runs that command from the worktree root, commits the regenerated HARNESS.md as an engine commit, re-runs the suite exactly once, and returns ok when the re-run exits 0"

**Description:** The 2026-06-30 story makes every non-zero exit a HALT. Story 2 makes one class of
non-zero exit — every failed check declared an allowlisted deterministic remediation — pass after a
successful remediation and re-run. Satisfying Story 2 breaks the older negative path; satisfying the
older negative path forbids Story 2. It is a plain contradiction, not an oscillation: the older story
predates the amended ADR and simply states the pre-amendment rule.

**Resolution Options:**
1. Replace the older story's negative-path sentence in place so it reads "exits non-zero and the
   failure is not mechanically remediable (see Story 2 of ship-halts-on-model-table-drift-whose-failure-mess)",
   and narrow its Done-When line the same way.
2. Leave both stories as written and rely on the amended ADR to arbitrate.
3. Delete the older story's negative path.

**Recommendation:** Option 1. It preserves the older story's fail-closed intent (a *real* regression
still halts) and records the one carve-out the amended ADR now permits.

**Applied resolution:** Option 1, via a companion PR. This spec's land gate rejects edits to a
story file whose stem is not this feature's, so the in-place replacement in
`.docs/stories/harness-self-host-guardrails.md` ships as a separate main-based PR alongside the
spec PR (the established recipe for foreign-stem story replacements). The replacement text:

- Given the integrity script exits non-zero and the failure is not mechanically remediable under the bounded remediation lane, when the gate runs, then it calls `writeHalt()` with a reason naming "harness integrity suite failed" (and, when the script surfaces them, the failing check) and the PR is NOT opened.
- Done When: Non-zero exit that is not mechanically remediable → `writeHalt()` naming the failing gate; no PR.

Until that companion PR merges, the conflict is degrading, not blocking: the amended
adr-2026-06-30 is the governing decision and BUILD implements Story 2 against it.

## Pairs examined clean

- Story 2 vs `a-halted-feature-only-re-runs-when-a-human-clears-` Story 2 (bounded infrastructure
  retry inside `test_suite`, halts `needs-human` on exhaustion): same shape, different step; no shared
  gate or counter. Both directions hold.
- Story 3 vs `a-halt-leaves-no-committed-pushed-record-for-the-o`: a `needs-human` halt commits a
  halt record; the self-heal's own engine commit precedes it and a later byte-identical halt is
  deduplicated. Both directions hold.
- Story 1 vs `generated-model-table` "Check mode detects table drift" (`--check` leaves HARNESS.md
  byte-identical): the remediation lane runs the write mode, never `--check`; the suite's own
  `--check` call is unchanged. Both directions hold.
- Story 2 vs `self-host-release-gate-bin-conduct-breaking-surfac` (migration sub-gate): the
  remediation commit touches HARNESS.md and `hooks/claude/docs-guard.sh`; the latter is on the
  `hook wiring` breaking surface, so Story 2's third happy-path criterion (migration sub-gate sees the
  remediation commit) is what keeps that gate honest rather than conflicting with it.
- Story 4 vs `daemon-dispatched-builds-emit-no-otel-telemetry-th`: new events persist to the spine;
  OTel export is a separate subscriber list and out of this scope.
- Stories 1–4 pairwise: Story 1 produces the records Stories 2–3 consume; Story 3's declined paths
  are the complement of Story 2's accepted path; Story 4 observes both. No pair contends for a
  resource or assumes a different ordering.
