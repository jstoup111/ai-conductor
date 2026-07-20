# Stories: no build dispatch without attribution state (issue #671)

Status: Accepted

Source: jstoup111/ai-conductor#671 — forensics from #486's triple park (2026-07-14):
three build dispatches authored 17 real commits with NO `Task:` trailers.
`.pipeline/dispatch-count` shows `Task: none` for those dispatches; `.pipeline/current-task`
was absent, so the #433 prepare-commit-msg hook correctly abstained
(`git-hook-assets.ts:43-56`). `deriveCompletion` collects candidates strictly by trailer
(`autoheal.ts:723-732`) → zero candidates → `zero_work_product` ×3 → park. The work was
permanently unattributable without operator patch-id forensics.

Verified-in-code framing: the engine's dispatch seam (`conductor.ts:2674-2701`) writes only
`.pipeline/build-step-active`; `.pipeline/current-task` is stamped reactively by the PRE
session hook (`session-hook-assets.ts:171`) only when a sub-dispatch's line-1 carries
`Task: <id>` — every uncertainty path removes the stamp (#519 abstain-or-loud). The hook
abstaining is CORRECT; the bug is that the composition lets untrailered commits accumulate
silently until the evidence gate. This spec is the dispatch-seam sibling of
`adr-2026-07-11-attribution-abstain-or-loud.md`.

---

## Story 1 — Attribution-blind dispatches are surfaced loudly, not at the gate

As the harness owner, I want a build dispatch that produces commits without attribution
state to fail loudly at (or during) the dispatch, so an entire successful build can never
be silently converted into a guaranteed evidence park.

### Scenario 1.1 (happy): attribution-enforced build dispatch asserts its preconditions
- Given a build step with attribution enforcement configured
  (`isEnforcementConfigured` true, marker written at conductor.ts:2674-2677)
- When the engine launches the build dispatch
- Then the engine deterministically verifies the attribution machinery it depends on is in
  place (task-status seeded, hooks installed, stamp path writable) before the session runs,
  and a violated precondition fails the dispatch loudly (clear diagnostic naming
  `.pipeline/current-task`) instead of proceeding

### Scenario 1.2 (happy): untrailered-commit accumulation is detected in-step
- Given a running build dispatch whose sub-dispatches record `Task: none` lines in
  `.pipeline/dispatch-count` while commits land untrailered
- When N consecutive attribution-less dispatch lines accumulate within one build dispatch
- Then the engine emits a loud, operator-visible event naming the abstention streak during
  or immediately after the dispatch — NOT first discovered at the evidence gate three
  attempts later

### Scenario 1.3 (negative): correctly-stamped dispatches are untouched
- Given a build dispatch whose sub-dispatches stamp `Task: <valid-id>` normally
- When the build runs to completion
- Then no new failure or warning fires and behavior is byte-identical to today

### Scenario 1.4 (negative): non-build steps unaffected
- Given any non-build step (plan, stories, validation)
- When it dispatches
- Then the invariant does not apply (no current-task requirement outside the build seam)

## Story 2 — `Task: none` is an error state in dispatch telemetry

As the harness owner, I want dispatch-count telemetry to distinguish attributed from
unattributed dispatches, so `Task: none` is machine-detectable as an error signal rather
than blindly counted as work.

### Scenario 2.1 (happy): per-dispatch task id recorded and readable
- Given sub-dispatches with line-1 `Task: task-3` and `Task: none`
- When the dispatch-count reader parses `.pipeline/dispatch-count`
- Then it exposes attributed vs unattributed dispatch counts (per-line task id already
  recorded verbatim at session-hook-assets.ts:74-75), not just a blind non-empty-line count

### Scenario 2.2 (happy): all-`Task: none` dispatch no longer masks zero-work detection
- Given a dispatch cycle whose dispatch-count lines are ALL `Task: none`
- When `detectZeroWorkProduct` (attribution-enforcement.ts:144-155) evaluates the cycle
- Then the unattributed streak is reported as its own loud reason (attribution failure)
  rather than relying solely on `headUnchanged` — the operator sees WHY (no attribution)
  instead of a generic `zero_work_product`

### Scenario 2.3 (negative): mixed lines do not false-positive
- Given a dispatch cycle with some `Task: <id>` lines and some `Task: none` lines
- When telemetry is evaluated
- Then attributed dispatches are credited normally and only the unattributed subset is
  flagged (no whole-cycle error for a partial streak below the loudness threshold)

## Story 3 — Existing abstain-or-loud contracts preserved

As the harness owner, I want the fix to compose with the #519 hook-lane contracts, so no
stale stamp is ever left and no id is ever guessed.

### Scenario 3.1 (happy): hook abstention behavior unchanged
- Given `.pipeline/current-task` absent at commit time
- When prepare-commit-msg runs
- Then it still abstains (no trailer, exit 0) — the fix adds engine-side detection, never
  hook-side guessing

### Scenario 3.2 (negative): no new stamp-guessing path
- Given any uncertainty path in the PRE dispatch hook
- When it fires
- Then the stamp is still removed (abstain), and the engine invariant/loudness machinery
  never writes a fabricated task id anywhere
