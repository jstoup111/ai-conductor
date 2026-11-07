**Status:** Accepted

# Stories: Stack preflight refusals end the run with no HALT or reason (#3446)

Technical track, Tier S. Scope boundary: `.docs/track/stack-preflight-refusals-end-the-run-with-no-halt-.md`.
Every stack preflight result that stops a run states its specific reason durably, for all three
entry points that run it: the conductor's resume path, the rebase step, and the daemon re-kick.

## Story 1: An unavailable preflight halts with its specific reason

**Requirement:** #3446 desired outcomes 1–3

As an operator, I want a stack preflight that cannot proceed to leave a HALT naming why, so that a
routing-state fault is diagnosable without replaying engine code in a scratch clone.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature with no live `.pipeline/HALT` whose routed round reconciliation reports unavailable with detail `round advance cas-failed`, when the stack preflight runs from the conductor's resume path, then `.pipeline/HALT` is written with disposition needs-human and its first line contains `round advance cas-failed`, and `.pipeline/events.jsonl` gains a `loop_halt` event whose reason contains `round advance cas-failed`.
- Given the same feature dispatched by the daemon, when the dispatch ends, then the daemon reports the feature halted with a reason containing `round advance cas-failed` and its log does not contain `loop ended without DONE or HALT marker`.

#### Negative Paths
- Given a stack preflight that reports unavailable for any other cause (routed receipt ledger, routing outbox drain, revalidation queue, or a lost base-refresh follow-on), when it stops the run, then the HALT's first line and the `loop_halt` reason both contain that cause's own detail text, not a generic `stack preflight unavailable` alone.
- Given the HALT write fails (for example `.pipeline/HALT` cannot be written), when the preflight stops, then the failure is not swallowed: the dispatch's daemon reason names both the preflight detail and the write failure, and the daemon log does not contain `loop ended without DONE or HALT marker`.

### Done When
- [ ] `StackPreflightResult`'s `unavailable` arm declares a required `detail: string`, and every `unavailable` return in `restack/stack-preflight.ts` supplies a non-empty cause-specific detail.
- [ ] A test drives `runStackPreflight` with an injected `reconcileRounds` returning `{ kind: 'unavailable', detail: 'round advance cas-failed' }` and asserts the HALT file's first line and the persisted `loop_halt` reason both contain `round advance cas-failed`.
- [ ] A test asserts a failed HALT write surfaces an error naming the preflight detail rather than returning a silent stop.

## Story 2: A routed resume-exit refusal halts with the exit's reason

**Requirement:** #3446 desired outcomes 1–2

As an operator, I want a resumed routed exit that refuses without writing a marker to leave a HALT
naming its cause, so that a routed-exit refusal is distinguishable from any other stop. (Restack,
recovery, and move refusals inside the preflight already write their own HALT; Story 3 governs those.)

### Acceptance Criteria

#### Happy Path
- Given a resumed routed round whose exit refuses with detail `routed exit host 2: leaf compare-and-swap cas-failed` and writes no HALT itself, when the stack preflight's resume-exit stops the run, then `.pipeline/HALT` is written needs-human with that detail in its first line and a `loop_halt` event carries the same detail.

#### Negative Paths
- Given a preflight refusal whose detail would be empty, when it stops the run, then the HALT's first line still names the refusing preflight stage (for example `stack preflight: routed exit refused`) and is never blank.

### Done When
- [ ] `StackPreflightResult`'s `halted` arm declares a required `detail: string`; every `halted` return in `restack/stack-preflight.ts` supplies one, and the resume-exit arm forwards `exited.detail`.
- [ ] A test with a `requestRoutedExit` refusal that writes no marker asserts the HALT first line and `loop_halt` reason contain the exit's detail.

## Story 3: An existing HALT is never overwritten

**Requirement:** #3446 desired outcome 1

As an operator, I want the precise HALT a restack, recovery, or earlier stop already wrote to stay
intact, so that the guarantee never replaces a specific reason with a less specific one.

### Acceptance Criteria

#### Happy Path
- Given a restack conflict inside the preflight that wrote its own HALT naming the conflicting child and paths, when the preflight returns its stop, then `.pipeline/HALT` is byte-identical to what the restack wrote and `events.jsonl` carries a `loop_halt` whose reason contains that HALT's first line.
- Given a live HALT with no matching resume authorization, when the preflight refuses to cross it, then the existing HALT is unchanged and a `loop_halt` event's reason contains both `live HALT without resume authorization` and the existing HALT's first line.

