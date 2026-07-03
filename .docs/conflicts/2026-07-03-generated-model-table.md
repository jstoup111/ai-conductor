# Conflict Check: Generated HARNESS.md Model-Selection Table

**Date:** 2026-07-03
**Stories checked:** TS-1..TS-6 in `.docs/stories/generated-model-table.md` — pairwise, and
against all 33 existing story files + active specs.
**Result:** PASSED — zero blocking, zero degrading conflicts.

## Scan summary

- **Contradiction / state / resource / sequencing (internal TS-1..TS-6):** none. The one shared
  mutable resource (the HARNESS.md generated region) is written only by TS-2's write mode;
  TS-3's check mode is read-only by explicit criterion; human edits inside the region are
  *defined* as drift (TS-3) — that is the feature's contract, not a contention.
- **`fable-front-of-funnel-decide.md` + `fable-recovery-steps.md`:** both shipped (their table
  edits and the interim-fallback note are already in HARNESS.md) — treated as as-built. Their
  "keep the three sync points aligned by hand" criteria are subsumed, not contradicted, by
  TS-1..TS-6; their "rows byte-identical" criteria were scoped to *their* diffs, now historical.
  The interim-fallback note they introduced stays hand-authored **outside** the generated region
  (explicit TS-6 criterion), so regeneration cannot clobber it.
- **`harness-self-host-guardrails.md` (ReleaseArtifactGate runs the integrity suite on daemon
  self-builds):** interaction, not a conflict — a self-build that edits `resolved-config.ts`
  without regenerating the table will now fail the gate. That is the intended enforcement; the
  remediation command is printed in the failure (TS-3). Degradation (TS-5) only triggers on
  absent `node_modules`, so a sandboxed self-build with deps installed gets the full check.
- **Existing integrity checks 1–7:** additive only; check 5 (presence) explicitly retained
  (TS-5), check 1 (`bash -n` over `bin/`) automatically covers the new wrapper.
- **Future #186 fallback-ladder spec (not yet authored — no stories exist):** noted for
  sequencing awareness only. If #186 lands after this feature, its engine edits become
  single-file + regenerate (the payoff). If authored in parallel, the standard parallel-worktree
  CHANGELOG/rebase churn applies — no story-level contradiction to resolve today.

## Conflicts

None.
