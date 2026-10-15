**Status:** Accepted

# Stories: Live provider identification per step and per parallel member (#1268)

PRD: `.docs/specs/running-provider-is-invisible-per-step-and-absent-.md`
Architecture review: `.docs/decisions/architecture-review-2026-10-14-running-provider-is-invisible-per-step-and-absent-.md`

## Story 1: Daemon log names the provider when a serial step attempt begins

**Requirement:** FR-1

As an operator tailing the daemon log, I want a line naming the provider as soon as a step's attempt begins so that I know which provider is doing the work while it runs.

### Acceptance Criteria

#### Happy Path
- Given a daemon feature dispatch of the serial step prd routed to claude, when the claude attempt begins executing, then the feature's daemon log shows a line containing "prd on claude" before that attempt's completion line.
- Given a daemon feature dispatch of the serial step plan routed to codex, when the codex attempt begins executing, then the feature's daemon log shows a line containing "plan on codex" before that attempt's completion line.

#### Negative Paths
- Given a provider attempt that is still executing and has not completed, when the daemon log is read, then the provider-start line for that attempt is already present rather than appearing only after completion.
- Given a recovery-session dispatch for a retained feature, when its provider attempt begins executing, then the provider-start line appears on that feature's daemon log exactly as for a normal feature dispatch.

### Done When
- [ ] A test drives a serial step dispatch with a fake provider that blocks mid-attempt and asserts the daemon log contains the "«step» on «provider»" line while the attempt is still blocked.
- [ ] A test drives a recovery-session dispatch and asserts the same line is written to the feature's scoped daemon log.

## Story 2: Interactive terminal view names the provider when a serial step attempt begins

**Requirement:** FR-2

As an operator running an interactive conduct session, I want the terminal to name the provider when a step's attempt begins so that I can see which provider is running without opening the event history.

### Acceptance Criteria

#### Happy Path
- Given an interactive conduct run of the serial step stories routed to claude, when the claude attempt begins executing, then the terminal view shows a line containing "stories on claude" before that step's completion line.
- Given a step dispatched in interactive mode where the provider takes over the operator's terminal, when the attempt begins, then the provider-start line is printed before the provider takes over the terminal.

#### Negative Paths
- Given a step dispatched in interactive mode where no live stream observation is created, when the attempt begins, then the provider-start line is still printed.
- Given the terminal view's sticky region is suspended because a step is running, when the provider-start line is rendered, then it is printed as a plain line and the step's running indicator is not lost when the region resumes.

### Done When
- [ ] A test feeds a step start followed by a provider-start event into the terminal renderer and asserts the rendered output contains "«step» on «provider»".
- [ ] A test of an interactive-mode dispatch asserts the provider-start event is emitted even though no stream observer was created for that candidate.

## Story 3: Parallel group members are labelled with their group, member, and provider

**Requirement:** FR-3

As an operator watching a run with a parallel group, I want each member's provider-start line to name the member and its group so that I can tell which member a provider belongs to.

### Acceptance Criteria

#### Happy Path
- Given a configured parallel group review with member security routed to codex, when the member's attempt begins, then both the daemon log and the terminal view show a line containing "review / security on codex".
- Given the built-in validation group, when its prd_audit member's attempt begins on claude, then both live surfaces show a line naming prd_audit and claude.

#### Negative Paths
- Given a configured member whose name matches a serial step name, when the member's attempt begins, then its line carries the group label and is distinguishable from a serial dispatch of that step.
- Given a member that is skipped and never dispatched, when the group runs, then no provider-start line is shown for that member.

### Done When
- [ ] A test of a configured parallel group asserts each member's provider-start event carries its group and member identity and renders as "«group» / «member» on «provider»" on both surfaces.
- [ ] A test asserts a skipped member produces no provider-start event.

## Story 4: Concurrent members on different providers stay distinguishable

**Requirement:** FR-4

As an operator watching parallel fan-out, I want two members running at the same time on different providers to each show their own provider so that I never misattribute work.

