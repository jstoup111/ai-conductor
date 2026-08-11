# Conflict Report: Worktree-local provider scratch lifecycle

**Date:** 2026-08-10
**New stories:** `.docs/stories/interrupted-self-host-runs-leak-provider-homes-unt.md` (Stories 1–8)
**Scanned:** all files in `.docs/stories/`, `.docs/specs/`, prior reports in `.docs/conflicts/`, and the unmerged spec branches surfaced by `conduct-ts overlap-scan` over the Wiring Surface paths.

**Result:** 1 blocking conflict (resolved by amendment), 2 degrading interactions (accepted). Zero blocking conflicts remain.

---

## Conflict 1: An interrupted run is asserted to leave nothing behind

**Stories involved:** #907 HP-1 (Codex safety and self-host parity) vs Story 5 (An interrupted attempt's orphan is reclaimed at the next dispatch boundary)
**Files:** `.docs/stories/codex-safety-and-self-host-parity-907.md:305-307` vs `.docs/stories/interrupted-self-host-runs-leak-provider-homes-unt.md` Story 5
**Type:** contradiction
**Severity:** blocking

**Description:**

#907 HP-1 states: *"Given a self-host run provisioned isolated provider state, when it completes, fails, is cancelled, times out, **is interrupted**, exhausts retries, or is replaced, then feature-created provider state and child-only environment changes are **absent afterward**."*

Story 5 asserts the opposite for the interruption case: an interrupted attempt's scratch home **persists** until a later dispatch-boundary sweep observes its owner is dead, and persists **indefinitely** when liveness cannot be established.

Tested in both directions:

- *If #907 HP-1 is fully satisfied, does Story 5 still hold?* Yes in substance — Story 5 is the mechanism that eventually delivers absence. It does not contradict the intent, only the timing.
- *If Story 5 is fully satisfied, does #907 HP-1 still hold?* **No.** "Absent afterward" is false during the window between the kill and the next sweep, and remains false for a home whose liveness is undeterminable.

One direction fails, so this is an ordinary contradiction rather than an oscillation.

The root cause is that #907 HP-1 is **unimplementable as literally written** for the interruption case it names. `SIGKILL` and OOM terminate the process before any handler, `finally`, or exit hook can run; no in-process guarantee can make feature-created state absent afterward. Confidence 95%, basis verified — this is exactly the failure intake #1223 reports, with fifteen orphaned `self-host-codex-*` directories as evidence. The assertion has been carrying an absolute guarantee that the code could never have provided, which is plausibly why the leak went unnoticed for as long as it did.

**Resolution Options:**

1. **Amend #907 HP-1 to scope the interruption case to eventual absence** — leave every other terminal path asserting immediate absence, and record that abrupt termination is discharged by the reclamation path rather than in-process. Least disruptive; corrects an overclaim without weakening any achievable guarantee.
2. **Weaken Story 5 to promise immediate absence on interruption** — rejected: not implementable. It would restate the same unachievable guarantee one layer down.
3. **Introduce a supervising process that reaps on behalf of a killed child** — rejected during architecture review as Option C. It cannot cover OOM or power loss either, so it does not actually restore the absolute claim.

**Recommendation:** Option 1.

**Resolution applied:** Option 1. `.docs/stories/codex-safety-and-self-host-parity-907.md` carries an additive amendment note beside HP-1. The original assertion is preserved unchanged.

---

## Interaction 2: Scratch accumulates inside deliberately retained worktrees

**Stories involved:** #1329 TI-4 (a shipped-and-retained worktree whose PR is open is still excluded from dispatch) vs Story 6 (Feature cleanup removes all remaining scratch for that feature)
**Files:** `.docs/stories/worktree-with-no-conduct-state-is-retained-as-pr-o.md` vs Story 6
**Type:** overlap
**Severity:** degrading — accepted

**Description:**

Story 6 leans on worktree removal as the backstop that guarantees no scratch survives a feature. #1329 establishes that worktrees are legitimately **retained** for extended periods — after a verified ship, while a PR awaits main. During that window the backstop never fires, so any scratch left inside a retained worktree persists for as long as the retention does.

Tested in both directions: satisfying #1329 (retain the worktree) does not prevent Story 6 from holding when removal eventually happens; satisfying Story 6 does not force a retained worktree to be removed early. Neither breaks the other — the backstop is simply later than Story 6's framing suggests.

**Accepted compromise:** the dead-owner sweep (Story 5) is the primary reclaimer and runs at every dispatch boundary regardless of retention; worktree removal is explicitly the *final* backstop, not the primary one. This is already how the ADR frames it. No story change required, but the interaction is recorded so a future reader does not mistake the reap for the main line of defense.

---

## Interaction 3: Legacy collection deletes outside the current run's own resources

**Stories involved:** #907 NP-2 (repeated cleanup does not touch the live provider home or broaden the deletion target) vs Story 8 (Historical leaked directories are collected once)
**Files:** `.docs/stories/codex-safety-and-self-host-parity-907.md:316-318` vs Story 8
**Type:** resource-contention
**Severity:** degrading — accepted

**Description:**

#907 NP-2 constrains cleanup to stay path-bounded and never broaden its deletion target. Story 8's one-time legacy collection is by nature broader than any single run: it enumerates the system temporary directory and removes directories no current run owns.

Tested in both directions: NP-2 governs *a run's own repeated cleanup*, which the legacy collection is not; and the legacy collection does not relax NP-2 for the run-scoped teardown path, which remains path-bounded. Neither invalidates the other, but the two live close enough together that the boundary must be explicit.

**Accepted compromise:** the legacy collection is a distinct operation from run-scoped teardown, and inherits architecture-review Condition 3 verbatim — prefix-exact matching against the historical names only, refusal to remove anything covered by a live lease or newer than the current process start, and an event naming every directory removed and every one retained. Story 8's negative paths already encode all three. Run-scoped teardown is unchanged and remains path-bounded per NP-2.

---

## Intra-feature pair scan

All 28 pairs among Stories 1–8 were tested in both directions. One inconsistency was found and corrected during this pass, in the artifacts rather than the stories:

- The approved sequence diagram emitted a "scratch released" event on the normal completion path, while Story 7 enumerates only three variants (reclaimed, retained, failed). Normal release occurs on every attempt of every step, so an event for it would be high-volume and low-diagnostic-value, and none of the intake's desired outcomes ask for it. The diagram was amended to drop the release emission; the three-variant set stands.

No contradiction, state conflict, sequencing conflict, or oscillation was found among Stories 1–8.

## Re-check

Re-run after the amendment and the diagram correction: **passed clean.** Zero blocking conflicts. Two degrading interactions accepted and documented above.
