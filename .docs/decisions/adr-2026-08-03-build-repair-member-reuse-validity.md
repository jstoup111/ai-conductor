# ADR: A BUILD repair re-dispatches every verification member; reuse lives in the member's own evidence

**Date:** 2026-08-03
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #1249), operator-directed
**Depends on:** `adr-2026-07-29-deterministic-build-verification-fanout` (the BUILD group itself),
`adr-2026-07-10-concurrent-group-core`, `adr-2026-07-10-validation-group-join`,
`adr-2026-07-11-verdict-aware-resume-entry` (the satisfaction authority this ADR does not change)
**Relates to:** `adr-2026-07-12-wiring-check-gate`, `adr-2026-07-25-content-addressed-full-suite-proof`,
`adr-2026-07-22-gate-evidence-code-validity-on-redispatch`,
`adr-2026-07-26-cross-dispatch-kickback-livelock-bound`

## Context

Issue #1249. One observed 18-task build (`park-reconciliation-refusal-observability-1114`) was
terminally parked `needs-human` after its BUILD repair and full suite both passed. The engine reached
`build_review` and refused it with `Prerequisites not satisfied: wiring_check`, then returned with no
terminal marker, so the daemon backstop parked the run.

### Verified mechanism

Two satisfaction predicates disagree about the same step, and the deterministic BUILD kickback puts a
passing sibling into exactly the status where they diverge:

- `gateSatisfied` (`selector.ts:53-66`) is **verdict-file authoritative** — `'stale'` returns false,
  otherwise a present `.pipeline/gates/<step>.json` returns `v.satisfied` and the state status is
  never consulted.
- `stepSatisfied` (`state.ts:140-143`), which `checkGate` (`gates.ts:20-31`) uses, is **state-status
  only** — true for `done | skipped | stale`.

`'pending'` plus a `satisfied:true` verdict file is therefore SATISFIED to the selector and
UNSATISFIED to the gate. The BUILD kickback produces that combination on **both** of its branches:

- The group join writes the passing member's verdict file first and unconditionally
  (`conductor.ts:3624-3634` → `computeAndWriteVerdict`), before any failure classification. That is
  the observed `gates/wiring_check.json satisfied:true, checkedAt 03:59:39`.
- The `hasNoVerdict` branch (`conductor.ts:3727-3731`) then demotes **every dispatched member,
  including the one that just passed**, to `'pending'`.
- The else branch (`conductor.ts:3732-3736`) marks only the failing members `'stale'` and leaves the
  passing sibling at whatever it already held — never `'done'`, because only the all-green join
  (`conductor.ts:3823-3832`) writes `'done'`.

Neither branch touches the passing sibling's verdict file, marks it `'stale'`, or sweeps its
evidence. `markDownstreamStale` (`state.ts:199-218`) cannot help: it rewrites only steps whose status
is exactly `'done'`. `sweepStaleReviewArtifacts` (`conductor.ts:4296-4301`) cannot help: it fires only
when a step is re-entered at `'failed'` or `'stale'`, so a member left `'pending'` is never swept.

The observed run follows directly. `build` is a `loopGate`, so after the repair the loop did not
simply advance — `advanceTail` (`conductor.ts:6834-6865`) ran `selectNextGate`
(`conductor.ts:7352-7357`) over the verdict files, `gateSatisfied` read `wiring_check` as satisfied
and skipped it, and the loop jumped to `test_suite`. Hence one `step_started test_suite`, no second
`parallel_started`, and no wiring dispatch. `build_review` was then selected and blocked by its own
state-only entry check (`conductor.ts:4220-4227`), returning with no marker, and the daemon backstop
(`conductor.ts:6931-6955`) wrote a `needs-human` halt.

### The reuse question, and where the answer already lives

The intake's hypothesis is that resume-aware group membership "uses `done` alone as sufficient reuse
authority" and should instead consult the verdict's validity against the post-repair code state. The
first half is accurate — `resolveGroupMembership` (`conductor.ts:7972`) derives reuse from
`getStepStatus(...) === 'done'` and nothing else. The second half points at a mechanism the engine
already has, applied one layer too high.

Both BUILD-verification members are **already** anchored to the code state, inside their own evidence:

- `wiring_check`'s completion predicate records `head` in `.pipeline/wiring-evidence.json` and, when
  `recordedHead !== currentHead`, re-derives the evidence at the current HEAD rather than trusting it
  (`artifacts.ts:2510-2531`).