### Acceptance Criteria

#### Happy Path
- Given two members of one group executing concurrently with member A on claude and member B on codex, when both attempts have begun, then member A's line names claude and member B's line names codex on both surfaces.

#### Negative Paths
- Given two concurrent members whose attempts begin in interleaved order, when their lines are rendered, then neither member's line names the other member's provider.
- Given two concurrent members of the same group both routed to claude, when both attempts begin, then two separate lines are shown, one per member.

### Done When
- [ ] A test runs two members concurrently with interleaved start events and asserts each rendered line pairs the correct member with its own provider.

## Story 5: A fallback shows the provider that took over

**Requirement:** FR-5

As an operator, I want a mid-step fallback to produce a new provider line so that the display reflects the provider now executing.

### Acceptance Criteria

#### Happy Path
- Given a step whose ladder is claude then codex, when claude fails after beginning and codex begins executing, then both live surfaces show a second line naming codex for that step after the existing fallback notice.
- Given a parallel member that falls back from claude to codex, when codex begins executing, then the new line names that member's group, member, and codex.

#### Negative Paths
- Given a fallback has occurred, when the latest provider-start line for that step is read, then it names codex and not claude.
- Given a fallback within one member, when the other concurrent members' lines are read, then their providers are unchanged.

### Done When
- [ ] A test drives a two-candidate ladder where the first candidate fails after starting and asserts two provider-start events in order, the second naming the fallback provider.
- [ ] A test asserts a fallback in one member does not emit a provider-start event attributed to another member.

## Story 6: Only a provider that actually begins executing is shown

**Requirement:** FR-6

As an operator, I want the line to name the provider that really began executing, not one that was preferred or skipped, so that the display is trustworthy.

### Acceptance Criteria

#### Happy Path
- Given a step whose preferred provider is claude and claude is invoked, when the attempt begins, then the line names claude.

#### Negative Paths
- Given a step whose preferred provider claude is skipped as setup-unavailable and codex is then invoked, when the attempts are processed, then no provider-start line names claude and one provider-start line names codex.
- Given a step whose preferred provider is skipped as cached run-wide unavailable, when the attempts are processed, then no provider-start line is shown for the skipped provider.

### Done When
- [ ] A test with a skipped first candidate asserts no provider-start event for that candidate and exactly one for the invoked candidate.

## Story 7: The model is shown when known and omitted otherwise

**Requirement:** FR-7

As an operator, I want the model shown next to the provider when it is known so that I can see the cost tier in use.

### Acceptance Criteria

#### Happy Path
- Given an attempt that begins on claude with model opus resolved, when its line is rendered, then the line shows claude and opus.
- Given a provider whose model ladder moves to a second model within the same provider, when the second model begins executing, then a new line shows the provider with the second model.

#### Negative Paths
- Given an attempt that begins with no model resolved, when its line is rendered, then the line shows the provider alone with no placeholder model text such as "undefined" or empty parentheses.

### Done When
- [ ] A renderer test asserts the model appears when present and that no "undefined", "null", or "()" text appears when it is absent.
- [ ] A test of a within-provider model ladder asserts a second provider-start event carrying the second model.

## Story 8: An undeterminable provider is shown explicitly as unknown

**Requirement:** FR-8

As an operator, I want an attempt whose provider cannot be determined to say so explicitly so that I never act on a blank or stale value.

### Acceptance Criteria

#### Happy Path
- Given a provider-backed attempt begins and its provider cannot be determined, when the line is rendered, then both surfaces show the step and the text "provider unknown".

#### Negative Paths
- Given an earlier attempt of the same step named claude, when a later attempt begins with an undeterminable provider, then the later line shows "provider unknown" and does not name claude.
- Given an attempt with an undeterminable provider, when the line is rendered, then the provider portion is never blank.
- Given an attempt with an undeterminable provider, when telemetry is exported, then the unknown state never appears as a provider label value.

