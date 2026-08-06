**Status:** Accepted

# Stories: FINISH publication progress is not a retry (#1342)

Technical intent, derived from #1342's desired outcomes and the two APPROVED ADRs
(`adr-2026-08-06-publication-progress-is-its-own-disposition`,
`adr-2026-08-06-bounded-progress-allowance-for-finish-publication`):

- **TI-1** — a publication transition that succeeds is distinguishable from one that failed
  at the disposition boundary, by shape rather than by reason string.
- **TI-2** — a publication transition that succeeds does not consume `finish`'s retry budget.
- **TI-3** — after any number of successful transitions, a full retry allowance remains
  available to absorb a genuine transient.
- **TI-4** — a publication that stops making progress still terminates, bounded, and halts
  with a reason naming the stuck transition.
- **TI-5** — genuine publication failures keep charging the budget and still halt on
  exhaustion (negative path — must not regress).
- **TI-6** — a fully-successful publication reports no retry consumption in the daemon log.

## Story 1: Progress and failure are distinguishable at the disposition boundary

**Requirement:** TI-1

As the conductor's retry gate, I want a verified publication advance to arrive as its own
disposition kind so I can account for it as progress without inspecting an ambiguous reason
string.

### Acceptance Criteria

#### Happy Path

- Given the publication state machine returns `{ kind: 'advanced', transition }` for a
  verified effect, when the production adapter maps that result, then the disposition is
  `{ kind: 'publication_progress', transition }` and carries no reason string.
- Given a `publication_progress` disposition, when `routeFinishPublicationDisposition`
  routes it, then the route is `{ kind: 'progress_finish', transition }` and is not
  `retry_finish`.
- Given a `publication_progress` disposition for each of the six publication transitions in
  turn, when it is validated by the fail-closed disposition validator, then every one is
  accepted.

#### Negative Paths

- Given a `publication_progress` disposition whose `transition` is not a known publication
  transition, when it is validated, then it is rejected and routes to a halt rather than
  being treated as progress.
- Given a `publication_progress` disposition carrying an extra key beyond `kind` and
  `transition`, when it is validated, then it is rejected under the same exact-key
  discipline applied to the existing kinds.
- Given the state machine returns `{ kind: 'publication_retry', transition: 'establish_pr',
  reason: 'pr_identity_not_verified_after_establish' }` — a genuine post-effect verification
  failure — when the adapter maps it, then it passes through unchanged as
  `publication_retry` and routes to `retry_finish`, NOT to `progress_finish`.
- Given each of the five reason strings the adapter previously synthesised, when they are
  emitted by the state machine as genuine failures, then all five remain accepted by
  `PUBLICATION_RETRY_REASONS` validation.

### Done When

The disposition union, the production adapter's mapping, the route function and the
fail-closed validator all agree that a verified advance is progress, and no reason string
changes meaning.

## Story 2: A successful transition does not charge the retry budget

**Requirement:** TI-2, TI-3

As an operator shipping a feature, I want each successful publication step to cost nothing
from the transient-failure budget so that a normal ship is never one blip away from a HALT.

### Acceptance Criteria

#### Happy Path

- Given a FINISH step configured with a retry budget of 6, when a publication transition
  returns `progress_finish`, then FINISH is re-entered with a fresh observation and the
  attempt counter is unchanged from its value before that transition.
- Given a publication that advances through five transitions and then completes, when FINISH
  finishes, then the step succeeded and zero retry attempts were consumed.
- Given a publication that advanced through five transitions and then hits a genuine
  transient failure, when the conductor decides whether to retry, then the full retry
  allowance is still available to absorb it.
- Given a publication that legitimately revisits `establish_pr` after
  `write_shipped_record` left the branch unpushed, when both advances are accounted, then
  neither charges the retry budget and the run proceeds.

#### Negative Paths

- Given a `progress_finish` route, when the conductor handles it, then no `step_retry` event
  is emitted for it.
- Given a mixed run of progress and genuine failures, when the retry budget is evaluated,
  then only the genuine failures have been charged.
- Given a `progress_finish` route arrives after the retry budget is already fully spent by
  genuine failures, when the conductor handles it, then FINISH is still re-entered rather
  than halted — progress never inherits a failure-budget verdict.

