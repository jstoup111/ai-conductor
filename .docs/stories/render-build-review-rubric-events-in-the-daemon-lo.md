**Status:** Accepted

# Stories: Render build_review rubric events in the daemon log (#1592)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the daemon-log renderer's treatment of the six build_review rubric events that already ride the event spine. The union, the emitters, the persisted ledger, and the TTY dashboard are untouched.

## Story 1: Attribute in-flight rubric branches while a lap is running

As a daemon operator watching a review lap, I want each rubric branch named as it starts and when it is served from cache, so that I can tell which branch ran, which settled, and which is still outstanding without parsing a side-channel file.

### Acceptance Criteria

#### Happy Path

- Given a rubric branch begins a fresh dispatch, when the daemon renders its start event, then the log line names the build_review step, names that rubric, and marks the branch as started.
- Given a rubric branch is served from a cached judgement, when the daemon renders its cache-hit event, then the log line names that rubric and marks the branch as served from cache rather than freshly dispatched.

#### Negative Paths

- Given two rubric events for the same rubric belong to different laps, when the daemon renders both, then each line carries a short lap tag derived from its own lap identifier so the two branches are not conflated.

### Done When

- [ ] A rendered start line contains the rubric name and a started marker, and no serialized JSON object.
- [ ] A rendered cache-hit line for the same rubric is textually distinguishable from a fresh start line.
- [ ] Two rendered lines for one rubric under different lap identifiers carry different lap tags.

## Story 2: Distinguish settled rubric outcomes at a glance

As a daemon operator triaging a settled lap, I want judged PASS, judged FAIL, neutral skip, and infrastructure failure to read as four different things in the log, so that I do not have to open the review artifact to learn why the lap ended the way it did.

### Acceptance Criteria

#### Happy Path

- Given a rubric branch settles with a judged verdict, when the daemon renders its result event, then the log line names that rubric and states PASS or FAIL as judged.
- Given a rubric branch is neutrally skipped before dispatch, when the daemon renders its skip event, then the log line names that rubric, marks it skipped rather than failed, and carries the skip reason.
- Given a lap reaches its outer verdict, when the daemon renders that event, then the log line states the effective verdict, additionally states the raw verdict whenever the two differ, and carries the deterministic pass reason and unresolved-marker count when the event supplies them.

#### Negative Paths

- Given a rubric branch ends in an infrastructure failure, when the daemon renders that event, then the log line names that rubric, is textually distinct from a judged FAIL line, and carries the failure reason together with the excerpt when one is supplied.
- Given any of the six build_review rubric events is rendered, when the daemon produces its log lines, then no line contains a serialized JSON object and the event object passed to the renderer is left unchanged.

### Done When

- [ ] A judged FAIL line and an infrastructure-failure line for the same rubric differ in text, not only in color.
- [ ] A skip line carries its reason and contains no failure wording.
- [ ] An outer-verdict line whose raw and effective verdicts differ names both, and one whose verdicts agree names the verdict once.
- [ ] Rendering every one of the six events produces no line containing a serialized JSON object.
- [ ] A frozen event object rendered by the daemon is structurally identical afterwards.

## Negative-category review

Invalid input is covered by the infrastructure-failure criterion, which is the renderer's only branch that carries operator-supplied failure text, and by the optional-excerpt case where a field the union marks optional is absent. Data integrity for machine consumers is covered by the no-mutation and no-serialized-JSON criterion, which is the negative form of the issue's requirement that a rendering fix change no schema. Concurrent access is covered by the lap-tag criterion: two laps interleaved in one log file is the concurrency this renderer can actually observe, and conflating them is the failure it must prevent. Partial failure is covered by the skip and infrastructure-failure criteria, which are exactly the branch outcomes that settle a lap without a judged verdict. Auth, timeout, resource-exhaustion, dependency-unavailability, and cascade-deletion categories are inapplicable: the renderer is a pure synchronous formatter over an in-memory event with no I/O, no external dependency, no persistence, and no entity lifecycle. Exception-hierarchy handling is already owned by the existing try/catch wrapper around the switch and is not re-specified here.
