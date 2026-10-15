# Coherence: Live provider identification per attempt (#1268)

**Plan:** .docs/plans/running-provider-is-invisible-per-step-and-absent-.md
**Stories:** .docs/stories/running-provider-is-invisible-per-step-and-absent-.md
**PRD:** .docs/specs/running-provider-is-invisible-per-step-and-absent-.md
**Track:** product. **Tier:** M.
**Source-Ref:** jstoup111/ai-conductor#1268

No ADR file is in this spec's change set (the architecture review reused existing APPROVED ADRs), so there are no adr rows and no Architecture Obligation Coverage table. Outcome quotes are the staged bullets from `.pipeline/intake-outcomes.md`.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1, story-2 | covered | While a step is running, the operator can see which provider is executing it — not only after it completes, and not only when a fallback fires. |
| outcome | outcome-2 | story-3, story-4 | covered | Every member of a parallel group shows its own provider concurrently, so two members running on different providers are distinguishable while both are in flight. |
| outcome | outcome-3 | story-5, story-6 | covered | The provider shown is the one that actually executed the work, and when a fallback changes it mid-step the displayed value reflects the change. |
| outcome | outcome-4 | story-8, story-9 | covered | Negative path: when provider routing is inactive or the provider cannot be determined, the display says so explicitly rather than showing a stale, blank, or guessed value. |
| outcome | outcome-5 | story-10 | covered | Negative path: a serial run with a single provider gains no extra noise per step beyond the provider identification itself. |
| fr | fr-1 | story-1, story-12 | covered | FR-1 is cited by the Requirement line of Story 1, Story 12. |
| fr | fr-2 | story-2, story-12 | covered | FR-2 is cited by the Requirement line of Story 2, Story 12. |
| fr | fr-3 | story-3, story-12 | covered | FR-3 is cited by the Requirement line of Story 3, Story 12. |
| fr | fr-4 | story-4 | covered | FR-4 is cited by the Requirement line of Story 4. |
| fr | fr-5 | story-5 | covered | FR-5 is cited by the Requirement line of Story 5. |
| fr | fr-6 | story-6 | covered | FR-6 is cited by the Requirement line of Story 6. |
| fr | fr-7 | story-7 | covered | FR-7 is cited by the Requirement line of Story 7. |
| fr | fr-8 | story-8 | covered | FR-8 is cited by the Requirement line of Story 8. |
| fr | fr-9 | story-9 | covered | FR-9 is cited by the Requirement line of Story 9. |
| fr | fr-10 | story-10 | covered | FR-10 is cited by the Requirement line of Story 10. |
| fr | fr-11 | story-11 | covered | FR-11 is cited by the Requirement line of Story 11. |
| story | story-1 | task-5, task-7 | covered | Daemon log names the provider when a serial step attempt begins (cites FR-1). |
| story | story-2 | task-6 | covered | Interactive terminal view names the provider when a serial step attempt begins (cites FR-2). |
| story | story-3 | task-3, task-8 | covered | Parallel group members are labelled with their group, member, and provider (cites FR-3). |
| story | story-4 | task-9 | covered | Concurrent members on different providers stay distinguishable (cites FR-4). |
| story | story-5 | task-10 | covered | A fallback shows the provider that took over (cites FR-5). |
| story | story-6 | task-2 | covered | Only a provider that actually begins executing is shown (cites FR-6). |
| story | story-7 | task-4 | covered | The model is shown when known and omitted otherwise (cites FR-7). |
| story | story-8 | task-1 | covered | An undeterminable provider is shown explicitly as unknown (cites FR-8). |
| story | story-9 | task-11 | covered | Steps that dispatch no provider show no provider line (cites FR-9). |
| story | story-10 | task-14 | covered | A single-provider serial run gains at most one line per step (cites FR-10). |
| story | story-11 | task-12 | covered | Provider starts are recorded in the event history (cites FR-11). |
| story | story-12 | task-13 | covered | Provider identification never disturbs the step (cites FR-1, FR-2, FR-3). |
| task | task-1 | story-8 | covered | Declare the provider_attempt_started event and its sink row. |
| task | task-2 | story-6 | covered | Fire onCandidateStart from the candidate executor. |
| task | task-3 | story-3 | covered | Map onCandidateStart to the event on every dispatch path. |
| task | task-4 | story-7 | covered | Shared provider-start line formatter and daemon-log rendering. |
| task | task-5 | story-1 | covered | Render provider starts on recovery-session daemon logs. |
| task | task-6 | story-2 | covered | Render provider starts in the interactive terminal renderer. |
| task | task-7 | story-1 | covered | Serial dispatch shows the provider live on both surfaces. |
| task | task-8 | story-3 | covered | Parallel members are labelled with group, member and provider. |
| task | task-9 | story-4 | covered | Concurrent members stay distinguishable. |
| task | task-10 | story-5 | covered | Fallback, skipped candidates and model rungs on the live surfaces. |
| task | task-11 | story-9 | covered | No provider line for mechanical steps. |
| task | task-12 | story-11 | covered | Persisted starts are ordered and never alter accounting. |
| task | task-13 | story-12 | covered | Provider identification never disturbs the step. |
| task | task-14 | story-10 | covered | A single-provider serial run gains exactly one line per step. |