- `test_suite`'s verifier is content-addressed: a matching fingerprint returns
  `{ status: 'REUSED' }` and a changed one returns `{ status: 'STALE', reason: 'fingerprint_mismatch' }`
  (`full-suite-verifier.ts:588`, `:893`), with `headSha` plus tracked/untracked/env digests in the
  fingerprint (`full-suite-fingerprint.ts:45-47`).

Neither anchor failed in the observed run. They were never consulted, because the step they belong to
was never entered. The defect is not that the anchors are missing or weak — it is that a stale
**gate verdict file** let the loop skip the step whose anchor would have caught the staleness.

### Forces

- Correctness is paramount and fail-closed: never confirm a gate against a tree it did not attest,
  never spend `build_review` tokens on an unverified prerequisite state.
- One authority per question. `adr-2026-07-11` decision 5 already forbids introducing a new
  satisfaction predicate, and `adr-2026-07-26` explicitly reconciles the surface-delta mechanism
  against the progress mechanism as *different questions with correctly different keys*. Adding a
  third code-state authority over gates that already have one is the failure mode, not the fix.
- Reuse must stay real. The BUILD group is concurrent to save wall-clock; a fix that makes every
  repair re-run a full suite would trade one operator cost for another.
- This failure must never again present as a synthetic terminal-less park, which is never re-kicked
  and costs an operator diagnosis every time.

## Options Considered

### Option A: Re-dispatch every member; let each member's own anchored evidence decide the work (CHOSEN)

After a BUILD repair, no BUILD-verification member is reused on the strength of an on-disk gate
verdict. Every non-skipped member is re-dispatched, and each member's existing content-addressed or
HEAD-anchored evidence decides whether real verification work executes. Reconcile the kickback status
so both predicates read it alike, and stop `advanceTail` from selecting a step whose own entry gate
rejects a prerequisite.

