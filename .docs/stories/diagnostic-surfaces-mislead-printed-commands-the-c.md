**Status:** Accepted

# Stories: Accepted remediation commands and durable episode-HALT recovery (#1023)

Track: technical

Tier: M

Scope boundary (binding, from `.docs/track/diagnostic-surfaces-mislead-printed-commands-the-c.md`): every remediation command the conductor CLI's `index.ts` guidance prints is accepted by the CLI; episode-caused HALT recovery survives a daemon restart. `--report` and remediation strings outside `index.ts` guidance are out of scope. Governing decisions: `adr-2026-10-10-durable-episode-halt-stamp` (APPROVED) and `architecture-review-2026-10-10-diagnostic-surfaces-mislead-printed-commands-the-c`.

## Story 1: Recovery guidance prints only commands the CLI accepts

As an operator debugging a stuck feature, I want every command the conductor tells me to run to actually run, so that following the guidance never ends in an exit-1 refusal.

### Acceptance Criteria

#### Happy Path

- Given a worktree with orphaned conductor state, when the operator runs `ai-conductor inline --diagnose`, then the printed reset instruction is `ai-conductor inline --reset` and running that exact command is not refused by the bare-form guard.
- Given orphaned state whose recorded worktree is missing, when the conductor refuses to continue, then its numbered option 2 instructs `ai-conductor inline --reset` and that exact command is not refused by the bare-form guard.
- Given a SHIP-phase evidence gap for a named feature, when the gap report prints its roll-back and inspect instructions, then they read `ai-conductor inline "<feature>"` and `ai-conductor inline --status` and both are accepted by the CLI.
- Given the operator declines the recovery prompt, when the conductor prints its inspect and start-over instructions, then they read `ai-conductor inline --status` and `ai-conductor inline --fresh "<feature>"` and both are accepted by the CLI.

#### Negative Paths

- Given any of the four guidance paths above, when its output is captured, then it contains no bare `ai-conductor --reset`, `ai-conductor --status`, `ai-conductor --fresh`, or `ai-conductor "<feature>"` form that the bare-form guard rejects.
- Given a SHIP-phase evidence gap with no named feature, when the gap report prints its roll-back instruction, then the command still includes the `inline` subcommand and contains no empty quoted argument.
- Given the operator declines the recovery prompt with no feature description recorded, when the start-over instruction prints, then it reads `ai-conductor inline --fresh` with no trailing empty quoted argument and is accepted by the CLI.

### Done When

- [ ] Captured stderr/stdout for each of the six guidance sites in the architecture review's table contains only the accepted `inline` form of its command.
- [ ] Each captured command, tokenized and passed through `detectInline` and `parseArgs`, is classified inline and parses without throwing.

## Story 2: A guidance command that the CLI would reject cannot be introduced

As a harness maintainer, I want the test suite to fail when guidance prints a command the CLI rejects, so that this defect class cannot silently return.

### Acceptance Criteria

#### Happy Path

