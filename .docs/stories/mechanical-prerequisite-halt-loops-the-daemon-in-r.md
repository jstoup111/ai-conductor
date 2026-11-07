**Status:** Accepted

# Stories: A retryable HALT is cleared before the daemon re-dispatches it (#3601)

Technical track. Governing decision: `adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary` (D1–D5). Source: jstoup111/ai-conductor#3601. Desired outcomes:

- **O1:** after a mechanical "re-dispatch from an earlier reachable prerequisite" HALT, the next daemon dispatch runs that prerequisite without operator action.
- **O2:** the daemon never re-dispatches a feature it will immediately refuse, and a refused resume is not retried in a tight loop.
- **O3:** a needs-human HALT still blocks dispatch until the operator clears or authorizes it.

A "retryable HALT" is a live `.pipeline/HALT` whose `.pipeline/HALT.class` is `mechanical` or `legacy`. `.pipeline/HALT.rekicked` holds the body of the HALT the daemon's dispatch boundary last cleared. `.pipeline/HALT.cleared`, which also carries an operator's prd_audit over-scope decision, is never written by that boundary.

## Story 1: A retryable HALT is cleared before an automatic re-dispatch runs the feature

**Requirement:** O1; adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary D1, D5

As the daemon operator, I want the daemon to clear a retryable HALT before it re-runs the feature, so that the stack preflight and the conductor never refuse a dispatch the daemon chose to make.

### Acceptance Criteria

#### Happy Path
- Given a parked stacked feature whose live HALT has class `mechanical`, when the daemon automatically re-dispatches it, then before the feature executor starts `.pipeline/HALT` and `.pipeline/HALT.class` are absent, `.pipeline/HALT.rekicked` holds the former HALT body byte-for-byte, and the dispatch is not refused with "live HALT without resume authorization".
- Given a stacked feature halted mechanically with "Step 'manual_test' is blocked by unsatisfied prerequisite: test_suite (pending)" and `test_suite` pending, when the daemon's next dispatch of that feature runs, then `test_suite` starts in that dispatch and no operator command or marker deletion happens in between.
- Given the daemon clears a retryable HALT before a re-dispatch, when the clear completes, then the feature's `.pipeline/audit-trail/events.jsonl` gains exactly one `halt_cleared` record with `cause` `rekick`, the committed halt record is superseded, and the daemon log gains one line naming the feature slug and the cleared HALT class.
- Given a parked feature whose live HALT has class `legacy`, or a non-stacked feature whose live HALT has class `mechanical`, when the daemon automatically re-dispatches it, then the HALT is cleared the same way before the executor starts.

#### Negative Paths
- Given a parked feature whose live HALT has class `needs-human`, when the daemon evaluates it on any automatic path, then it is not dispatched and the bytes of `.pipeline/HALT` and `.pipeline/HALT.class` are unchanged.
- Given a parked feature whose `.pipeline/HALT.cleared` holds an operator's prd_audit over-scope decision not yet harvested and whose live HALT has class `mechanical`, when the daemon clears that HALT before re-dispatching, then `.pipeline/HALT.cleared` is byte-identical before and after the clear.
- Given a parked feature whose live HALT has no `HALT.class` sidecar, class `unclassified`, an operator-action class such as `stack-tip-diverged`, or an unrecognized class string, when the daemon evaluates it on any automatic path, then the HALT is not cleared and the feature is not dispatched.
- Given a feature with a durable operator park marker and a live `mechanical` HALT, when the daemon evaluates it, then the HALT is not cleared and the feature is not dispatched.
- Given the HALT is removed by someone else between the daemon's eligibility decision and its clear, when the dispatch clears, then the clear succeeds as a no-op, no error is raised, and the feature runs.
- Given clearing the retryable HALT throws, for example because `REKICK` cannot be written, when the dispatch boundary handles it, then the feature executor is not started in that dispatch, the feature returns to the parked set, and the daemon log names the slug and the clear failure.

### Done When
- [ ] A daemon-core test drives a parked `mechanical` slug through `dispatch` and observes, at the moment the injected executor is invoked, no `HALT`/`HALT.class`, a `HALT.rekicked` equal to the prior body, and a `HALT.cleared` byte-identical to its pre-dispatch content (or still absent).
- [ ] A test of the #3601 prerequisite shape shows the resumed run's first executed step is `test_suite`.
- [ ] Tests assert the HALT bytes are unchanged and the executor is not called for `needs-human`, absent, `unclassified`, operator-action, unknown-class, and operator-parked HALTs.
- [ ] A test asserts exactly one `halt_cleared` (`cause: 'rekick'`) audit-trail record per clear, even with a HALT-cleared watcher registered for the slug, and a test asserts a throwing clear never starts the executor.

## Story 2: Each distinct retryable HALT gets one prompt re-dispatch

**Requirement:** O1, O2; adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary D2

As the daemon operator, I want a new mechanical HALT to be retried once right away, and an identical repeat to wait, so that a self-recovering stop recovers without depending on main moving and never spins.

### Acceptance Criteria

#### Happy Path
- Given a parked feature with a live `mechanical` HALT, no `.pipeline/HALT.rekicked`, no task progress since its last dispatch, and no base-branch advance, when the daemon next picks work, then the feature is re-dispatched once.
- Given a parked feature whose live `mechanical` HALT body differs from the body in `.pipeline/HALT.rekicked`, when the daemon next picks work, then the feature is re-dispatched once.