### Done When
- [ ] A test emits a start with an undeterminable provider after a known one and asserts the rendered line shows "provider unknown" without the earlier provider name.
- [ ] A test asserts the persisted event records the unknown state explicitly rather than omitting the provider.
- [ ] A test asserts no exported telemetry carries the unknown state as a provider label value.

## Story 9: Steps that dispatch no provider show no provider line

**Requirement:** FR-9

As an operator, I want mechanical steps to show nothing about providers so that "unknown" is reserved for a real gap.

### Acceptance Criteria

#### Happy Path
- Given a run that executes a mechanical step that dispatches no provider, when the step completes, then neither live surface shows a provider-start line for it.

#### Negative Paths
- Given a mechanical step, when it runs, then neither surface shows "provider unknown" for it.
- Given a mechanical step, when the run's event history is read, then it contains no provider-start record for that step.

### Done When
- [ ] A test runs a step that dispatches no provider and asserts zero provider-start events and no rendered provider line for it.

## Story 10: A single-provider serial run gains at most one line per step

**Requirement:** FR-10

As an operator, I want a plain single-provider run to stay quiet so that the new identification does not become noise.

### Acceptance Criteria

#### Happy Path
- Given a serial run on a single provider with no fallback, when a provider-backed step runs to completion, then each live surface shows exactly one provider-start line for that step.

#### Negative Paths
- Given a long-running step emitting many live progress updates, when the step runs, then no further provider-start line is printed for it during the attempt.
- Given a single-provider serial run, when the step completes, then the existing completion line is unchanged apart from no added duplicate provider line.
- Given a single-provider serial run in the daemon log, when a step attempt begins, then the existing provider lifecycle running line is still printed unchanged and the provider-start line is the only added line.

### Done When
- [ ] A test runs a single-provider serial step with repeated progress events and asserts exactly one provider-start line on each surface.
- [ ] A daemon-log test asserts the lifecycle running line is still present and unchanged alongside the single provider-start line.

## Story 11: Provider starts are recorded in the event history

**Requirement:** FR-11

As an operator doing post-run analysis, I want the start of each attempt and its provider recorded so that I can reconstruct which provider ran when.

### Acceptance Criteria

#### Happy Path
- Given a run with a fallback, when the run's event history is read afterwards, then it contains one provider-start record per begun attempt with its step, provider, member identity when applicable, and a timestamp, in order.

#### Negative Paths
- Given an event history written before this feature, when it is read by the existing history consumers, then it is read without error and no provider-start records are invented.
- Given the persister cannot write the event history, when a provider-start record is emitted, then the step proceeds and the existing persistence-failure handling applies unchanged.
- Given a run whose history contains provider-start records, when cost, usage, and running-work accounting are computed, then their results are identical to the same run without provider-start records.

### Done When
- [ ] A test reads the persisted history after a fallback run and asserts ordered provider-start records with step, provider, member identity, and timestamp.
- [ ] A test feeds a pre-feature history file to the existing history readers and asserts no error.
- [ ] A test computes cost, usage, and running-work results over a history with and without provider-start records and asserts they are identical.

## Story 12: Provider identification never disturbs the step

**Requirement:** FR-1, FR-2, FR-3

As an operator, I want displaying the provider never to delay, fail, or retry a step so that observability cannot break execution.

### Acceptance Criteria

#### Happy Path
- Given a step whose provider-start line renders normally, when the attempt runs, then the step's outcome and timing are unchanged from a run without the line.

#### Negative Paths
- Given a renderer that throws while rendering the provider-start line, when the attempt begins, then the step still executes to its normal outcome and no retry or halt is recorded because of the render failure.
- Given an event listener that is slow to process the provider-start record, when the attempt begins, then the provider dispatch is not held waiting on that listener.

### Done When
- [ ] A test with a throwing renderer asserts the step completes with its normal status and no step_retry or halt caused by the render failure.
- [ ] A test asserts provider dispatch is reached without awaiting the provider-start listeners.