- **Pros:** introduces **no** new validity authority, no new gate-verdict field, and no new
  kill-switch; the group's join becomes the single place a member is declared satisfied. Reuse stays
  where the anchor already is, so it is automatically correct for both members and for any future
  member that brings its own anchor. Honors every pinned scope constraint in the accepted corpus,
  including `gate-step-completion-validates-against-code-state-`'s "`wiring_check` … must be
  unchanged". Smallest correct change, and it is the mechanism that already resolved the same class
  for the SHIP group (#920/#922).
- **Cons:** a repair that provably could not affect wiring still re-runs the wiring probe (seconds,
  engine-computed, no LLM dispatch). The suite's fingerprint compare is cheaper still. Accepted: this
  is a bounded deterministic cost paid to remove an unbounded operator cost.

### Option B: Stamp gate verdicts and route group reuse through `gateVerdictStillValid`

Add `codeStamp` to `GateVerdict`, populate it in `computeAndWriteVerdict`, and decide member reuse by
diffing that stamp against HEAD through the existing `GATE_SURFACE` map.

- **Pros:** uniform across members; skips the wiring probe on a docs-only repair; reuses machinery
  that already exists for the judged gates.
- **Cons:** creates a **second** code-state authority over gates that already have one — a
  path-surface approximation layered on top of `wiring_check`'s exact HEAD re-derivation and the
  suite's exact content fingerprint. When the two disagree, the coarser one wins by running first,
  which is strictly worse than the anchor it overrides. It also collides by name with the `codeStamp`
  already carried by judged-gate artifacts, and it contradicts an accepted story that pins
  `wiring_check`'s preservation behavior as out of scope and unchanged. Rejected: the saving is
  seconds of deterministic compute; the cost is an ambiguity in the correctness argument.

### Option C: Consult verdict validity inside `resolveGroupMembership` only (the filer's hypothesis)

- **Pros:** correctly identifies that `done`-alone is insufficient reuse authority.
- **Cons:** **does not fix the observed halt.** In the observed run the group never re-engaged —
  `resolveGroupMembership` was not what preserved the wiring pass; the selector's `gateSatisfied` was,
  before membership resolution was ever reached. Landing only this would leave the wedge intact while
  appearing to close the issue. Recorded because this distinction is the main non-obvious finding of
  this DECIDE phase.

### Option D: Make the selector state-authoritative

Remove the divergence by having `gateSatisfied` defer to the state status.

- **Cons:** inverts `adr-2026-07-11-verdict-aware-resume-entry`, reintroducing the self-report the
  verdict layer exists to distrust (`gate-verdicts.ts:104-110`). Rejected.

## Decision

Adopt **Option A**.

1. **A BUILD-verification kickback leaves every member of that round in a status both predicates read
   alike.** `'stale'` is that status: it short-circuits `gateSatisfied` to false so the member is
   genuinely re-dispatched, it is included in `stepSatisfied` so no downstream gate is blocked by it,
   and it is the status `sweepStaleReviewArtifacts` recognizes. Both kickback branches are covered.
   **Scope:** this changes the deterministic BUILD-verification kickback branches only. The rebase
   path's `done → pending` reset and its pinned invalidation sets are explicitly untouched.

2. **No BUILD-verification member is reused on the strength of an on-disk gate verdict.** After a
   repair, every non-skipped member of the group is re-dispatched, and the group join is the sole
   authority that declares a member satisfied for the round. This mirrors the SHIP publication fence
   that resolved #920 (`conductor.ts:1373-1411`, applied at `4232-4258`), which recomputes each
   member from disk and forces non-green members `'stale'` before re-entry rather than concluding from
   a stale verdict file.

3. **Reuse continues to live inside each member's own evidence, unchanged.** `wiring_check` re-derives
   at the current HEAD when its recorded head moved; `test_suite` returns `REUSED` on a matching
   content fingerprint and `STALE` on a mismatch. Neither predicate, evidence format, nor fingerprint
   is modified by this ADR. A repair that could not affect a member therefore still costs only that
   member's own cheap deterministic check.

4. **`build_review` is never reached with a prerequisite the engine considers unsatisfied.** When
   `advanceTail`'s selection lands on a step whose `checkGate` rejects a prerequisite that the
   selector considered satisfied, the loop resolves that prerequisite by dispatching it instead of
   returning a markerless `gate_blocked`. This applies the existing `clampToRunnablePrerequisite`
   (`conductor.ts:7901-7927`) at the selection site rather than only at resume entry. It introduces no
   new predicate, does not change what `checkGate` means, and stays backward-only, honoring
   `adr-2026-07-11` decisions 1, 4, and 5.

5. **Each member's round outcome is observable with its basis.** A BUILD-verification member settles
   its round with an event naming the member, whether its own evidence was reused or recomputed, and
   the basis (recorded head versus current head for wiring; fingerprint match or mismatch reason for
   the suite). These are declared in the `event-sinks.ts` registry — which is total, so a new member
   of `ConductorEvent` fails compilation until declared — and rendered in `.daemon/daemon.log` on the
   same path `verdict_freshness` uses.

6. **Nothing is added to the gate verdict record, and no new configuration key is introduced.**
   `GateVerdict` keeps `{satisfied, reason, checkedAt, kickback?}`. There is no new kill-switch:
   decisions 1, 2, and 4 are fail-closed correctness, and a wedge that parks a green build is not an
   optimization to opt out of.

**Soundness invariant (binding on `/plan`):** a member may be declared satisfied for a round only by
that round's join, on evidence its own predicate validated against the current code state. No
on-disk gate verdict, step status, or timestamp is sufficient authority on its own.

## Verify-Claims Ledger

### Claims

- **Verified (99%):** `gateSatisfied` (`selector.ts:53-66`) returns `v.satisfied` from the verdict file
  whenever one exists and the status is not `'stale'`, ignoring the state status.
- **Verified (99%):** `stepSatisfied` (`state.ts:140-143`) is true only for `done | skipped | stale`,
  and `checkGate` (`gates.ts:20-31`) is its consumer for prerequisite blocking.
- **Verified (99%):** `conductor.ts:3727-3731` sets every dispatched member to `'pending'` on the
  `hasNoVerdict` path; `conductor.ts:3732-3736` marks only failing members `'stale'`; only the
  all-green join (`conductor.ts:3823-3832`) writes `'done'`.
- **Verified (99%):** the daemon backstop (`conductor.ts:6931-6955`) writes its terminal-less park with
  class `'needs-human'`.
- **Verified (98%):** `wiring_check`'s predicate records and compares `head`, re-deriving at the
  current HEAD on a mismatch (`artifacts.ts:2510-2531`).
- **Verified (98%):** `FullSuiteVerifier` returns `{status:'REUSED'}` on a matching fingerprint
  (`full-suite-verifier.ts:588`) and `{status:'STALE', reason:'fingerprint_mismatch'}` on a mismatch
  (`:893`).
- **Verified (98%):** `resolveGroupMembership` (`conductor.ts:7942-7987`) derives reuse from
  `getStepStatus(...) === 'done'` alone; both call sites (`:1383`, `:3328`) are already `async`.
- **Verified (97%):** `clampToRunnablePrerequisite` (`conductor.ts:7901-7927`) is backward-only and
  applied solely at resume entry (`conductor.ts:2708-2725`); `advanceTail`'s selection has no
  equivalent and only demotes `'done'` to `'pending'` (`conductor.ts:7387-7390`).
- **Verified (96%):** the observed event sequence is produced end-to-end by the chain above. Two
  independent traces of the engine reached this same chain and neither found an alternative producing
  all four observed events. The residual 4% is that the run's `conduct-state.json` no longer exists
  (the parked worktree was removed), so the status at gate time is reconstructed from code, not read.

### Assumptions

- **Load-bearing, reconstructed rather than observed (must be pinned in BUILD, not assumed):** that the
  passing `wiring_check` was left non-`done` with a `satisfied:true` verdict file by this kickback
  rather than by another writer. **Resolution:** the plan's first task is a reproduction acceptance
  test that reconstructs the observed sequence from seeded state and asserts the park. If it cannot
  reproduce the sequence through this chain, the plan stops and the mechanism is re-derived before any
  fix task proceeds.
- **Confirmed (96%, from the code contract):** `'stale'` is a safe demotion target — `gateSatisfied`
  short-circuits it to false and `stepSatisfied` includes it — so decision 1 cannot introduce a new
  downstream block. Pinned by a negative-path test.
- **Reconciled, not contradictory:** an accepted story describes the backstop as leaving the feature
  `halted` and retryable, while this ADR's motivation says the park is not re-kicked. Both hold at
  different granularity — a `.pipeline/HALT` marker exists and the worktree is kept, but its class is
  `needs-human`, which the daemon does not automatically re-kick. TS-1's assertion is written against
  the marker class, which is verified above.

**Verdict:** CLEAR to plan, with the reproduction test as a hard precondition on every fix task.

## Consequences

### Positive

- A repaired BUILD rejoins verification or reports the actual failing verification; it no longer ends
  in a synthetic terminal-less `needs-human` park that blocks automatic re-kick.
- The correctness argument gets simpler, not more complex: one authority per member, located where the
  code-state anchor already is, with the join as the single declarer of satisfaction.
- The predicate divergence behind #1052 and #1249 stops being reachable from the tail selection,
  retiring a class of markerless parks rather than one instance.
- The reuse-versus-recompute decision becomes legible in `daemon.log`, closing the same observability
  gap `verdict_freshness` closed for the judged tail.

### Negative

- A repair that provably could not affect wiring still re-runs the wiring probe. Bounded, deterministic,
  no LLM dispatch, and visible in the new events.
- Two accepted story assertions needed amendment notes, authored in DECIDE and committed with this
  spec because a BUILD-phase agent cannot write another feature's `.docs/stories/` file (phase-scoped
  write-guard, protected-artifact seal, and `build_review` Scope rubric all forbid it): the width-1
  ordering pin in
  `deterministic-test-suite-step.md` (at width 1 a round may now run a single member) and the wiring
  gate's selector/advanceTail integration assertion, whose divergence case changes from "block" to
  "dispatch the prerequisite". Neither intent changes; both wordings do.
- A shared invariant is touched. `stepSatisfied` is consulted by every gate, so decision 4 needs
  adversarial coverage proving the agreement case is byte-for-byte unchanged.

### Follow-up Actions

- [ ] Reproduce the observed sequence as a RED acceptance test before any fix task.
- [ ] Land the kickback status reconciliation, scoped to the BUILD-verification branches.
- [ ] Re-dispatch every member of a post-repair round; make the join the sole satisfaction declarer.
- [ ] Resolve, never block, a tail-selected step whose entry gate rejects a prerequisite.
- [ ] Emit and render the per-member reuse-versus-recompute decision with its basis.
- [x] Amend the two pinned story assertions named above — done in DECIDE, committed with this spec.
- [ ] Align those two assertions' regression tests, which live under `src/conductor/test/`.
- [ ] Update `docs/reference/steps.md`, `docs/explanation/gates.md`, `docs/reference/artifacts.md`,
      `docs/guides/running-the-daemon.md`, and `docs/runbooks/stalled-or-stuck-feature.md`.
