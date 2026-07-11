# ADR: Verdict-Aware Resume Entry (Backward-Only Clamp)

**Date:** 2026-07-11
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for #532

## Context

`conductor.run()` with `resume: true` derives its starting step from `findResumeIndex`, which is
**state-only**: it returns the first `in_progress` step, else the step after the last `done` step
in `conduct-state.json`. The pre-dispatch `checkGate` is also state-only (`stepSatisfied`).
Persisted gate verdicts (`.pipeline/gates/*.json`) are consulted only **after** a step succeeds,
in `advanceTail` (`readAllVerdicts` + `selectNextGate`).

Issue #532 (critical, observed live during the #520 build): after an operator HALT-clear + REKICK,
the pre-loop NOOP rebase correctly wrote `rebase.json satisfied:true` and stamped
`state.rebase='done'` (the #436/#516 shared helper). With `state.build='failed'` and
`build.json satisfied:false` still on disk, the state-only walk computed lastDone=`rebase` →
resume at `finish`. `checkGate(finish)` passed (its only prerequisite is `rebase`). The engine
dispatched `finish` for a build it had itself judged incomplete (7/26 tasks) — a direct false-ship
path stopped only by an operator kill. The gate-verdict layer exists precisely so the loop does
not trust state/agent claims; the resume entry was the one path that ignored it.

Constraints:
- `gateSatisfied`/`selectNextGate` (`selector.ts`) are the existing, tested, verdict-authoritative
  selection machinery used by the loop tail — verdict wins over state; `stale` is never satisfied;
  absent verdict falls back to `done`/`skipped` state. A second authority must not be invented.
- The resume seam is shared: daemon rekick (`daemon-cli.ts` → `conductor.run({resume:true})`) and
  operator CLI `--resume` both flow through the same startIndex derivation.
- A resume with all verdicts satisfied must still fast-forward (daemon re-dispatch relies on this;
  regressing to top-of-list re-runs is a known prior failure class).

## Options Considered

### Option A: Verdict-aware resume entry — clamp the state-derived index backward (CHOSEN)
- At resume entry, after computing the state-only candidate index, read `readAllVerdicts` and
  evaluate `gateSatisfied` over the verdict-bearing (loop-region) steps; if the earliest
  unsatisfied gate sits **before** the candidate, clamp the start index back to it.
- **Pros:** single choke point at the seam both callers share; reuses the loop tail's own selector
  semantics (one authority); covers both `findResumeIndex` branches — the lastDone+1 walk AND the
  first-`in_progress` branch (the #532 post-kill state had `finish: in_progress`, so a second
  resume would have re-dispatched finish); deterministic machinery, no prompt discipline.
- **Cons:** the resume entry becomes async (verdict file reads) and needs the derived topology;
  negative-path regression risk (all-satisfied fast-forward) must be pinned by tests.

### Option B: Verdict-aware `checkGate` (filer hypothesis b)
- **Rejected — verified broken as stated:** `finish`'s only prerequisite is `rebase`
  (`steps.ts`), and `rebase.json` was correctly `satisfied:true` in the incident. Prereq-level
  verdict checks cannot block this failure mode without transitively expanding the prerequisite
  graph — a much larger blast radius for no added authority.

### Option C: Reconcile state from verdicts before indexing
- Demote any loop-region step whose verdict is unsatisfied to `stale`, then let the state-only
  index land correctly.
- **Rejected:** side-effectful read (resume mutates state), reconciliation-by-copy keeps two
  authorities, and it risks fighting `scanKickbackVerdicts`, which already owns
  verdict-driven state demotion inside the loop.

### Option D: Conditional rebase stamp (filer hypothesis c)
- **Rejected:** fixes only this trigger; the resume index stays verdict-blind (desired outcome 2
  unmet in general); re-opens the #436/#516 conditional-recording drift family that
  `recordRebaseStepCompletion` exists to close.

## Decision

Adopt **Option A**. On `resume: true`, the start index is
`min(stateDerivedIndex, index of earliest verdict-unsatisfied loop-region gate)` — a
**backward-only clamp** computed with the existing `gateSatisfied` semantics fed by
`readAllVerdicts`, scoped to steps at or after the derived `regionStart`
(`deriveGateTopology`). Specifics:

1. **Backward-only.** The clamp may only lower the start index, never raise it. A pending
   not-yet-reached gate ahead of the candidate (e.g. `stories` while resuming a front-half step)
   must not drag the entry forward — forward selection remains the loop tail's job.
2. **Both branches covered.** The clamp applies to the final resume index regardless of which
   `findResumeIndex` branch produced it (`in_progress` hit or lastDone+1 walk).
3. **`--from-step` is exempt.** An explicitly targeted step (`fromStep`) is an operator override;
   the clamp applies only to the `resume` derivation. (The daemon no longer uses `fromStep` for
   re-dispatch.)
4. **`checkGate` unchanged.** Prerequisite checking stays state-only; the authority for "is this
   gate actually satisfied" is the verdict layer, applied at entry (this ADR) and in the loop tail
   (existing `advanceTail`/`selectNextGate`).
5. **One authority.** No new satisfaction predicate is introduced; the clamp calls the same
   `gateSatisfied` used by `selectNextGate`, so entry and tail can never disagree on semantics.

## Consequences

### Positive
- The #532 pre-kill state (`build.json` unsatisfied, `state.rebase: done`, `state.build: failed`,
  `finish: in_progress`) resumes at `build`, not `finish` — the false-ship path is closed by
  machinery, at the point of violation.
- Post-rebase kickback verdicts are honored on the very next resume: the next dispatched step is
  the earliest kicked-back gate (desired outcome 2).
- Entry and tail share one satisfaction predicate; future gate semantics changes (e.g. new verdict
  fields) apply to both automatically.

### Negative
- Resume entry now reads `.pipeline/gates/*.json` (small I/O cost, one directory scan per resume).
- A corrupted/hand-edited verdict file can pull a resume backward and re-run completed work — the
  cost is wasted compute, never a false ship (fail-safe direction). Existing kickback caps
  (`MAX_KICKBACKS_PER_GATE`, `MAX_GATE_SELECTIONS`) still bound oscillation once the loop runs.
- The negative path (all verdicts satisfied → unchanged fast-forward) must be pinned by
  regression tests or daemon re-dispatch behavior could silently degrade.

### Follow-up Actions
- [ ] Implement the clamp in `conductor.run()`'s startIndex derivation (resume branch only).
- [ ] Acceptance tests replaying the exact #532 state fixture (both `in_progress` and
      lastDone+1 variants) asserting `build` is dispatched.
- [ ] Negative-path test: all verdicts satisfied → startIndex identical to today's state-only
      derivation.
- [ ] Front-half test: resume at a pre-loop step is not dragged forward by pending loop gates.
