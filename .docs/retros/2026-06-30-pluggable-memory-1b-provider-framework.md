# Retro — Pluggable Memory slice 1b (provider framework)

**Date:** 2026-06-30 · **Branch:** feat/pluggable-memory-1b-provider-framework · **HEAD:** c825da0
**Tier:** L (25 tasks, 7 batches) · **Autonomy:** Standard · **Merge-base:** c794f89

## Outcome

Full 25-task pipeline driven autonomously through TDD subagents + mandatory evaluator gates.
End state: full suite **2508/2508** (196 files), `tsc` clean, harness integrity **138/0** (2
pre-existing warnings), both SHIP gates PASS (prd-audit, architecture-review --as-built), code-review
gate satisfied. No concrete external provider ships — Phase-1 framework slice on landed 1a.

| Metric | Value |
|---|---|
| Tasks completed | 25 / 25 |
| Batches (evaluator-gated) | 5 of 7 had an evaluator (b1 fixture-only, b6 docs-only) |
| Rework cycles used | 10 |
| Evaluator REQUEST_CHANGES caught | batch 3, batch 4, batch 7 |
| Human interventions | 1 (VERSION decision at post-build checkpoint) |

## What the gates caught (the value)

The fresh-context evaluators caught four real gaps the green happy-path suites masked:
- **Batch 3 (security):** guidance path-containment — trailing-slash/sibling-prefix traversal.
- **Batch 4 (correctness):** fallback throw-safety + reconcile exactly-once + pending tag.
- **Batch 5 (test strength):** FR-3 no-retrieval was comment-enforced not structural; B22 leakage
  assertion was one-directional/trivially-true; B21 persist bypassed the resolver.
- **Batch 7 (integration, Opus):** **orphaned framework primitives** — `resolveMemoryGuidanceSkill`
  + the fallback trio shipped with zero live callers and no deferral marker, while docs implied
  they were live. This is the orphaned-primitive class (5th recurrence here). The Opus final
  evaluator ruled `needs-greppable-deferral-marker`, NOT live-wiring — sometimes the orphan is
  correct, but it must be honest. Fixed non-behaviorally (`c825da0`): `TODO(phase-2-wiring)` markers
  + framework-only doc caveats.

## Lessons (carry-forward)

1. **The legitimate-deferral variant of orphaned primitives.** A framework slice intentionally ships
   primitives ahead of wiring. The final gate is now: *new symbol has a non-test caller OR a greppable
   deferral marker AND docs that don't claim it's live.* The "asymmetry tell" — one sibling deferral
   marked (`memory-adopt`'s `TODO(phase-2-providers)`), the parallel one silent — flagged the oversight.
   (Already folded into the `feedback-orphaned-primitives` memory as the 5th recurrence.)
2. **Adversarial-derivation coverage keeps paying.** Each REQUEST_CHANGES traced to a derivation tested
   on clean/injected input but never at the real adversarial call-site shape (path guard, throw path,
   resolver-chained persist). Per-call-site negative specs remain the highest-yield gate input.
3. **Docs are part of the artifact.** prd-audit found a cosmetic export-name drift in the conductor
   README (`adoptProvider`/`removeProvider` → actual `memoryAdd`/`memoryRemove`/`memoryStatus`); fixed
   this session. The "docs-track-features" gate should grep doc-referenced export names against actual
   exports, not just check that a doc section exists.

## Process notes

- Pipeline entry-guard early-exited cleanly on a `/pipeline` re-invoke against the fully-completed
  task list — no wasted plan-load/evaluator dispatch. The guard works as intended.
- Standard autonomy with batch-boundary evaluators + a real-binary smoke at manual-test was the right
  weight for an internal-CLI + framework slice. Manual-test correctly auto-skipped (no endpoints) but
  the `memory status` / `memory add` smoke confirmed the atomic-refuse security invariant in the REAL
  binary, not just stubs — exactly the real-binary-smoke discipline for external-CLI adapters.

## Open items for Phase 2 (provider wiring)

- Wire `resolveSkill` → `resolveMemoryGuidanceSkill` and the memory-recording path → `persistMemory`
  + `reconcilePending` on reconnect, when the first concrete provider registers.
- Land the ADR-1 follow-up: a grep-based integrity check asserting no harness-side memory retrieval.
- Revisit the reconcile at-least-once floor (single-ledger, no provider idempotency key) with the
  first real provider.