#### Negative Paths
- Given a feature whose prompt re-dispatch ended with a `mechanical` HALT byte-identical to `.pipeline/HALT.rekicked`, no task progress, and no base-branch advance, when the daemon idles for 60 seconds, then no further dispatch of that feature starts and the daemon log gains no `resume` line for it.
- Given the same identical repeat, when the base branch then advances or a rate-limit episode ends, then the existing base-advance sweep or episode-end sweep re-dispatches it exactly as before this change.
- Given `.pipeline/HALT.rekicked` exists but cannot be read, when the daemon compares HALT bodies, then the live HALT counts as distinct and the feature gets its one prompt re-dispatch.
- Given a mechanical HALT writer whose body changes on every recurrence, when prompt re-dispatches for that feature reach the configured `build_progress_halt.dispatch_ceiling` within one daemon run, then no further prompt or progress re-dispatch of it starts in that run, and the daemon logs the ceiling reason once.
- Given a parked feature whose live HALT has class `needs-human` and a body different from `.pipeline/HALT.rekicked`, when the daemon next picks work, then it is not re-dispatched.

### Done When
- [ ] Daemon-core `pickEligible` tests cover: no `HALT.rekicked`, a differing body, an identical body, an unreadable `HALT.rekicked`, and a `needs-human` class. Each asserts the eligibility outcome.
- [ ] A loop-level test with an executor that always re-writes the identical mechanical HALT asserts exactly one re-dispatch over repeated idle ticks.
- [ ] A loop-level test with an executor that writes a fresh body each time asserts the dispatch count stops at the configured ceiling and logs the ceiling line once.

## Story 3: A dispatch that resolves no task never earns a progress re-kick

**Requirement:** O2; adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary D3, D4

As the daemon operator, I want the progress-gated re-kick to fire only when the most recent dispatch actually resolved tasks across the whole feature, so that a refused or idle dispatch cannot keep a feature eligible until the ceiling.

### Acceptance Criteria

#### Happy Path
- Given the daemon is about to run a dispatch on an existing feature worktree, when the dispatch starts, then `.pipeline/task-evidence.json` `lastResolvedCount` equals the feature's resolved task count across every child, read from `.pipeline/task-status.json` at that moment.
- Given a stacked feature whose most recent dispatch raised the whole-feature resolved count and then halted with a `mechanical` HALT identical to `.pipeline/HALT.rekicked`, when the daemon next picks work, then the progress-gated re-kick re-dispatches it, counted against `dispatch_ceiling`.

#### Negative Paths
- Given a stacked feature whose earlier children have resolved tasks and whose most recent dispatch resolved none, when the daemon evaluates the progress-gated re-kick, then the feature is not eligible.
- Given a dispatch that the stack preflight refuses before any step runs (for example a live restack-journal owner that writes a `mechanical` HALT), when the daemon next picks work, then the progress-gated re-kick does not select it, and the refusal HALT produces at most one prompt re-dispatch before the feature waits.
- Given a stacked feature in the state from #3601, when the daemon runs for 80 seconds, then the daemon log shows at most two `resume` lines for that feature, not 21.
- Given `.pipeline/task-evidence.json` is missing or corrupt when a dispatch starts, when the daemon stamps the baseline, then a valid sidecar holding the current whole-feature count is written and the dispatch runs.
- Given stamping the baseline fails with a write error, when the dispatch boundary handles it, then the dispatch still runs and the daemon log names the slug and the stamp failure.
- Given a first dispatch whose worktree does not exist yet, when the dispatch starts, then no baseline is stamped and no error is raised.
- Given `build_progress_halt.enabled: false`, when a feature halts mechanically after making progress, then no progress-gated re-kick happens, while the retryable-HALT clear and the one prompt re-dispatch from Stories 1 and 2 still happen.
- Given a build step exits during a dispatch, when the conductor finishes that step, then the conductor does not write `lastResolvedCount`, and the value stamped at dispatch start is unchanged.

### Done When
- [ ] A dispatch-boundary test seeds a multi-child `task-status.json` and asserts the stamped `lastResolvedCount` equals the whole-feature resolved count.
- [ ] A progress-eligibility test asserts that the earlier children's resolved tasks alone do not make the feature eligible, and that one newly resolved task does.
- [ ] A test with a stack-preflight refusal executor asserts the dispatch count stays at or below two across many idle ticks.
- [ ] Conductor tests assert a build-step exit leaves `lastResolvedCount` unchanged, and tests cover the missing, corrupt, write-failure, and no-worktree baseline cases.

## Story 4: Operator-only HALTs still block every path

**Requirement:** O3; adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary D4

As the daemon operator, I want halts that only I can resolve to stay in force after this change, so that faster mechanical recovery never resumes work that needs my decision.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature with a live `needs-human` HALT and a staged resume authorization that matches it, when the operator's authorization is consumed, then the feature resumes through the existing authorization path, unchanged by this feature.

#### Negative Paths
- Given a stacked feature with a live `needs-human` HALT and no matching resume authorization, when the stack preflight runs through a direct or CLI resume, then it still refuses with "live HALT without resume authorization" and the HALT bytes are unchanged.
- Given a parked feature with a live `needs-human` HALT whose most recent dispatch resolved tasks, when the daemon evaluates the progress-gated re-kick, then it is refused for that class and the existing refusal line names the slug and the disposition.
- Given a feature whose prompt re-dispatch ends with a `needs-human` HALT, when the daemon next picks work, then it is not re-dispatched until an operator clears or authorizes it.

### Done When
- [ ] The existing stack-preflight tests for "live HALT without resume authorization" pass unchanged.
- [ ] A daemon-core test asserts a `needs-human` HALT with task progress and a fresh body is neither cleared nor dispatched.
- [ ] A test asserts a dispatch that ends `needs-human` is never re-dispatched automatically.
