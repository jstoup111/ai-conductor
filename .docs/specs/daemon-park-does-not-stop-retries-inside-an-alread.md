# PRD: Park stops retries inside an already-dispatched step

**Date:** 2026-09-22
**Status:** Approved
**Source:** jstoup111/ai-conductor#2103

## Problem / Background

Operator park is the documented way to stop a feature before touching its git state. Since the
2026-07-29 boundary-aware parking feature, a park that lands mid-step is honored only when the step
finishes and before the next step begins. A step can stay unfinished for a long time, because one
step makes many provider attempts: retries after failures, retries after a rate-limit wait or a
stale session, and progress-driven build re-dispatches. Every one of those attempts still launches
after the park.

On 2026-08-31 a build step was wedged on a deadlocked acceptance test. The operator parked it at
02:55:06Z. The CLI reported success, and the daemon then launched two more provider attempts into
the same step against the same deadlock. Only stopping the whole daemon ended it, and that stopped
every other queued feature too. Nothing told the operator that park had not taken effect, or that
stopping the daemon was the only lever.

## Goals & Non-Goals

**Goals**
- A park stops a feature from launching any new provider attempt, including retries inside a step
  that was already running when the park landed.
- The operator can tell from the park command itself whether work is still running for the feature.
- An operator can stop a misbehaving in-flight feature without stopping the daemon.

**Non-Goals**
- Interrupting or killing a provider call that is already running. Park stays advisory: the
  current attempt finishes on its own terms.
- Changing interactive (non-daemon) conduct runs.
- Changing when an unparked feature is re-dispatched, or park/unpark authority itself.

## Users / Personas

- **Operator of a running daemon.** They are responding to a feature that is wasting provider
  dispatches, or they need it quiesced before git-state surgery. They want the park to take effect
  at the next opportunity, and to know whether anything is still running.

## Functional Requirements

- **FR-1 — No new attempt after park:** Once a park is active for a daemon-managed feature, the
  daemon launches no further provider attempt for that feature. This covers a retry inside the
  step that was running when the park landed, whether or not the retry would consume retry budget.
- **FR-2 — Current attempt is not interrupted:** A provider attempt already running when the park
  lands continues to its own end. Parking does not terminate it.
- **FR-3 — Declined attempt is not a failure:** Stopping before an attempt is reported as an
  intentional operator park, not as a step failure, retry exhaustion, machine halt, or error. It
  does not spend the step's retry budget, and it creates no HALT.
- **FR-4 — Resume continues the step:** After unpark, the daemon resumes the parked step from its
  persisted state. Attempts and progress completed before the park are not discarded, and the step
  continues under its ordinary retry rules.
- **FR-5 — Park races fail safely:** A park observed between one attempt ending and the next
  starting blocks the next attempt. If the daemon cannot determine whether the feature is parked at
  that moment, it does not start the attempt.
- **FR-6 — Every dispatch path honors park:** FR-1 holds for every provider dispatch the daemon
  makes for a feature. That includes self-host and non-self-host builds and every step type, so no
  retry path is exempt.

  > **Amended 2026-09-22 by #2103:** An "attempt" is one serial-step dispatch or one
  > parallel-group member dispatch. Provider calls made inside that attempt, such as review
  > sub-reviewers and verification checks, belong to the running attempt and finish with it
  > (FR-2). They are not gated separately. The operator confirmed this in architecture review.
- **FR-7 — Parallel groups:** Inside a daemon-managed parallel group, members already running
  finish as in FR-2. No member starts a new attempt once the park is active, and the group still
  settles and joins so the feature stops cleanly.
- **FR-8 — Other features keep moving:** Parking one in-flight feature does not stop, pause, or
  delay dispatch of any other feature.
- **FR-9 — Park reports running work:** When the operator parks a feature, the park command's output
  says whether a provider attempt is currently running for it, naming the step when known.
- **FR-10 — Unknown is reported as unknown:** If the park command cannot determine whether work is
  running for the feature (for example, state is unreadable or the daemon is unreachable), it says
  so. It does not claim the feature has stopped.
- **FR-11 — Nothing running is reported plainly:** When no work is running for the feature, the
  park command says the feature is fully stopped.
- **FR-12 — The stop is visible in daemon reporting:** When a park declines an attempt, daemon
  reporting identifies the feature, the step, and that an attempt was declined for an operator park.
- **FR-14 — Interactive runs unchanged:** Interactive conduct runs gain no new park behavior.

## Non-Functional Requirements

- **Reliability:** The park check before an attempt must not turn a transient read error into a
  launched attempt (fail toward parked, per FR-5).
- **Latency:** After the running attempt ends, the park takes effect before any new provider process
  starts. No polling delay may let an attempt slip through.

## Acceptance Criteria / Success Metrics

- Replaying the #2103 scenario (park during a build step that keeps retrying) yields zero provider
  attempts launched after the park is observed, and the daemon keeps serving other features.
- The park command's output correctly distinguishes running, stopped, and unknown for a feature.
- All FRs are covered by passing tests. Tests use faithful fakes at the provider boundary.

## Scope

### In Scope
- Declining new provider attempts, retries included, for a parked feature on every daemon dispatch
  path.
- The running-work report in the park command's output.
- Operator documentation updates for park and emergency stop.

### Out of Scope
- Killing or interrupting a running provider attempt.
- Interactive conduct runs.
- New park states, an auto-park policy, or changes to unpark.

## Key Decisions & Rationale

- **Advisory, not authoritative.** Operator decision (2026-09-22). Declining the next attempt would
  have cut the #2103 incident from three attempts to one, with no cancellation or cleanup risk.
  Killing a running attempt stays out of scope.
- **Every dispatch, not only the step retry loop.** Operator decision (2026-09-22). A park that is
  honored on some retry paths and not others would leave the same trap in a different place.
- **Declined attempt spends no budget.** Parking is an operator action, not evidence the step is
  failing. Charging it against retry budget would make the step fail sooner after unpark.

## Dependencies

- The existing operator park and unpark controls, and their single durable park authority.
- The 2026-07-29 scheduling-unit park boundary (this feature extends it inside a unit).

## Open Questions

- For architecture-review: where the pre-attempt park check lives, so that every dispatch path
  (FR-6) is covered by one check rather than one per retry site. Weigh generalizing the existing
  self-host pre-dispatch check against a lower dispatch seam.
- For architecture-review: how the park command learns whether work is running (FR-9–FR-11) without
  adding a parallel observation channel. The existing event spine and persisted feature state are
  the candidate sources.
- For architecture-review: this amends decision 4 of the 2026-07-29 scheduling-unit park ADR
  ("never consulted inside an active scheduling unit"). Decide whether to amend in place or
  supersede.
