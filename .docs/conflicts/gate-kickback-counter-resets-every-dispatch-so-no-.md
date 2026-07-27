# Conflict Check: cross-dispatch kickback livelock bound (#984)
**Date:** 2026-07-26
**New stories:** .docs/stories/gate-kickback-counter-resets-every-dispatch-so-no-.md
**Scanned against:** the bounds, progress detectors, and halt consumers that share this seam —
`adr-2026-07-13-kickback-build-no-op-escalation` (#647 D1/D2/D3, shipped),
`adr-2026-07-22-gate-evidence-code-validity-on-redispatch` (#817, shipped as
`gate-code-validity.ts`), `adr-2026-07-23-trailer-union-build-step-routing` (#497 class),
`adr-2026-07-20-post-rebase-delta-aware-invalidation`, #982/#983 (engine-computed retry budget),
#897/#924 (`wiring_check` stale-evidence re-derivation), `build_progress_halt` ceilings, the
daemon progress re-kick (`daemon-cli.ts` / `daemon.ts`), and the re-kick sweep (`daemon-rekick.ts`)
**Result:** PASSED — 2 conflicts found and resolved in the ADR + stories; 0 blocking remain

## Conflict 1: Two cross-dispatch progress mechanisms could disagree about the same lap

**Stories involved:** Story 1 / Story 4 (new persisted, tree-keyed bound) vs the daemon's existing
progress re-kick eligibility.
**Type:** contradictory progress semantics on shared state (both decide "did this lap progress?"
across the dispatch boundary, from different signals).
**Severity:** degrading — would halt features the daemon is simultaneously re-kicking as productive.

**Description.** `isProgressReKickEligible` (`daemon.ts:107-115`) consults
`daemon-cli.ts:472-479`, which compares `readLastResolvedCount(slugRoot)` against
`countResolvedTasks(slugRoot)` — a **resolved-task-count** signal, and the only pre-existing
persisted cross-dispatch progress comparison in the engine. The new ledger, as first drafted, keyed
its count on the **tree hash alone**. A lap that resolves a task without moving the tree (e.g. work
recorded in gitignored `.pipeline/task-status.json`) would therefore be re-kicked as progress by the
daemon while being counted as a no-op by the ledger. Two bounds, same lap, opposite verdicts —
and the ledger would eventually halt a feature the daemon considers to be moving.

**Resolution applied (ADR D3, Story 4 negative path).** The ledger's reset condition is widened to
`tree hash differs **OR** resolved-task count increased`. Tree movement stays the primary witness;
resolved-count becomes the secondary one. This is not a new concept — `classifyBuildProgress`
already treats a resolved-count increase as `'did-work'` (`kickback-escalation.ts:39`), so the
three mechanisms now share one definition of progress rather than two. No ADR reversal: the
empty-commit fix is unaffected, because an empty commit moves neither the tree nor the resolved
count.

## Conflict 2: Halt classification vs the re-kick sweep's automatic recovery

**Stories involved:** Story 5 (classify the cap HALT `needs-human`) vs `daemon-rekick.ts`'s
base-advance clearing behaviour.
**Type:** behavioral contradiction (one artifact wants the loop to stop; the other is designed to
resume halted features automatically).
**Severity:** blocking if unresolved — an unclassified halt is recycled, so the fix would not
actually terminate the loop.

**Description.** `daemon-rekick.ts:172-192` skips a halt classified `needs-human` on **every**
sweep, but clears `mechanical` and `unclassified` halts on base advance and makes the feature
eligible for re-dispatch. The `build_review` and `wiring_check` cap HALTs today hand-roll
`writeFile` to `LOOP_HALT_MARKER` (`conductor.ts:5029-5036`, `:5137-5144`) and write no class
sidecar, so `readHaltClass` returns `'unclassified'` and the sweep recycles them. This is an
independent, previously unnoted mechanism sustaining the observed livelock: even if the cap had
engaged, the sweep would have cleared it.

**Resolution applied (ADR D4, Story 5).** Both paths route through
`writeHaltMarker(..., 'needs-human')`. The trade-off is recorded explicitly rather than assumed: a
`needs-human` halt gives up automatic recovery on base advance for this halt class. The considered
alternative — keep `mechanical` and let the tree-keyed ledger grant a fresh budget once a rebase
changes the tree — is also bounded (two laps per distinct tree) and was rejected because the
issue's primary outcome is that the feature *stops* rather than being routed back. Flagged in the
ADR as revisitable via a single argument, so a future operator decision does not require reopening
the design.

## Verified-clean pairs (reasoned, not assumed)

- **#817 `gate-code-validity.ts` (`codeStamp` + `GATE_SURFACE`/`partitionDelta`) vs the new
  tree-hash key.** Not a duplicated mechanism and not a contradiction: #817 asks "does this delta
  touch the gate's surface, so must the verdict be re-derived?", while this change asks "did
  anything change, so has progress occurred?" A `.docs/`-only build is correctly *not* progress
  toward closing a wiring gap, but would be a surface *miss* for #817. ADR-2026-07-22 rejected raw
  tree-hash equality for its own question for the symmetric reason. Different questions,
  deliberately different keys — documented in both the ADR's Alternatives and the architecture doc
  so a later reader does not "unify" them.
- **#983 engine-computed retry budget of one** (`isEngineComputedStep`, `conductor.ts:3570`).
  Strictly within-dispatch attempt budgeting for `wiring_check` and `test_suite`; this change is
  strictly cross-dispatch kickback budgeting. They compose: a step runs once per lap (#983) and
  gets at most `MAX_KICKBACKS_PER_GATE` laps per distinct tree (this change). Neither reads the
  other's state. The issue itself carves out the distinction.
- **#897/#924 `wiring_check` stale-evidence re-derivation.** That change lives in the completion
  predicate (`artifacts.ts`, `validateWiringEvidence` / probe re-derivation); Story 3 adds the D2
  capture/check pair to the *kickback* block (`conductor.ts:5069-5155`). Disjoint code paths, and
  the gap-message assembly Story 3 reads is unchanged by #924. Story 3 additionally pins
  `test/wiring-gate-loop.test.ts` to pass unmodified as the guard on this boundary.
- **`build_progress_halt.attempt_ceiling` / `dispatch_ceiling`** (defaults 30 / 20,
  `config.ts:1305-1309`). Independent ceilings on a *progressing* build; this change bounds a
  *non-progressing* kickback cycle. Whichever trips first halts, and neither reads the other's
  counters. No shared state, no ordering requirement.
- **Trailer-union completion / #497 worktree loss.** `countResolvedTasks` unions
  `task-status.json` with `Task:` trailers (`task-progress.ts:62-98`) so committed work survives
  worktree deletion. The new ledger does **not** get that durability — it is gitignored
  `.pipeline/` state and resets on worktree recreation. Reasoned as non-conflicting because it
  fails *open*: a reset grants a fresh budget, never a spurious halt. Recorded as an accepted
  limitation in the ADR's Consequences rather than left implicit.
- **`kickback_escalation.enabled` kill-switch** (`types/config.ts:301-311`). Story 3's negative
  path asserts that with the flag off, D2 does not fire but the D1 persisted cap still bounds the
  loop — preserving #647's stance that D1 was ungated correctness while D2 was toggleable. The
  flag's meaning is extended (it now also gates the tree-hash witness) but not contradicted.
- **The four unmigrated run-local counters** (`stuckGate`, `prdAuditSelfHeals`,
  `remediationRounds`, `manualTestSelfHeals`, `conductor.ts:2330-2342`). They share the same
  reset-per-dispatch defect but are untouched here, so no story contradicts them. Declared in the
  ADR's Non-goals so the residual exposure is documented rather than silently inherited.
