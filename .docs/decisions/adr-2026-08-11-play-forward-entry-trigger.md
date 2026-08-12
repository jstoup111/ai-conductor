# ADR: the play-forward takes an explicit trigger; the sentinel keeps its semantics

**Status: APPROVED**
**Date:** 2026-08-11
**Issue:** jstoup111/ai-conductor#1245
**Stem:** `unhalt-after-main-advance-resumes-against-stale-fe`
**Deciders:** operator (James Stoup), architecture-review

## Context

`adr-2026-08-11-resume-time-base-advance-evaluation` decides that an advanced base must
trigger the rebase-first play-forward. That play-forward lives in `resumeRebaseFirst`
(`daemon-rekick.ts:399-577`), which today is guarded by a single line:

```ts
const sentinel = join(opts.worktreePath, REKICK_SENTINEL);
if (!(await exists(sentinel))) return 'skipped';
// One-shot: consume the sentinel up front so a crash can't loop on it.
await rm(sentinel, { force: true });
```

The sentinel carries semantics beyond "should we rebase":

- **One-shot.** Consumed up front so a crash cannot loop on it.
- **Park-preserved.** `daemon-cli.ts:1067-1079` checks `isOperatorParked` *before* calling
  `resumeRebaseFirst` precisely because the function deletes the sentinel regardless of
  outcome; a parked worktree's sentinel must survive untouched for a human to inspect.
- **Multi-writer.** Three callers arm it (`rekickSweep`, the episode-end sweep,
  `reseal --clear-halt`), each with its own recovery meaning.

So the question is where the new trigger joins: relax the guard *inside* `resumeRebaseFirst`,
or decide at the call site and tell the function why it is running.

## Options Considered

### Option A: relax the guard inside `resumeRebaseFirst`
Have the function itself evaluate base currency when no sentinel is present.
- **Pros:** One place to change; every existing caller inherits the new behavior.
- **Cons:** Entangles two independent recovery signals in one predicate. The function would
  need git/base-resolution dependencies it does not have today. It silently changes behavior
  for the episode-end and reseal paths, which arm the sentinel for reasons unrelated to base
  advance. Worst, it muddies the one-shot contract: with two possible entry conditions, "the
  sentinel was consumed" no longer means "this play-forward was requested".

### Option B: duplicate the play-forward at the call site
Call `performRebase` and friends directly from the base-advance branch.
- **Pros:** No change to `resumeRebaseFirst` at all.
- **Cons:** Forks the play-forward. The merged-PR guard, seal-rejection HALT, gated conflict
  resolution, build pre-verify, verdict application, state stamp and event emission would all
  need re-deriving, and would drift.

### Option C: explicit trigger parameter, decided at the call site (chosen)
The call site owns the decision; `resumeRebaseFirst` takes an explicit trigger and runs its
existing body unchanged.
- **Pros:** One play-forward implementation. Sentinel semantics untouched — still one-shot,
  still park-preserved, still meaning exactly what it means today. The call site already owns
  the park check and has the git runner and config to hand. Each entry reason stays legible
  in logs and events.
- **Cons:** The signature grows an option, and the guard becomes a two-condition check rather
  than one line.

## Decision

**Option C.** The entry condition becomes "a sentinel is present **or** the call site passed
an explicit base-advance trigger". Concretely:

- The call site (`runConductorInWorktree`, after the park check) evaluates base currency per
  `adr-2026-08-11-resume-time-base-advance-evaluation` and passes the trigger when the verdict
  is `advanced`.
- `resumeRebaseFirst` keeps its sentinel handling exactly as-is: if a sentinel is present it
  is consumed one-shot, whether or not the base-advance trigger also fired. If neither the
  sentinel nor the trigger is present, it returns `'skipped'` as today.
- Everything after the guard — merged-PR guard, `performRebase`, `ProtectedArtifactSealRejection`
  → `writeSealHalt`, `runGatedRebaseResolution`, `makeRekickBuildPreVerify`,
  `applyRebaseVerdicts`, `recordRebaseStepCompletion`, `emitRebaseEvent` — is unchanged and
  shared by both entry reasons.
- The trigger is reported, not inferred: the entry reason travels into the emitted event and
  the feature log, so `sentinel` and `base-advance` entries are distinguishable after the fact.

**Park precedence is unchanged and must stay unchanged.** The base-advance evaluation happens
after `isOperatorParked`, so a parked worktree is never evaluated, never rebased, and its
sentinel is never consumed.

### Which resumes are evaluated

The trigger applies to **halt-resume** dispatches, not to every dispatch — evaluating every
dispatch is Option B of the parent ADR, rejected there for fleet-wide blast radius. Two
signals identify a halt-resume, both already present:

1. The daemon's own in-process knowledge that it parked this slug for a HALT — the same
   bookkeeping that drives `registerWatcher`/`disposeWatcher` (`daemon.ts:779-800`) and
   `pickEligible`'s durable-HALT branch (`daemon.ts:155-164`). `watchHaltCleared` already
   fires for **both** causes and already attributes them (`daemon-deps.ts:334-347,394-400`).
2. A `.pipeline/HALT.cleared` sibling on disk, which durably marks the `clearMarker` paths
   (re-kick sweep, episode-end sweep, reseal).

**Known residual gap.** A HALT cleared by hand while the daemon is stopped leaves neither
signal: no in-memory record survives the restart, and an operator `rm` writes no
`HALT.cleared`. That resume is not evaluated and behaves as it does today. This is narrower
than the reported defect (whose daemon was running throughout) and is accepted rather than
solved, because closing it would require either reading state to infer an occurrence — which
the event-spine principle rejects — or evaluating every dispatch, which is the rejected
Option B. Recorded in the risk register.

## Consequences

### Positive
- Exactly one play-forward implementation; no drift between recovery entries.
- The sentinel keeps a single, unambiguous meaning, so the reseal and episode-end paths are
  behaviorally untouched by this feature.
- Entry reason is explicit in telemetry, so "why did this feature rebase on resume?" is
  answerable without reconstructing filesystem state.

### Negative
- `resumeRebaseFirst`'s contract grows a second entry condition; its guard and its tests must
  cover four combinations (sentinel only, trigger only, both, neither).
- The halt-resume signal is two-sourced, and one gap (daemon-down manual clear) remains open
  by choice.

### Follow-up Actions
- [ ] Cover all four guard combinations, including "both present" consuming the sentinel
      exactly once.
- [ ] Assert park precedence explicitly: a parked worktree with an advanced base is neither
      evaluated nor rebased, and its sentinel survives.
- [ ] File the daemon-down manual-clear gap as intake if it is observed in practice.