- Given the closed set of remediation commands the CLI's guidance may print, when the default test tier runs, then every command in the set is proven accepted by the same grammar the operator's invocation takes (`detectInline` then `parseArgs` for inline commands, or the dispatching subcommand's own parser for commands dispatched before the guard).
- Given every guidance site in `index.ts` obtains its command from that closed set, when the default test tier runs, then the guidance-literal source check passes.

#### Negative Paths

- Given a member of the closed set is changed to a form the bare-form guard rejects (for example `ai-conductor --reset`), when the default test tier runs, then the parse test fails naming that command.
- Given a guidance string in `index.ts` hand-writes an `ai-conductor …` or `conduct …` command instead of obtaining it from the closed set, when the default test tier runs, then the source check fails naming the offending line.
- Given a member of the closed set requires an argument (for example a feature description), when it is produced without one, then the result either omits the argument cleanly or is rejected at production time; it never yields a command the CLI refuses.

### Done When

- [ ] A parse test enumerates every closed-set command and asserts acceptance by the CLI's own grammar.
- [ ] A source-check test fails on a fixture guidance string containing a hand-written bare command and passes on current `index.ts`.

## Story 3: An episode-caused HALT is recovered after a daemon restart

As an operator, I want HALTs caused by a rate-limit episode to be auto-recovered even if the daemon restarts, so that a restart does not turn recoverable halts into my work.

### Acceptance Criteria

#### Happy Path

- Given a feature was parked with a HALT while a rate-limit episode was active and the daemon then restarted, when the restarted daemon starts after the recorded episode deadline has passed, then that feature's HALT is cleared through the existing rekick path (HALT preserved to `HALT.cleared`, `REKICK` sentinel written) and the feature becomes eligible for re-dispatch.
- Given a feature was parked with an episode-caused HALT and the daemon restarted before the recorded deadline, when an idle tick occurs after the deadline has passed with no episode active, then that HALT is cleared through the existing rekick path.
- Given a feature was parked with an episode-caused HALT whose stamp was written and whose `HALT.class` disposition the shared halt-retention rule does not retain, and the daemon did not restart, when the episode ends, then that HALT is recovered through the existing rekick path (HALT preserved to `HALT.cleared`, `REKICK` sentinel written) on the first idle tick after the episode ends.

#### Negative Paths

- Given a restarted daemon and a stamped HALT whose recorded deadline has not yet passed, when startup recovery runs, then the HALT is left in place and is not re-kicked.
- Given a stamped HALT and an episode that is active in the current process, when an idle tick occurs, then the HALT is left in place until no episode is active.
- Given a feature halted while no rate-limit episode was active, when the daemon restarts and recovery runs, then that HALT is not cleared.
- Given recovery of one stamped worktree fails (for example its stamp is unreadable), when recovery runs over several stamped worktrees, then the failure is logged, that HALT is left in place, and the remaining stamped HALTs are still evaluated.

### Done When

- [ ] A daemon-level test parks a feature during an active episode, discards the in-process tracker and episode (simulated restart), runs startup recovery past the deadline, and observes `HALT.cleared` plus `REKICK` for that worktree.
- [ ] The same test with the deadline not yet passed observes the HALT unchanged after startup recovery and cleared after a later post-deadline idle tick.
- [ ] A non-episode HALT survives startup recovery unchanged.

## Story 4: A stamp never clears a HALT it was not written for

As an operator, I want automatic episode recovery to touch only the exact HALT the episode caused, so that a human-caused HALT is never cleared by a leftover stamp.

### Acceptance Criteria

#### Happy Path

- Given a stamped HALT whose body is unchanged since it was stamped, when recovery runs past the deadline with no episode active, then the HALT is recovered.

#### Negative Paths

- Given an operator cleared a stamped HALT by hand (`rm -f .pipeline/HALT .pipeline/HALT.class`) and a different HALT was later written in that worktree, when recovery runs, then the later HALT is left in place and the leftover stamp is discarded.
- Given a stamped HALT whose body was replaced by a different body, when recovery runs, then the HALT is left in place and the stamp is discarded.
- Given a stamp whose HALT no longer exists, when recovery runs, then nothing is cleared, no `REKICK` sentinel is written, and the stamp is discarded.
- Given a stamp file that is empty or malformed, when recovery runs, then the HALT is left in place for a human and no exception escapes the recovery pass.

### Done When

- [ ] Unit tests cover the matching-body, replaced-body, absent-HALT, and malformed-stamp cases and show only the matching-body case reaching `clearMarker`.
- [ ] A test of the hand-clear-then-new-HALT sequence shows the new HALT unchanged after recovery.

## Story 5: Operator intent still outranks automatic recovery

As an operator, I want a park or an operator-action HALT to keep the feature with me even if its HALT was episode-caused, so that automatic recovery never overrides my explicit decision.

### Acceptance Criteria

#### Happy Path

- Given a stamped HALT on a feature that is not operator-parked and whose `HALT.class` disposition the shared halt-retention rule does not retain, when recovery runs past the deadline with no episode active, then the HALT is recovered and the daemon log records the re-kick.

#### Negative Paths

- Given a stamped HALT on an operator-parked feature, when startup or idle recovery runs, then the HALT is left in place and the daemon log records that the feature is operator-parked and left for a human.
- Given a stamped HALT whose `HALT.class` is an operator-action class (for example needs-human), when startup or idle recovery runs, then the HALT is left in place and the daemon log names the disposition that blocked the clear.
- Given a stamped HALT whose `HALT.class` is missing or unreadable, when startup or idle recovery runs, then the HALT is left in place and the daemon log names the disposition that blocked the clear.

### Done When

- [ ] Recovery tests for a parked feature, an operator-action class, and a missing or unreadable class each show no `clearMarker` call and the corresponding log line.

## Story 6: The episode stamp lives and dies with its HALT

As an operator, I want the episode stamp to exist only while the HALT it describes exists, so that no stale stamp lingers across HALT cycles.

### Acceptance Criteria

#### Happy Path

- Given a feature parked during an active episode, when the park completes, then its worktree carries a stamp recording the episode deadline and identifying the current HALT.
- Given a stamped HALT, when it is cleared by any daemon path that clears HALTs (episode recovery, base-advance rekick, operator rekick), then the stamp is removed together with `HALT` and `HALT.class`.
- Given a stamped worktree, when the shared HALT writer writes a new HALT there, then the old stamp is removed before the new HALT body is written.

#### Negative Paths

- Given a feature parked while no episode is active, when the park completes, then no stamp is written.
- Given writing the stamp fails, when the park completes, then the park and HALT are unaffected, the failure does not crash the daemon, and the HALT is treated as not auto-recoverable.
- Given clearing a HALT whose worktree has no stamp, when the clear runs, then it succeeds exactly as it does today.

### Done When

- [ ] A test parks during an active episode and finds the stamp beside `HALT.class` with the deadline and HALT identity.
- [ ] Tests show `clearMarker` and `writeHaltMarker` each remove an existing stamp, and that a stamp-write failure leaves the park and HALT intact.
