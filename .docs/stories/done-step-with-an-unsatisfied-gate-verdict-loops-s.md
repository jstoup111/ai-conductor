**Status:** Accepted

# Stories: Done step with an unsatisfied gate verdict loops silently to the selection cap

Technical track (no PRD). Source: jstoup111/ai-conductor#3487. Scope boundary:
`.docs/track/done-step-with-an-unsatisfied-gate-verdict-loops-s.md`.

A verdict is *stale* for a dispatch when the step's gate verdict on disk is unsatisfied and was not
rewritten during that dispatch.

## Story 1: A successful no-op rebase heals its stale verdict and the loop moves on

As the daemon operator, I want a rebase that succeeded without changing anything to clear its own
stale unsatisfied verdict so that the feature keeps building instead of burning the selection cap and
halting for me.

### Acceptance Criteria

#### Happy Path
- Given the `rebase` gate verdict is unsatisfied with reason `routed leaf return requires fresh whole-feature validation for child 3` and was written before the dispatch, when the `rebase` step completes successfully with a `noop` outcome without writing its verdict, then the `rebase` verdict on disk is satisfied with reason `branch already current with base` and a `checkedAt` later than the dispatch start, a `gate_verdict` event for `rebase` with `satisfied: true` is emitted, and the tail selects the next unsatisfied gate without dispatching `rebase` again.
- Given the same stale unsatisfied `rebase` verdict, when the `rebase` step completes successfully with a `mergeable_skip` outcome without writing its verdict, then the `rebase` verdict on disk is satisfied with the mergeable-skip reason and the tail selects the next unsatisfied gate without dispatching `rebase` again.

#### Negative Paths
- Given the `rebase` step completes successfully with a `noop` outcome and wrote a fresh satisfied verdict itself, when the tail transitions, then the engine does not rewrite the verdict and its `checkedAt` equals the value the step wrote.
- Given the `rebase` step completes successfully with a `noop` outcome, the stale `rebase` verdict is healed, and other gates carry recorded verdicts, when the tail transitions, then every other gate verdict file is byte-identical to its pre-dispatch content and no `kickback` event is emitted.

### Done When
- [ ] A conductor test with a stale unsatisfied `rebase` verdict and a verdict-skipping `noop` rebase shows the tail not re-selecting `rebase`, a satisfied `rebase` verdict, and no HALT file.
- [ ] The same test for `mergeable_skip` passes.
- [ ] A test with a `noop` rebase that writes its own verdict shows the step-written `checkedAt` preserved.

## Story 2: A stale verdict that cannot be healed safely halts at once with an accurate reason

As the daemon operator, I want a step that succeeded but left its gate verdict stale, where the
engine cannot re-derive the verdict without side effects, to halt immediately and say exactly that
so that I can tell a stale verdict apart from a gate that keeps failing.

### Acceptance Criteria

#### Happy Path
- Given the `rebase` gate verdict is unsatisfied with reason `R` and was written before the dispatch, when the `rebase` step completes successfully with a `changed` outcome without writing its verdict, then after exactly one `rebase` dispatch the run writes a `needs-human` HALT whose reason names `rebase`, states that the step completed but its gate verdict was not refreshed, and quotes `R`, and the emitted `loop_halt` event carries the same reason.
- Given the stale-verdict HALT above, when the operator reads `.pipeline/HALT`, then the reason does not contain `selected` or `times without satisfying`.

#### Negative Paths
- Given the `rebase` step completes successfully with a `changed` outcome and left its verdict stale, when the run halts, then the downstream gate verdict files are byte-identical to their pre-dispatch content and no `kickback` event is emitted by the halt path.
- Given the `rebase` gate verdict is unsatisfied with reason `R` and was written before the dispatch, when the stacked `rebase` step refuses to restack a published stack and completes successfully without recording a rebase outcome or writing its verdict, then after exactly one `rebase` dispatch the run writes a `needs-human` HALT whose reason names `rebase`, states that the step completed but its gate verdict was not refreshed, and quotes `R`.
- Given the `rebase` step ends with a `conflict_halt` outcome, when the tail transitions, then the existing `rebase conflict — parked for human resolution` halt is written and the stale-verdict halt wording does not appear.

### Done When
- [ ] A conductor test with a stale unsatisfied `rebase` verdict and a verdict-skipping `changed` rebase shows one `rebase` dispatch, a `needs-human` HALT naming `rebase` and quoting the stale reason, and a matching `loop_halt` event.
- [ ] The same test asserts downstream gate verdict files are unchanged.
- [ ] A stacked-rebase test with a published-stack refusal and a stale unsatisfied `rebase` verdict halts `needs-human` after one dispatch with the stale-verdict wording.
- [ ] The existing `conflict_halt` tests pass unchanged.

## Story 3: Genuine re-fails, satisfied verdicts, and kickbacks keep today's behavior

As the daemon operator, I want gates that really keep failing, and kickbacks that legitimately
re-open earlier gates, to behave exactly as they do today so that the stale-verdict handling changes
nothing else.

### Acceptance Criteria

#### Happy Path
- Given a loop gate whose step completes successfully and writes a fresh unsatisfied verdict with reason `R` on every dispatch, when the gate keeps being selected, then the run halts `needs-human` with `gate '<step>' selected 7 times without satisfying: R` exactly as before.
- Given a later step writes a fresh unsatisfied kickback verdict on an earlier `done` gate, when the tail selects that gate, then it is re-opened and re-dispatched as today and no stale-verdict halt or heal occurs.

#### Negative Paths
- Given a step completes successfully, did not rewrite its gate verdict, and that verdict is satisfied, when the tail transitions, then no heal and no stale-verdict halt occurs and the tail proceeds as today.

### Done When
- [ ] The existing `resume-verdict-clamp` selection-cap tests (`gate 'build' selected 7 times without satisfying`) pass unchanged.
- [ ] A conductor test with a kickback-reopened earlier gate shows the existing re-dispatch and no stale-verdict halt.
- [ ] A conductor test with a satisfied, unrefreshed verdict shows no HALT and the verdict file unchanged.
