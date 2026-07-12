# ADR: Judged attribution verdicts must flip the current build's completion gate

- **Date:** 2026-07-12
- **Status:** APPROVED
- **Source:** jstoup111/ai-conductor#581 (priority: critical)
- **Track:** technical · **Tier:** M
- **Supersedes/amends:** extends the #520 judge-lane design (staged, inert-by-default rollout)

## Context

The #520 semantic attribution judge lane (`runAttributionLane`) exists to heal
attribution residue: when trailers are wrong or missing, a fresh-session verifier judges
whether residue tasks are covered by commits (matched on content), and satisfied
verdicts become `semantic-verified` evidence stamps that let a genuinely covered build
ship instead of halting.

On the 2026-07-12 build of #529 the judge fired, judged 8 residue tasks satisfied, and
the build **halted anyway**. Discovery established the mechanism:

1. **Two verdict paths, neither wires satisfied verdicts into the in-cycle gate.**
   - The live default path is the post-green **spot-audit** (`runSpotAudit`,
     `conductor.ts:3437`), which fires only when the gate is *already satisfied* and is
     **advisory-only by construction** — it never calls `writeJudgedStamps`
     (`attribution-audit.ts:425-436`).
   - The only stamping path is `runAttributionLane` (`conductor.ts:1953`), reached only
     when `attribution_judge_cutover` is armed (inert by default, `config.ts:725`).

2. **Even when the lane is armed, the gate decision is stale.** `completion` is captured
   at `conductor.ts:1865` (re-checked only if auto-heal healed rows, 1910). The lane runs
   and stamps at 1953-2008. The halt decision `if (!completion.done)` at **2012 reads the
   pre-lane snapshot**. There is no `checkStepCompletion`/`deriveCompletion` re-run after
   the lane in the same attempt. The code concedes this (1999-2007): "the lane's stamps
   take effect on the next gate evaluation" — which never arrives once retries exhaust.

3. **`writeJudgedStamps` already does the right thing.** It persists
   `form:'semantic-verified'` stamps to `.pipeline/task-evidence.json` and calls
   `reconcileStatusFromStamps` (`task-evidence.ts:181-224`), which advances
   `task-status.json` rows form-agnostically. `checkStepCompletion` (build predicate)
   reads task-status. So a re-check *after* the lane would consume the stamps — the
   plumbing exists; only the in-cycle re-read is missing.

4. **Precedence hazard.** `deriveCompletionInternal` (`autoheal.ts:573-730`) honors a
   pre-existing sidecar stamp only for tasks with **no matching `Task:` trailer commit**
   (line 668). A residue task with a *mis-attributed* trailer commit that fails path
   corroboration (the #576 case: "Task-14 commit stamped Task: 15") takes the
   path-mismatch branch (709) and its `semantic-verified` stamp is ignored.

## Decision

Wire satisfied judged verdicts into the **current** build attempt's completion gate,
without weakening the no-whitewash guarantees.

1. **In-cycle re-check (decisive).** In the build gate-miss branch, after
   `runAttributionLane` returns, if `laneResult.stampedTaskIds.length > 0`, re-run
   `checkStepCompletion` and update `completion` **before** the `if (!completion.done)`
   decision at 2012. The lane already reconciled task-status from the stamps, so the
   re-check flips a genuinely covered build to done on the same attempt.

2. **Stamp precedence (correctness).** A `semantic-verified` sidecar stamp for task N
   must be honored by completion derivation even when a trailer commit exists for N that
   fails path corroboration — the judge's validated verdict outranks a mis-attributed
   trailer. Implemented in `deriveCompletionInternal` so the rescue survives a later
   re-derivation, not only the immediate task-status reconcile.

3. **No-whitewash invariants are load-bearing and tested adversarially.**
   - Only `satisfied` verdicts with citations that pass `validateCitations` and carry
     passing scoped test evidence produce a stamp (existing lane behavior — unchanged).
   - `no-verdict`, `unsatisfied`, and refused tasks stamp nothing; the re-check therefore
     still evaluates them as incomplete and the build refuses.
   - The stale-anchor fail-closed coercion (verifier ran against a different HEAD →
     all verdicts → no-verdict) is preserved.
   - The re-check is triggered **only** when the lane actually stamped tasks — no
     spurious re-derivation, and no path that marks a task done without a real stamp.

4. **Scope boundary.** This ADR does **not** arm `attribution_judge_cutover` (rollout is
   a separate operator decision) and does **not** change the advisory spot-audit path.
   It fixes what happens to the lane's output *when the lane runs*.

## Alternatives considered

- **Make the spot-audit path stamp.** Rejected: the spot-audit is deliberately
  observational and fires post-satisfaction; making it mutate state would blur the
  audit/enforcement boundary and risk whitewashing already-shipped builds.
- **Rely on the "next cycle" as designed.** Rejected: the next cycle never runs when
  retries are exhausted (the exact #529 failure), so covered work still halts.
- **Re-derive via `deriveCompletion` after the lane instead of `checkStepCompletion`.**
  `checkStepCompletion` reads task-status (already reconciled by the lane) and is the
  cheaper, more direct read; the precedence fix (Decision 2) covers the derivation path
  for durability. Both are addressed rather than either alone.

## Consequences

- A residue build the judge finds fully covered advances with no operator action.
- Uncovered / abstained / refused builds still halt — no new false-ship surface.
- Change is inert by default (cutover absent) — byte-identical to today.
- Interacts with concurrent attribution work (#570, #576, #530/#529) in the same files;
  see conflict-check.

## Consequences for docs

- Update `src/conductor/README.md` attribution/evidence section to state that a
  satisfied judged verdict advances the current build's gate in-cycle.
- CHANGELOG `[Unreleased]` → Fixed.