## Criteria

| Row class | Criterion | Task id(s) | Verdict | Done when quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Story 1 happy: Given a daemon feature dispatch of the serial step prd routed to claude, when the claude attempt begins executing, then the feature's daemon log shows a line containing "prd on claude" before that attempt's completion line. | 7 | covered | "writes a daemon-log line containing `prd on claude` while the attempt is still blocked and before its completion line" | diff-local |
| criterion | Story 1 happy: Given a daemon feature dispatch of the serial step plan routed to codex, when the codex attempt begins executing, then the feature's daemon log shows a line containing "plan on codex" before that attempt's completion line. | 7 | covered | "writes a daemon-log line containing `plan on codex` before that attempt's completion line" | diff-local |
| criterion | Story 1 negative: Given a provider attempt that is still executing and has not completed, when the daemon log is read, then the provider-start line for that attempt is already present rather than appearing only after completion. | 7 | covered | "while the attempt is still blocked" | diff-local |
| criterion | Story 1 negative: Given a recovery-session dispatch for a retained feature, when its provider attempt begins executing, then the provider-start line appears on that feature's daemon log exactly as for a normal feature dispatch. | 5 | covered | "writes the `«step» on «provider»` provider-start line to that feature's daemon log exactly as a normal feature dispatch writes it" | diff-local |
| criterion | Story 2 happy: Given an interactive conduct run of the serial step stories routed to claude, when the claude attempt begins executing, then the terminal view shows a line containing "stories on claude" before that step's completion line. | 7 | covered | "prints `stories on claude` to the TerminalRenderer before the fake runtime's invoke is entered and before the completion line" | diff-local |
| criterion | Story 2 happy: Given a step dispatched in interactive mode where the provider takes over the operator's terminal, when the attempt begins, then the provider-start line is printed before the provider takes over the terminal. | 7 | covered | "before the fake runtime's invoke is entered" | diff-local |
| criterion | Story 2 negative: Given a step dispatched in interactive mode where no live stream observation is created, when the attempt begins, then the provider-start line is still printed. | 7 | covered | "with no stream observer created" | diff-local |
| criterion | Story 2 negative: Given the terminal view's sticky region is suspended because a step is running, when the provider-start line is rendered, then it is printed as a plain line and the step's running indicator is not lost when the region resumes. | 6 | covered | "with the live region suspended, the provider-start line is written as a plain line, and after resume the current step's running indicator is still rendered" | diff-local |
| criterion | Story 3 happy: Given a configured parallel group review with member security routed to codex, when the member's attempt begins, then both the daemon log and the terminal view show a line containing "review / security on codex". | 8 | covered | "produces a daemon-log line and a terminal line each containing `review / security on codex`" | diff-local |
| criterion | Story 3 happy: Given the built-in validation group, when its prd_audit member's attempt begins on claude, then both live surfaces show a line naming prd_audit and claude. | 8 | covered | "produces on both surfaces a line containing `prd_audit on claude`" | diff-local |
| criterion | Story 3 negative: Given a configured member whose name matches a serial step name, when the member's attempt begins, then its line carries the group label and is distinguishable from a serial dispatch of that step. | 8 | covered | "renders as `«group» / plan on «provider»`, distinguishable from the bare `plan on «provider»` that a serial plan dispatch renders" | diff-local |
| criterion | Story 3 negative: Given a member that is skipped and never dispatched, when the group runs, then no provider-start line is shown for that member. | 8 | covered | "a member skipped before dispatch emits no provider_attempt_started event and renders no provider-start line on either surface" | diff-local |
| criterion | Story 4 happy: Given two members of one group executing concurrently with member A on claude and member B on codex, when both attempts have begun, then member A's line names claude and member B's line names codex on both surfaces. | 9 | covered | "render on both surfaces exactly one line for A naming claude and one for B naming codex" | diff-local |
| criterion | Story 4 negative: Given two concurrent members whose attempts begin in interleaved order, when their lines are rendered, then neither member's line names the other member's provider. | 9 | covered | "with starts forced in the order B then A" | diff-local |
| criterion | Story 4 negative: Given two concurrent members of the same group both routed to claude, when both attempts begin, then two separate lines are shown, one per member. | 9 | covered | "render two separate provider-start lines on both surfaces, one labelled with each member" | diff-local |
| criterion | Story 5 happy: Given a step whose ladder is claude then codex, when claude fails after beginning and codex begins executing, then both live surfaces show a second line naming codex for that step after the existing fallback notice. | 10 | covered | "renders on both surfaces a second line `«step» on codex` after the PROVIDER FALLBACK notice" | diff-local |
| criterion | Story 5 happy: Given a parallel member that falls back from claude to codex, when codex begins executing, then the new line names that member's group, member, and codex. | 10 | covered | "a configured member falling back from claude to codex renders `«group» / «member» on codex` on both surfaces" | diff-local |
| criterion | Story 5 negative: Given a fallback has occurred, when the latest provider-start line for that step is read, then it names codex and not claude. | 10 | covered | "the last provider-start line for the step names codex and not claude" | diff-local |
| criterion | Story 5 negative: Given a fallback within one member, when the other concurrent members' lines are read, then their providers are unchanged. | 10 | covered | "while a concurrent sibling member's only provider-start line still names its own provider and no provider_attempt_started event is attributed to the sibling" | diff-local |
| criterion | Story 6 happy: Given a step whose preferred provider is claude and claude is invoked, when the attempt begins, then the line names claude. | 10 | covered | "while a dispatch invoking preferred claude renders a line naming claude" | diff-local |
| criterion | Story 6 negative: Given a step whose preferred provider claude is skipped as setup-unavailable and codex is then invoked, when the attempts are processed, then no provider-start line names claude and one provider-start line names codex. | 10 | covered | "skipped as setup-unavailable" | diff-local |
| criterion | Story 6 negative: Given a step whose preferred provider is skipped as cached run-wide unavailable, when the attempts are processed, then no provider-start line is shown for the skipped provider. | 10 | covered | "one skipped as cached run-wide unavailable, renders no provider-start line naming claude and exactly one naming codex on the daemon log" | diff-local |
| criterion | Story 7 happy: Given an attempt that begins on claude with model opus resolved, when its line is rendered, then the line shows claude and opus. | 4 | covered | "renders provider claude with model opus as a line containing both `claude` and `opus`" | diff-local |
| criterion | Story 7 happy: Given a provider whose model ladder moves to a second model within the same provider, when the second model begins executing, then a new line shows the provider with the second model. | 10 | covered | "renders a second daemon-log provider-start line naming claude and the second model" | diff-local |
| criterion | Story 7 negative: Given an attempt that begins with no model resolved, when its line is rendered, then the line shows the provider alone with no placeholder model text such as "undefined" or empty parentheses. | 4 | covered | "with no model renders the provider with no `undefined`, `null`, or `()` text" | diff-local |
| criterion | Story 8 happy: Given a provider-backed attempt begins and its provider cannot be determined, when the line is rendered, then both surfaces show the step and the text "provider unknown". | 4, 6 | covered | "renders an unknown start as `«step» provider unknown`" | diff-local |
| criterion | Story 8 negative: Given an earlier attempt of the same step named claude, when a later attempt begins with an undeterminable provider, then the later line shows "provider unknown" and does not name claude. | 4 | covered | "rendered after a claude start for the same step the unknown line contains no `claude`" | diff-local |
| criterion | Story 8 negative: Given an attempt with an undeterminable provider, when the line is rendered, then the provider portion is never blank. | 4 | covered | "with a non-empty provider portion" | diff-local |
| criterion | Story 8 negative: Given an attempt with an undeterminable provider, when telemetry is exported, then the unknown state never appears as a provider label value. | 1 | covered | "so OTel wiring subscribes no handler and no exported metric or span carries its provider value" | diff-local |
| criterion | Story 9 happy: Given a run that executes a mechanical step that dispatches no provider, when the step completes, then neither live surface shows a provider-start line for it. | 11 | covered | "renders neither a provider-start line nor `provider unknown` for it on the daemon log or the terminal" | diff-local |
| criterion | Story 9 negative: Given a mechanical step, when it runs, then neither surface shows "provider unknown" for it. | 11 | covered | "renders neither a provider-start line nor `provider unknown` for it" | diff-local |
| criterion | Story 9 negative: Given a mechanical step, when the run's event history is read, then it contains no provider-start record for that step. | 11 | covered | "persists zero provider_attempt_started records for it" | diff-local |
| criterion | Story 10 happy: Given a serial run on a single provider with no fallback, when a provider-backed step runs to completion, then each live surface shows exactly one provider-start line for that step. | 14 | covered | "renders exactly one provider-start line on the daemon log and exactly one on the terminal during the attempt" | diff-local |
| criterion | Story 10 negative: Given a long-running step emitting many live progress updates, when the step runs, then no further provider-start line is printed for it during the attempt. | 14 | covered | "a single-provider serial step emitting repeated provider_stream_progress events renders exactly one provider-start line" | diff-local |
| criterion | Story 10 negative: Given a single-provider serial run, when the step completes, then the existing completion line is unchanged apart from no added duplicate provider line. | 14 | covered | "the step's completion line and the daemon-log lifecycle `provider running` line are each byte-identical and still present" | diff-local |
| criterion | Story 10 negative: Given a single-provider serial run in the daemon log, when a step attempt begins, then the existing provider lifecycle running line is still printed unchanged and the provider-start line is the only added line. | 14 | covered | "so the provider-start line is the only added line" | diff-local |
| criterion | Story 11 happy: Given a run with a fallback, when the run's event history is read afterwards, then it contains one provider-start record per begun attempt with its step, provider, member identity when applicable, and a timestamp, in order. | 12 | covered | "contains one provider_attempt_started record per begun attempt in begin order, each carrying step, provider, ts, and executionContext with member identity for a member dispatch" | diff-local |
| criterion | Story 11 negative: Given an event history written before this feature, when it is read by the existing history consumers, then it is read without error and no provider-start records are invented. | 12 | covered | "is read by cost-rollup, dispatch-metering, timing-rollup, and daemon-dashboard without error and yields no provider-start data" | diff-local |
| criterion | Story 11 negative: Given the persister cannot write the event history, when a provider-start record is emitted, then the step proceeds and the existing persistence-failure handling applies unchanged. | 12 | covered | "with the EventPersister append failing, a dispatch still reaches its normal step outcome and the persister's existing failure handling is invoked unchanged" | diff-local |
| criterion | Story 11 negative: Given a run whose history contains provider-start records, when cost, usage, and running-work accounting are computed, then their results are identical to the same run without provider-start records. | 12 | covered | "produce identical results over a history with and without provider_attempt_started records" | diff-local |
| criterion | Story 12 happy: Given a step whose provider-start line renders normally, when the attempt runs, then the step's outcome and timing are unchanged from a run without the line. | 13 | covered | "the step's completion status and its step_completed observed duration under a fake clock with provider-start rendering active are each identical to the same dispatch with no provider_attempt_started listener" | diff-local |
| criterion | Story 12 negative: Given a renderer that throws while rendering the provider-start line, when the attempt begins, then the step still executes to its normal outcome and no retry or halt is recorded because of the render failure. | 13 | covered | "the step completes with its normal status and no step_retry or HALT is recorded because of the render failure" | diff-local |
| criterion | Story 12 negative: Given an event listener that is slow to process the provider-start record, when the attempt begins, then the provider dispatch is not held waiting on that listener. | 13 | covered | "the fake runtime's invoke is still entered and the step completes with its normal status" | diff-local |

## Achievability notes

Every criterion row was judged against its cited `Done when` checks and the approved architecture review:
- The start line precedes invocation because `ConductorEventEmitter.emit` runs handlers synchronously before its first await, and the executor calls `onCandidateStart` synchronously inside `invokeModel`, immediately before each rung's runtime invocation (plan Technical Approach; Tasks 2, 7).
- Member attribution reaches the line because `executeProviderCandidates` already receives `executionContext` and passes it to the start callback (Tasks 2, 3, 8, 9).
- The closed `ProviderStartIdentity` set (`known` / `unknown`) represents every required scenario. Mechanical steps emit no event at all, so the required absence (Story 9) needs no extra state (Tasks 1, 11).
- Recovery dispatches render because `createSlugScopedProviderExecution` calls the exported `subscribeScopedProviderRendering`, which subscribes the new type (Task 5). Every executor caller forwards `onCandidateStart`: `StepRunners`, the project prelude and `runPlanReview` (Task 3).
- A cached build-review rubric result never announces a provider, because the callback fires inside the per-rung runtime call, not before the `onModelRung` cache decision (Task 2).

No criterion row is `fail` or `gap`.