### Done When

The `finish` retry budget is charged only by `retry_finish`, and a fully-successful
publication reaches completion with it untouched.

## Story 3: A publication that stops progressing terminates with the transition named

**Requirement:** TI-4

As an operator, I want a publication that keeps reporting progress without moving forward to
halt with the offending transition named, so a non-charging re-entry can never become an
unbounded loop.

### Acceptance Criteria

#### Happy Path

- Given a publication whose transitions keep returning `progress_finish` without ever
  completing, when the total progress allowance is reached, then the run halts rather than
  re-entering FINISH again.
- Given a run that halts at the allowance, when the halt reason is read, then it names the
  publication transition the run stopped on.
- Given a halt at the allowance, when the halt marker is written, then its class is
  `needs-human`, matching the existing publication-exhaustion halt.

#### Negative Paths

- Given a healthy run where `establish_pr` reports progress twice non-consecutively, when
  the allowance is evaluated, then it is not reached and the run is not halted.
- Given a run that alternates transitions rather than repeating one, when the allowance is
  reached, then it still halts — termination does not depend on any single transition
  repeating.
- Given the `finish` step is re-entered from outside after a prior execution, when the
  progress counter is read, then it starts from zero — a previous execution's progress never
  counts against a new one.

### Done When

A single allowance bound guarantees termination of the non-charging re-entry, and the
operator learns which transition the run stopped on.

## Story 4: Genuine publication failures keep their budget and their exhaustion halt

**Requirement:** TI-5

As a maintainer, I want the existing failure accounting to be provably unchanged, so that
fixing progress accounting does not silently make real failures unrecoverable or unbounded.

### Acceptance Criteria

#### Happy Path

- Given a genuine `publication_retry` failure, when the conductor handles it, then exactly
  one retry attempt is charged, exactly as before this change.
- Given genuine failures repeating until the retry budget is exhausted, when the budget runs
  out, then the run halts with the existing `FINISH publication retry exhausted: <reason>`
  message and a `needs-human` class.

#### Negative Paths

- Given a reason enrolled in the non-retryable publication reasons, when it is observed,
  then the existing first-observation halt still fires and the budget is still deliberately
  not spent — that path is untouched by this change.
- Given an `implementation_invalid` disposition, when it is routed, then it still routes to
  BUILD and is unaffected by the new progress arm.
- Given a `human_required` disposition, when it is routed, then it still halts and is
  unaffected by the new progress arm.
- Given a malformed or unrecognised disposition, when it is routed, then it still halts
  fail-closed rather than being treated as progress.

### Done When

Every pre-existing publication routing outcome behaves identically, verified by tests that
would fail if the progress arm captured any of them.

## Story 5: A successful publication shows no retry in the daemon log

**Requirement:** TI-6

As an operator reading the daemon log, I want a fully-successful publication to contain no
retry lines, so the log does not report trouble on a run where nothing went wrong.

The property is achieved by emitting nothing for progress rather than by adding a new event
value: the `✓ FINISH publication: <transition>` line already comes from the existing
`finish_publication_transition` event, so suppressing the spurious retry is sufficient and
`types/events.ts` and `daemon-cli.ts` are not touched.

### Acceptance Criteria

#### Happy Path

- Given a publication transition that succeeds, when the conductor handles its route, then no
  event announcing a retry is emitted for it.
- Given a fully-successful publication, when the daemon log for that run is read, then no
  `↻ finish retry` line follows a `✓ FINISH publication: <transition>` line.
- Given a fully-successful publication, when its log is read, then each completed transition
  still shows its existing `✓ FINISH publication: <transition>` line — suppressing the retry
  does not suppress the progress an operator already relies on.

#### Negative Paths

- Given a genuine publication retry, when it is handled, then it still emits `step_retry` and
  still renders with the existing retry wording and glyph.
- Given a run that halts at the progress allowance, when its log is read, then the halt is
  visible with its transition named — silence for progress never means silence for a stall.

### Done When

An operator can read a successful ship's log top to bottom and see forward progress only,
with no change to the event schema or the renderer.