#### Negative Paths
- Given a preflight result of `clear`, `no-stack`, `recovered`, `repaired`, `navigate-host`, or `navigate-leaf-to-build`, when the preflight returns, then no HALT is written and no `loop_halt` event is emitted.
- Given a live HALT that a matching resume authorization permits crossing, when the preflight proceeds without stopping, then it neither rewrites that HALT nor emits a refusal for it.
- Given a live HALT that a matching resume authorization permits crossing, when the preflight then stops for another cause, then `.pipeline/HALT`'s first line is replaced by that cause's detail, because the crossed HALT no longer describes why the run stopped.

### Done When
- [ ] A test seeds a HALT, drives a preflight stop, and asserts the HALT file content is unchanged while a `loop_halt` event whose reason contains the seeded HALT's first line is persisted.
- [ ] A test asserts each non-stopping result kind leaves no HALT and no `loop_halt` event.
- [ ] A test seeds an authorized HALT, drives an unavailable stop, and asserts the HALT's first line names the new cause.

## Story 4: A live journal owner halts mechanically with the owner named

**Requirement:** #3446 desired outcomes 1–3; operator decision 2026-10-26 (mechanical HALT)

As an operator, I want a preflight that yields to another live process owning the restack journal to
say which process it yielded to, without parking the feature for a human, so that a transient
concurrent owner is self-explaining and recoverable by the daemon's existing automatic re-kick.

### Acceptance Criteria

#### Happy Path
- Given a restack journal owned by a live process on this host, when the stack preflight yields to it, then `.pipeline/HALT` is written with class `mechanical` and its first line names the owner's pid and host, `events.jsonl` gains a `restack_refused` event with a live-owner reason whose detail names the same pid and host, and a `loop_halt` event carries the same detail.
- Given that stop during a daemon dispatch, when the dispatch ends, then the daemon reports the feature halted with a reason naming the live journal owner instead of `loop ended without DONE or HALT marker`, and the daemon's shared halt-retention decision does not retain the HALT for an operator.

#### Negative Paths
- Given a journal whose recorded owner is on another host or whose process is no longer alive, when the preflight runs, then it does not report a live owner and recovery proceeds as it does today.
- Given a follow-on journal replacement refused because another live operation took the journal, when the preflight stops on that refusal, then it halts the same mechanical way, naming the journal's current owner when readable and `journal owner unreadable` otherwise.

### Done When
- [ ] `RestackRefusalReason` includes a live-owner value, declared on the persisted `restack_refused` event.
- [ ] A test with a live-owned journal asserts a `mechanical` HALT naming the owner's host and pid, and a persisted `restack_refused` event carrying them.
- [ ] A test asserts `resolveHaltRetention` over that HALT's class does not retain it.

## Story 5: Every preflight entry point surfaces the stop reason

**Requirement:** #3446 desired outcome 3

As an operator, I want the conductor's resume path, the rebase step, and the daemon re-kick to report
the same preflight reason, so that no entry point ends a run silently after a preflight refusal.

### Acceptance Criteria

#### Happy Path
- Given the daemon re-kick of a stacked feature whose preflight stops with detail `cannot drain routing outbox: unavailable`, when the re-kick returns before running the conductor, then the daemon log line for the preflight contains that detail, and the daemon classifies the dispatch as halted with that detail rather than `loop ended without DONE or HALT marker`.
- Given no `.pipeline/HALT` exists and the rebase step's stack preflight stops on a refusal that wrote no HALT of its own (an unavailable result or a markerless routed-exit refusal), when the step returns its failure, then the step output contains the preflight's detail and `.pipeline/HALT`'s first line carries the same detail.
- Given the conductor's resume path stack preflight stops, when `run()` returns, then no step is dispatched and the daemon classifies the dispatch from the HALT the preflight wrote.

#### Negative Paths
- Given the daemon re-kick preflight returns `clear`, when the re-kick boundary returns, then it returns `clear` with no extra log line, HALT, or event, so the re-kick continues to the rebase resume and the conductor as today.

### Done When
- [ ] `runDaemonRekickStackPreflight`'s log line includes the stop detail, not only the result kind.
- [ ] Tests for the conductor resume path, the rebase step, and the daemon re-kick each assert a preflight stop yields an outcome that names the preflight detail and never `loop ended without DONE or HALT marker`.
