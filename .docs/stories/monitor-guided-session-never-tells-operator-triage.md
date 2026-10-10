**Status:** Accepted

# Stories: Monitor guided session triage-complete quit cue

Source: jstoup111/ai-conductor#2986. Track: technical (no PRD). Tier: S.

`conduct monitor` opens one operator-owned provider session per queued halt and advances to the
next halt only when that session's process exits. These stories give the operator an explicit,
correctly-timed signal that triage is finished and that quitting returns them to the queue —
without changing how sessions are launched, ordered, or ended.

## Story 1: Monitor guided-session opening prompt declares monitor hosting and the quit instruction

**Requirement:** #2986 desired outcomes 1, 2, 4

As an operator working the monitor queue, I want each guided session to know it is hosted by the
monitor and how I quit it, so that the session can tell me at the right moment that quitting
returns me to the next halt.

### Acceptance Criteria

#### Happy Path
- Given a queued halt and guided-session provider `claude`, when the monitor opens the guided session, then the opening prompt states that the session is hosted by the `conduct monitor` queue, that quitting the session returns the operator to the monitor queue, and that the quit instruction is `/quit`.
- Given a queued halt and guided-session provider `codex`, when the monitor opens the guided session, then the opening prompt states the same monitor-hosting and return-to-queue facts and names `/quit` as the quit instruction.
- Given a queued halt with project, slug, reason, and classification, when the monitor opens the guided session, then the opening prompt still carries the provider-prefixed `daemon-triage` invocation, the project, feature, reason, classification, and recovery procedure lines it carried before this change.

#### Negative Paths
- Given a guided-session provider whose catalog entry declares no quit instruction, when the opening prompt is built, then the prompt tells the session to direct the operator to end the session with that provider's normal exit control and names no specific quit command — it never names another provider's command.
- Given a halt whose reason text itself contains `/quit` or the words "monitor queue", when the opening prompt is built, then the monitor-hosting declaration and quit instruction appear exactly once, in their fixed position, independent of the reason text.

### Done When
- [ ] `session.test.ts` asserts the Claude opening prompt contains the monitor-hosting declaration, the return-to-queue statement, and `/quit`.
- [ ] `session.test.ts` asserts the Codex opening prompt contains the same declaration and `/quit`.
- [ ] `session.test.ts` asserts a provider with no declared quit instruction yields the generic exit wording and no `/quit` or other command literal.
- [ ] Existing `session.test.ts` assertions on the invocation, project, feature, reason, classification, and recovery lines pass unchanged.

## Story 2: daemon-triage tells the operator triage is complete only in a monitor-hosted session, only when nothing is pending

**Requirement:** #2986 desired outcomes 1, 3, 4

As an operator in a monitor-launched triage session, I want an explicit "triage complete" message
once diagnosis is reported and every approved action is done or declined, so that I know it is
safe to quit and move to the next halt — and I never see it while recovery is still in flight.

### Acceptance Criteria

#### Happy Path
- Given a monitor-hosted triage session that ends diagnosis-only (triage report written, no mutation proposed or the operator approved none), when triage reaches its end, then the session's final message states that triage for the feature is complete and that quitting with the opening prompt's quit instruction returns the operator to the monitor queue.
- Given a monitor-hosted triage session where every approved action has completed and been appended to *Actions taken*, when the last approved action's result is reported, then the session's final message carries the same triage-complete and quit-to-return-to-queue statement.
- Given a monitor-hosted triage session where the operator declined every remaining proposed action, when the decline is acknowledged, then the session's final message carries the triage-complete and quit-to-return-to-queue statement.

#### Negative Paths
- Given a monitor-hosted triage session with a proposed mutation awaiting the operator's approval, when the session yields to the operator, then its message ends with the approval request and contains no triage-complete or quit statement.
- Given a monitor-hosted triage session where an approved action is still running or its result is not yet appended to *Actions taken*, when the session reports progress, then it contains no triage-complete or quit statement.
- Given a monitor-hosted triage session where an approved action failed and the skill has proposed a follow-up action, when the session yields to the operator, then it contains no triage-complete statement until that follow-up is completed or declined.
- Given an operator invokes `daemon-triage` directly (not through the monitor's opening prompt), when triage reaches its end, then the session's final message contains no monitor-queue wording and no instruction to quit to return to a queue.

### Done When
- [ ] `skills/daemon-triage/SKILL.md` contains a closing practice that applies only when the session was opened by the monitor's opening prompt, defines completion as report written plus every approved action completed-and-recorded or declined with none pending or awaiting approval, and specifies the triage-complete message naming the quit instruction from the opening prompt and the return to the monitor queue.
- [ ] That closing practice explicitly forbids the message while any mutation awaits approval or any approved action is unfinished or unrecorded, and forbids monitor-queue wording when the session was not monitor-hosted.
- [ ] The skill's Verification checklist carries an item for the monitor-hosted completion cue and its two exclusions (pending work; non-monitor session).
- [ ] `test/test_harness_integrity.sh` passes with the edited skill.
