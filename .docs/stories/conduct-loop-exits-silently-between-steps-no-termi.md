**Status:** Accepted

# Stories: Conduct loop no-verdict diagnostics

Technical track — acceptance criteria for enriching the conductor's daemon-only
no-verdict backstop so a "parking for inspection" HALT always leaves something
inspectable, never prints `last step: unknown`, and converts an escaped
async rejection in the step-transition path into a normal HALT.

Grounding: `src/conductor/src/engine/conductor.ts` — the `catch` at ~5125
(writes `conductor error: <msg>` + `loop_halt`), and the daemon-only `finally`
backstop at ~5166 (fires when the run reaches `finally` with neither
`.pipeline/DONE` nor `.pipeline/HALT`; today writes
`loop exited without a terminal verdict (last step: ${state.last_step ??
'unknown'})`). The daemon classifies a run solely by the DONE vs HALT marker.

---

## Story: No-verdict backstop HALT captures why the loop exited

**Requirement:** Diagnostic capture — "parking for inspection" must leave
something inspectable.

As an operator inspecting a parked feature, I want the no-verdict backstop HALT
to record why the loop exited so that I have concrete evidence to diagnose,
instead of a completed step followed immediately by a bare halt line.

### Acceptance Criteria

#### Happy Path
- Given a daemon run whose loop reaches the `finally` backstop with neither
  `.pipeline/DONE` nor `.pipeline/HALT` written (an early `return` between
  steps), when the backstop fires, then the `.pipeline/HALT` marker content
  includes all three of: the loop's last-advanced step (breadcrumb), the last
  emitted event type, and the loop exit context (the step index / phase the
  loop was at when it exited).
- Given the same run, when the backstop emits the `loop_halt` event, then the
  event `reason` carries the same enriched diagnostics that were written to the
  `.pipeline/HALT` marker (marker and event agree).
- Given the run is a daemon run, when the backstop fires, then the run is still
  classified `halted` (a `.pipeline/HALT` marker exists; the worktree is kept
  and the feature remains retryable) — the existing terminal-marker guarantee
  is preserved.

#### Negative Paths
- Given the loop exited before any breadcrumb was recorded and no last event is
  available (genuinely nothing ran), when the backstop fires, then it still
  writes a well-formed `.pipeline/HALT` marker that names the absence
  explicitly (e.g. "no step executed / no event emitted") and never throws
  while assembling the diagnostics.

### Done When
- [ ] A daemon run that hits the no-verdict `finally` backstop writes a
      `.pipeline/HALT` whose content names the last-advanced step, the last
      emitted event type, and the loop exit index/phase (asserted by a test in
      `src/conductor/test/engine/conductor-terminal-marker.test.ts` or a sibling).
- [ ] The emitted `loop_halt` event `reason` equals / contains the same
      diagnostics as the marker (single source, asserted by test).
- [ ] Assembling the diagnostics is failure-tolerant: a test with no recorded
      breadcrumb/event still produces a non-empty HALT marker and emits
      `loop_halt` (no throw, marker non-empty).

---

## Story: `last step: unknown` never appears in a no-verdict HALT

**Requirement:** Eliminate the `unknown` last-step token; the loop always knows
its last step.

As an operator, I want the parked HALT to always name a concrete last step so
that I know where in the pipeline the loop stopped, because today
`state.last_step` is only assigned for a few steps and prints `unknown`
otherwise.

### Acceptance Criteria

#### Happy Path
- Given a daemon run whose state has `build` and `manual_test` marked `done` but
  `state.last_step` was never assigned (reproducing the 2026-07-11T01:13Z case),
  when the no-verdict backstop fires, then the HALT reason names the
  most-recently-completed step reconstructed from the state's completed-step
  keys (e.g. `manual_test`) — and the literal token `unknown` does not appear
  anywhere in the marker or the `loop_halt` event.
- Given the loop advanced past a step that does assign `state.last_step`, when
  the backstop fires, then the reconstructed/recorded last step is consistent
  with the furthest-progressed completed step (the reconstruction does not
  regress a known `last_step`).

#### Negative Paths
- Given `state.last_step` is unset AND the state carries no completed-step keys
  at all (nothing ran), when the backstop fires, then the HALT reason states an
  explicit sentinel such as "no step recorded" — it must NOT emit the literal
  string `unknown`, and must not throw.

### Done When
- [ ] A test seeds a state with `{ build: 'done', manual_test: 'done' }` and no
      `last_step`, triggers the backstop, and asserts the HALT reason names
      `manual_test` (or the furthest completed step) and does NOT contain the
      substring `unknown`.
- [ ] A test seeds an empty state (no step keys, no `last_step`), triggers the
      backstop, and asserts the reason contains the explicit no-step sentinel
      and does NOT contain the substring `unknown`.
- [ ] A repo-wide check confirms the `?? 'unknown'` fallback token is removed
      from the no-verdict backstop reason (the old literal is gone).

---

## Story: An escaped async rejection in the step-transition path becomes a HALT

**Requirement:** If the cause is an unhandled rejection in the step-transition
path, it is caught and converted to a normal HALT with reason rather than a
silent exit.

As the daemon, I want any async rejection raised while advancing between steps
to be converted into a normal HALT so that the feature is parked as
`halted` (retryable, worktree kept) with a reason, instead of exiting silently
or crashing the process.

### Acceptance Criteria

#### Happy Path
- Given the step-transition / advance path rejects with an `Error` that would
  otherwise escape the loop, when the daemon run executes, then the rejection is
  caught, a `.pipeline/HALT` marker is written, and a `loop_halt` event is
  emitted whose reason includes the error message and its stack.
- Given that caught rejection, when the run is classified, then it is `halted`
  (worktree kept, parked, retryable) — never a markerless exit and never an
  uncaught process crash.

#### Negative Paths
- Given the step-transition path rejects with a non-`Error` value (e.g. a
  rejected string, `undefined`, or a thrown object without `.message`), when the
  handler converts it to a HALT, then it stringifies the value safely into the
  reason and still writes a well-formed `.pipeline/HALT` marker — the error
  handler itself never throws while handling the error.

### Done When
- [ ] A test forces the step-transition/advance path to reject with an `Error`
      and asserts a `.pipeline/HALT` is written, a `loop_halt` event fires, and
      the reason contains the message and stack.
- [ ] A test forces a non-`Error` rejection (e.g. a rejected string) and asserts
      a well-formed HALT is still written with a safely stringified reason and no
      throw escapes the handler.
- [ ] Both cases classify as `halted` (DONE marker absent, HALT marker present).
