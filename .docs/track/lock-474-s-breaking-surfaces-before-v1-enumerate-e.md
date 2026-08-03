# Track: lock-474-breaking-surfaces-before-v1 (#552)

Track: technical

## Rationale

The work is an interface-compatibility lock on engine-internal and operator-facing surfaces —
the current-task attribution stamp, the task-status schema, the plan task contract, hook wiring,
and config keys — so that #474 (engine-orchestrated parallel task-stream dispatch, deferred
post-v1) can land after the v1.0 tag as a MINOR change instead of a MAJOR one.

There is no end-user product requirement here: no new command a user runs, no new user-facing
workflow, no product behavior that changes for a consumer who never enables parallel dispatch.
The observable outcomes are all structural — a schema tolerates a shape it does not yet emit,
a reader accepts a form no writer yet writes, a config block exists with a v1-stable name.
Acceptance criteria for that live in stories (Given a v1 consumer artifact / When the post-v1
reader parses it / Then …), not in a PRD's functional requirements.

→ **technical track** (skip `/prd`).

## Framing carried into discovery

The originating issue (#552) states the problem and the outcomes; it does not prescribe a
mechanism. Two mechanisms are named in the surrounding issues and are carried into DECIDE as
**candidates, not chosen approaches**:

- #531's "dispatch-scoped attribution" hypothesis (task id travels with the dispatch rather
  than living in one global `.pipeline/current-task` file) — explicitly unverified by its filer.
- #474's own premise that engine-stamped task ids (#452) already compose with concurrency —
  which #531's live evidence contradicts.

Discovery's job was to establish which surfaces are actually consumer-visible, what their
current shapes are, and which of those shapes can be made forward-compatible **within v1**.

## Scope boundary

In scope: pinning the v1 shape of each surface #474 will touch, and shipping whatever
tolerant-reader / additive-field / reserved-key work is required in v1 to make the pin real.

Out of scope: implementing parallel task-stream dispatch itself. No stream detection, no
concurrent dispatch, no file-overlap veto engine. #474 stays open after this ships.
