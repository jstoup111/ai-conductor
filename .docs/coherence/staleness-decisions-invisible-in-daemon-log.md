# Coherence: staleness-decisions-invisible-in-daemon-log

Plan stem: staleness-decisions-invisible-in-daemon-log
Track: technical (no PRD, so no FR layer)
Tier: M
Source: jstoup111/ai-conductor#982

Traceability mapping from the staged intake outcomes through stories to plan tasks.

The intake carries six desired-outcome bullets. The operator narrowed this spec to
**outcome 5 only**; outcomes 1, 2, 3, 4 and 6 are already satisfied on `main` by commits
`3efb0e63` (wiring evidence re-derivation, #897) and `8c12993b` (engine-computed steps get a
retry budget of 1, #982), and are therefore not covered by these stories. They are waived
explicitly in `.docs/coherence-waivers/staleness-decisions-invisible-in-daemon-log.md` rather
than claimed as covered — an affirmative row for work this spec does not do would be a false
claim.

| rowClass | id | citedIds | verdict | quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-5 | story-1, story-2 | covered | When a step is rejected for staleness, the log distinguishes which of the two classes |
| story | story-1 | task-2, task-5 | covered | A preserved verdict is reported, not silent |
| story | story-2 | task-2, task-5 | covered | An invalidated verdict is reported as a real rejection |
| story | story-3 | task-3, task-5 | covered | Adding an event type without declaring its sinks fails the build |
| story | story-4 | task-1, task-4 | covered | The refactor changes no event routing except verdict_freshness |
| story | story-5 | task-4 | covered | The audit trail records the outcome its doc comment promised |
| task | task-1 | story-4 | covered | Pin the pre-refactor sink sets |
| task | task-2 | story-1, story-2 | covered | The outcome discriminator |
| task | task-3 | story-3 | covered | The event-sink registry |
| task | task-4 | story-4, story-5 | covered | Derive the sinks from the registry |
| task | task-5 | story-1, story-2, story-3 | covered | Render the distinction in daemon.log |
| task | task-6 | story-1, story-2, story-3, story-4, story-5 | supporting | Docs, changelog, release gate, full validation |

## Notes

Outcome 5 is discharged by two stories rather than one because the outcome names two classes
that must become distinguishable: story 1 makes the *preserved* class reportable (it is
currently silent — three of four preserve paths return a bare done:true), and story 2 makes
the *invalidated* class explicitly labelled rather than merely the default. Neither alone
produces a distinction.

Stories 3, 4 and 5 are not directly cited by an outcome bullet. They exist because outcome 5
cannot be delivered durably without them: story 3 stops the next event type from being born
dead the way verdict_freshness was, story 4 pins the refactor as behavior-neutral for the
other 56 event types, and story 5 completes the audit-trail wiring that
`adr-2026-07-13-session-fresh-verdict-artifacts.md` D2 already decided and never built. They
are supporting scope for outcome 5, not independent outcomes, which is why they carry no
outcome row.

Task 6 is infrastructure — documentation, changelog and release-gate compliance — and cites
no single story; it supports all five.
