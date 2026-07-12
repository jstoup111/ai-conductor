# Track: judged-attribution-verdict-persistence

**Source:** jstoup111/ai-conductor#581 (priority: critical)
**Track:** technical
**Status:** Accepted

## Why technical (not product)

This is an engine correctness bug in the conductor's build-completion gate. There is
no user-facing feature surface, no new product requirement, and no acceptance criteria
that a product owner would author. The observable is entirely internal to the SDLC
machinery: a fully-covered build halts instead of advancing. Acceptance signals are
expressed as engine behavior + tests, so the PRD step is skipped and stories are
derived from the technical intent.

## Problem statement (WHAT, not the filer's HOW)

The #520 semantic attribution "judge lane" runs on a build-gate miss, dispatches a
fresh-session verifier, and writes `.pipeline/attribution-verdict.json` with per-task
verdicts. On the 2026-07-12 build of #529 the judge fired, correctly judged 8 residue
tasks *satisfied* by matching commits on content, and 1 as no-verdict — yet the build
**halted anyway on fully-covered work**, with the operator having to intervene.

The judge's verdict has no effect on the completion gate that decides halt-vs-proceed.
#520's entire purpose — heal attribution residue so covered work ships instead of
halting — is nullified.

## Desired outcomes (observable)

1. When the judge returns `satisfied` for a residue task (validated citations + passing
   scoped tests), a `semantic-verified` evidence stamp is persisted **and consumed by
   the completion gate on the same build**, so a residue build the judge finds fully
   covered advances past the build gate with **no operator action**.
2. **No whitewash.** A `no-verdict` or `fail`/unsatisfied task stamps nothing and the
   build still refuses. A satisfied verdict whose citations fail validation is refused,
   not stamped.
3. Distinct from #570 (`isZeroWork` suppression — the judge never runs): this is the
   case where the judge **does run**, produces correct verdicts, and its output is inert.

## Filer's hypothesis (candidate, NOT the chosen approach)

> The judge dispatch writes attribution-verdict.json but the code path that should read
> it and call the evidence-stamp writer (createTaskEvidence/writeJudgedStamps) is missing
> or not invoked before checkStepCompletion re-runs.

Grounded correction from discovery (see architecture review): `writeJudgedStamps` **is**
invoked inside `runAttributionLane` and it does persist `semantic-verified` stamps +
reconcile task-status. The true gap is a **read/ordering gap**, not a missing writer.
DECIDE weighs this evidence rather than the sketch.

## Discovery notes (ephemeral)

Primary code sites (verified in worktree):
- `src/conductor/src/engine/conductor.ts:1863-2012` — the build-gate completion block.
  `completion` is snapshotted at 1865/1910, `runAttributionLane` runs at 1953, and the
  halt decision `if (!completion.done)` at 2012 uses the **stale** pre-lane snapshot.
  Comment at 1999-2007 defers the lane's effect to "the next gate evaluation cycle."
- `src/conductor/src/engine/attribution-lane.ts:354-532` — `runAttributionLane` parses
  the verdict, runs `validateCitations` per satisfied task, and calls `writeJudgedStamps`.
- `src/conductor/src/engine/task-evidence.ts:181-225` — `writeJudgedStamps` persists
  `form:'semantic-verified'` stamps to `.pipeline/task-evidence.json` and calls
  `reconcileStatusFromStamps`.
- `src/conductor/src/engine/autoheal.ts:573-730` — `deriveCompletionInternal` rewrites
  the sidecar each call; honors a pre-existing sidecar stamp only for tasks with **no
  matching Task: trailer commit** (line 668).
