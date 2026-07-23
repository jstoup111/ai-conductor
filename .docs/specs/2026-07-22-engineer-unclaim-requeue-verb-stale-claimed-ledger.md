# PRD: Recovering stranded intake ideas (stale claim recovery)

**Date:** 2026-07-22
**Status:** Approved
**Track:** product
**Tier:** M
**Intake:** jstoup111/ai-conductor#468 (related: #243, #279, #461/#464, #228)

## Problem / Background

The engineer captures ideas into a durable intake queue and processes them one at a time.
To process an idea, a session **checks it out** of the queue — moving it from *queued* to
*in-progress* — and only later marks it *delivered* (a spec PR opened) or explicitly drops it.

There is today no way to move an in-progress idea back to *queued*. If a processing session
dies, is interrupted, or abandons the idea after checking it out, the idea is left stuck
*in-progress* forever: invisible to every future pull from the queue, silently starving
intake. On 2026-07-10, ten ideas were found stranded this way (two from aborted sessions
that morning, eight historical, some days old). The only remedy was hand-editing the stored
intake state with manual backups — something an operator without internal-format knowledge
cannot do at all.

This is a v1.0 cutover criterion (#228): a consumer whose engineer session crashes mid-idea
loses that idea permanently. It also underlies the duplicate-processing hazard (#243), because
a stranded in-progress entry is exactly the state a naive recovery could mishandle.

## Goals & Non-Goals

**Goals**
- No captured idea is ever *permanently* stranded because a session ended mid-processing.
- Stranded ideas are recovered **without operator action** in the common case.
- An operator has an **immediate, safe manual override** to recover a stranded idea (or the
  whole class of them) without hand-editing stored state.
- Recovery preserves an idea's original queue position (capture-time ordering).

**Non-Goals**
- A live-session heartbeat/lease that would let the system distinguish an abandoned in-progress
  idea from one a session is actively working. (Called out under Open Questions; without it,
  automatic recovery carries a bounded duplicate-processing risk.)
- Changing how ideas are captured, ordered on capture, or delivered.
- Recovering ideas that were already *delivered* or explicitly *dropped* — those have correct
  terminal dispositions already.

## Users / Personas

- **The operator** running the engineer, who needs intake to keep flowing after a crashed or
  abandoned session — and needs a one-command way to rescue a specific stuck idea when they
  know its session is dead and don't want to wait for automatic recovery.
- **The engineer processing loop** itself, which must not be starved by ideas invisibly stuck
  in-progress.

## Functional Requirements

- **FR-1:** An idea that was checked out for processing but never delivered or dropped MUST be
  recoverable back to the *queued* state (it must not be permanently stranded in-progress).
- **FR-2:** When the engineer next pulls work from the intake queue, the system MUST
  automatically detect in-progress ideas that have been checked out longer than a configured
  **staleness window** and return them to *queued*, with no operator action.
- **FR-3:** The staleness window MUST be configurable, with a default generous enough to exceed
  a plausible active processing session — so an idea a session is still legitimately working is
  not misclassified as abandoned by the automatic path.
- **FR-4:** Recovery (automatic or manual) MUST preserve the idea's original capture-time
  ordering, so a recovered idea keeps its place in line rather than going to the back.
- **FR-5:** An operator MUST be able to return one specific stranded idea to *queued* in a single
  action, by referencing the idea, without editing stored intake state by hand.
- **FR-6:** Manual single-idea recovery MUST refuse an idea that is already *delivered* or
  otherwise terminal, and direct the operator to the correct disposition for such ideas
  (recovery is only for checked-out-but-not-delivered ideas).
- **FR-7:** Referencing an idea that the intake system does not know for manual recovery MUST
  report a clear "not found" result and MUST NOT be treated as an error/failure.
- **FR-8:** An operator MUST be able to recover the entire class of stranded in-progress ideas
  in a single action, optionally bounded by an age threshold.
- **FR-9:** During bulk recovery, for each stranded idea whose originating upstream issue is
  already **closed**, the system MUST drop the idea from intake rather than return it to the
  queue (a closed issue no longer needs processing — the #279 liveness rule).
- **FR-10:** Because no live-session signal exists, automatic recovery of a still-active idea
  could allow that idea to be processed twice (#243). The design MUST bound this: the automatic
  path relies on the generous staleness window (FR-3), and the manual path (FR-5/FR-8) is the
  immediate override for sessions the operator knows are dead.
- **FR-11:** Recovery MUST record that an idea re-entered the queue (a churn/re-entry count) for
  observability, without disturbing capture-time ordering (FR-4).
- **FR-12:** Each idea the automatic path returns to the queue MUST be announced (surfaced to the
  operator when work is next pulled from the queue) — a stranded idea is never silently reaped
  without a visible record.

## Non-Functional Requirements

- **Observability:** automatic recovery is visible — the operator can see which ideas were
  returned to the queue and why (age past the staleness window).
- **Safety:** no operator needs knowledge of the stored intake file format to recover a stranded
  idea; every recovery path is a first-class command.
- **Backward compatibility:** existing intake lifecycle states and the capture/deliver flow are
  unchanged; recovery only adds the missing in-progress → queued transition.

## Acceptance Criteria / Success Metrics

- An idea checked out and then abandoned is picked up again on a subsequent pull from the queue,
  without any operator action.
- An operator recovers a specific stranded idea in one command; the idea reappears in the queue
  at its original position.
- A stranded idea whose upstream issue is closed is dropped by bulk recovery, not re-queued.
- Manual recovery refuses a delivered/terminal idea and reports "not found" (non-error) for an
  unknown reference.
- All FRs are covered by passing tests; the 2026-07-10 ten-stranded-entries scenario is
  resolvable by a single bulk command.

## Scope

### In Scope
- Automatic recovery of stale in-progress ideas at queue-pull time (default behavior).
- A manual single-idea recovery capability and a manual bulk-recovery capability.
- The liveness rule (closed upstream issue → drop, not re-queue) for bulk recovery.
- Preservation of capture-time ordering and a re-entry/churn count on recovery.

### Out of Scope
- A heartbeat/lease that eliminates the duplicate-processing window (Open Questions / future).
- Any change to capture, capture-time ordering, or delivery.
- Recovery of delivered or explicitly dropped ideas.

## Key Decisions & Rationale

- **Both automatic and operator-initiated recovery** (belt-and-suspenders). Chosen over
  *manual-only* (leaves starvation latent until a human notices and acts, and fights the
  harness's "deterministic machinery at the point of the mistake" principle) and over
  *pure-automatic with no manual path* (reintroduces the #243 duplicate-processing risk with no
  operator override). Operator-confirmed 2026-07-22.
- **Closed upstream issues are dropped, not re-queued**, during bulk recovery — there is no value
  in re-processing an idea whose originating issue is already resolved (#279).
- **Capture-time ordering is preserved** on recovery — a crash should not penalize an idea's
  place in line.

## Dependencies

- **GitHub issue state** (external, pre-existing): the bulk-recovery liveness rule reads whether
  an idea's originating issue is open or closed. This is an existing external dependency the
  feature must consult, not a new internal mechanism.

## Open Questions

- **Staleness default value** — the exact default window that best trades "recover a dead
  session's idea promptly" against "never reap an idea a long live session is still working."
  A concrete default and its rationale is for architecture-review to fix as an ADR.
- **Eliminating the duplicate-processing window** — whether a lightweight live-session signal
  (heartbeat/lease) should later back automatic recovery so a still-active idea can never be
  reaped, closing the #243 window entirely rather than merely bounding it with a generous
  window. Deferred; a trade-off for architecture-review.
- **Re-entry counter semantics** — whether a crash-recovery re-entry should be counted the same
  way as a delivery-failure re-eligibility, or distinguished, for observability.
