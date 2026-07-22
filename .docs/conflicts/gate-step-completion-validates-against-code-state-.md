# Conflict Check — Gate-step completion validates against code state (#817)

**Stem:** `gate-step-completion-validates-against-code-state-`
**Result:** PASS (no blocking conflict; three coexistence invariants recorded as build constraints)

Checked the stories against the existing gate/evidence machinery they touch or overlap. This change adds
a code-validity branch to four judged-gate completion predicates and gates one sweep. The risk surface is
**interaction with adjacent evidence-freshness mechanisms**, not contention between the stories
themselves (which are complementary facets of one predicate change).

## Adjacent mechanisms examined

| Mechanism | Location | Interaction | Verdict |
|---|---|---|---|
| Post-rebase delta-aware invalidation (ADR-2026-07-20) | `gate-invalidation.ts`, `conductor.ts:5148-5186`, `rebase.ts:780` | Reused (`GATE_SURFACE`, `partitionDelta`), different baseline (gate's `codeStamp` vs rebase pre-tree) | **Complementary** — see C1 |
| Verdict attempt-floor freshness (#649/#652, incident 2026-07-12) | `verdictFreshnessComparand`, `artifacts.ts:161-165` | Kept for the within-dispatch case; new check only governs cross-dispatch preservation | **No conflict** — see C2 |
| `wiring_check` HEAD anchor | `validateWiringEvidence`, `artifacts.ts:781` | Out of scope; used as precedent only | **No overlap** |
| `acceptance_specs` RED self-heal (#733) | `selfHealAcceptanceRed`, `conductor.ts:2841` | Out of scope; not mtime-gated | **No overlap** — see C3 |
| Per-task evidence ledger (demoted to telemetry, #773) | `task-evidence.ts`, `autoheal.ts` | Must not be revived; this is per-GATE-STEP, not per-task | **No revival** — see C4 |
| `task-status.json` build resume | `task-seed.ts`, `artifacts.ts:993` | Untouched | **No overlap** |
| SHA-orphan wedge (#766) | `EvidenceStamp.sha` | Design explicitly fails closed to re-run on unreachable baseline | **Guarded** — see C5 |

## Load-bearing coexistence invariants (build must honor)

**C1 — Rebase-path and re-dispatch-path preservation must not conflict or double-fire.** Both consult
`GATE_SURFACE`, but on different baselines: ADR-2026-07-20 invalidates during `performRebase`
(baseline = pre-rebase tree) and *writes* invalidation into gate verdicts; this change reads a verdict's
own `codeStamp` at *completion-check* time. A rebase that invalidates a gate leaves it non-`PASS` (or
re-stamps), so the re-dispatch check then correctly re-runs it. Constraint: the code-validity check must
read the verdict's **current** state (post any rebase invalidation), never a cached pre-rebase copy — so
the two mechanisms compose (rebase decides first, resume respects the result) rather than race.

**C2 — The mtime attempt-floor must remain the authority for within-dispatch judge rewrites.** The new
code-validity branch governs **only** whether a prior-session verdict is *preserved without re-running*.
Once a gate is re-run (surface changed / no stamp / invalidated), the per-attempt floor
(`verdictFreshnessComparand` + `VERDICT_FRESHNESS_FS_TOLERANCE_MS`) must still require a fresh verdict
this attempt. Constraint: do not remove or relax the attempt-floor; only add the preservation branch
ahead of the cross-dispatch (session-floor) rejection.

**C3 — `acceptance_specs` and `wiring_check` must be untouched.** `acceptance_specs` has no mtime guard
(its re-run is genuine RED-evidence absence, out of scope); `wiring_check` is already HEAD-anchored.
Constraint: the change adds `codeStamp` handling only to `build_review`, `prd_audit`,
`architecture_review_as_built`, `manual_test`; it must not add a stamp to or alter the other two.

**C4 — No revival of per-task evidence-ledger gating (#773).** The stamp is per-GATE-STEP (does *this
gate's* recorded verdict still hold for current code?), computed from a single HEAD baseline + a
`GATE_SURFACE` delta. Constraint: it must not read/require `task-evidence.json`, per-task corroboration,
or reachability of per-task stamps — those stay telemetry-only.

**C5 — Fail-closed on any unresolved anchor (#766).** An unreachable stamped baseline, an uncomputable
delta, or a missing stamp must yield re-run, never preserve and never wedge. Constraint: the validity
helper has exactly one "preserve" exit (reachable baseline + computable delta + surface miss); every
other path re-runs.

## No blocking conflicts

The stories do not contradict, overlap in ownership, or contend for the same state in a way that
requires resequencing. C1–C5 are coexistence constraints already reflected in the plan's task ordering
and verification (delta/fail-closed helper before predicate wiring; sweep gated on the same helper;
out-of-scope gates asserted unchanged).
