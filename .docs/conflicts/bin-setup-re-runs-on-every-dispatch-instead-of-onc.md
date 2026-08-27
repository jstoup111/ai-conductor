# Conflict Check: Setup once per worktree + per-dispatch lifecycle script (#1930)

**Date:** 2026-08-26
**Stories checked:** `.docs/stories/bin-setup-re-runs-on-every-dispatch-instead-of-onc.md` (Stories 1–4)
**ADR corpus:** `repo_wide` (config `conflict_check.adr_corpus: repo_wide`)
**Result:** PASSED — zero blocking, zero degrading conflicts

## Corpus

Examined: full `.docs/decisions/` sweep (~280 approved ADRs, delegated repo-wide pass during
architecture-review the same session) narrowed to ADRs whose subject overlaps setup/worktree
lifecycle, per-worktree state, rebase invalidation, events, and project scripts — principally:
adr-2026-07-09-setup-failure-triage, adr-2026-08-07-project-teardown-hook-contract-and-containment,
adr-2026-08-26-setup-once-per-worktree-marker, adr-2026-08-09-worktree-local-provider-scratch,
adr-2026-07-22-gate-evidence-code-validity-on-redispatch,
adr-2026-07-25-content-addressed-full-suite-proof,
adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch,
adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-08-03-uncommitted-work-floor,
adr-2026-08-05-build-settle-outcome-stamp. Narrowed-out: the remainder of the corpus (subjects —
build_review/rubrics, release/versioning, PR/labels, intake, coherence, provider routing,
self-host boundary, park machinery beyond `.daemon/` placement) — no shared behavior, entity,
field, or gate with these stories. Supersession parsing applied; no partially-superseded ADR in
the narrowed set was excluded.

## Pairs examined (both directions), no conflict

- **Story 1 (skip) vs Story 4 (triage verifies real setup):** the candidate oscillation of this
  design. Resolved structurally in the ADR: verification prepare passes `force: true`, so
  satisfying Story 1 does not break Story 4 and vice versa. Both directions hold.
- **Story 2 ("HEAD-only movement never invalidates") vs Story 2 ("base-moved re-runs"):**
  consistent — the identity input is the resolved base SHA, not HEAD.
- **Story 3 (`bin/dispatch-start` every dispatch) vs Story 1 (setup skipped):** distinct scripts,
  distinct cadence by design; no contention.
- **New stories vs `bin-teardown-…` Story 2 ("no persisted state"):** its assertions are
  teardown-scoped verbatim ("no **teardown-specific** marker or ledger", "no new file written at
  prepare time **to support teardown**"); the setup marker supports setup gating and the
  namespace remains a pure function of the path. The contract-level clause in
  adr-2026-08-07 was amended (2026-08-26 note) before these stories were written, so no
  opposing sentence pair exists. Not a conflict.
- **New stories vs `setup-before-dispatch-wedge-…` / `setup-triage-…` stories:** their criteria
  are conditional on setup running or failing ("whose `bin/setup` exits non-zero…", "exit 0 ⇒
  …") — none asserts that setup executes on every dispatch. Story 4's force path preserves the
  quarantine-retry and fix-session re-run behavior those stories pin. Not a conflict; no
  foreign-stem story edits needed.
- **New stories vs `reenable-bin-setup-worktree-smoke`:** the smoke provisions a fresh temp
  worktree (always cold start, no marker); unaffected.
- **New stories vs `auto-park-markers-…` (`.daemon/` placement):** same placement decision
  (adr-2026-08-09); different files, one writer each. No resource contention.

## Conflicts

None.
