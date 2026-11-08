# Stories: Refused over-scope rework can't start while a routing round is open

**Status:** Accepted

Source: intake jstoup111/ai-conductor#3597. Technical track, no PRD. Governing design:
`adr-2026-10-12-routed-whole-feature-repair` decisions 7 (as amended by #3445, #3455 and #3597), 13 and 15,
and `.docs/decisions/architecture-review-2026-11-07-refused-over-scope-rework-can-t-start-while-a-rout.md`.
A `mechanical` HALT is the retryable stop: the daemon's episode-end sweep clears and re-kicks it without an operator.
"Whole-feature gate" means any step after `build_review` in the resolved step list (`manual_test`, `prd_audit`, `architecture_review_as_built` and later steps).
"Routed work is outstanding" means a repair marker exists, the revalidation queue has an entry or is unreadable, or any route record is not `closed`.
A round-admission fence refusal is a routing deferral: the refused work waits for the open round to finish. It is not the "no refusal rework admitted" or "rework not possible" case of earlier over-scope stories. That case still covers a spent allowance and a planner that cannot produce rework, and still writes the existing refused HALT.

## Story 1: A build_review settled by adjudication closes the child region like a clean PASS

**Requirement:** #3597 desired outcome 1; adr-2026-10-12 decision 13 (as amended by #3445 and #3455)

As the operator of a stacked feature, I want a child whose `build_review` settles through remediation adjudication to leave its BUILD region exactly as a clean `build_review` PASS does, so that a routed round is never left open behind a whole-feature gate.

### Acceptance Criteria

#### Happy Path
- Given an audit round whose host 1 is `repairing` with the repair marker and whose host 2 is `pending`, when host 1's `build_review` fails and adjudication rejects every finding so the step settles, then in the same run host 1 becomes `restacked`, host 2 is `admitted` with the repair marker, and the run enters host 2's BUILD region.
- Given an audit round in which host 1 is the last unsettled child host and the revalidation queue is empty, when host 1's `build_review` settles by adjudication, then the round takes the same next routed step (leaf host or leaf return) that a clean `build_review` PASS on the same refs selects.
- Given identical route records, repair marker and queue, when one run ends host 1's region by a clean `build_review` PASS and another ends it by adjudication settlement, then both leave identical route record host states and marker.
- Given a routed host whose `build_review` FAILs in round r«n» and whose adjudication then settles, when the run is interrupted after settlement and resumes, then `build_review` reads as satisfied in round r«n» exactly as after a clean PASS, and the resumed run does not dispatch `build_review` again.
- Given an ordinary (non-routed) non-leaf child of a stacked feature, when its `build_review` settles by adjudication, then the child is closed, the cursor advances to the next child, and the run re-enters the BUILD region at `acceptance_specs` on that next child.

#### Negative Paths
- Given a routed host whose `build_review` settled by adjudication, when its routed exit restack is refused or rolled back, then the run halts through the existing routed-exit refusal stop, no whole-feature gate step starts, and the next resume takes that host's routed exit without re-running `build_review`.
- Given a child whose adjudication settles but whose durable case settlement is invalid, when the settled outcome is applied, then the run halts `needs-human` with the existing clean-PASS settlement message and no routed exit, child closure or whole-feature gate runs.
- Given an ordinary non-leaf child whose `build_review` settled by adjudication, when the child-region exit is refused, then the run halts with the existing child-region refusal message naming the child and no whole-feature gate step starts.
- Given an unstacked (N=1) feature or the leaf child of a stacked feature with no open round, when `build_review` settles by adjudication, then the run continues to the next whole-feature gate exactly as today and no routing ref is created, changed or deleted.

### Done When
- [ ] A conductor-loop test with a stacked routed round drives host 1 through a failed `build_review` whose adjudication rejects every finding, and asserts host 1 ends `restacked`, the repair marker names host 2, and no `step_started` event for a whole-feature gate is emitted in that run.
- [ ] A test drives the same refs through a clean PASS and through adjudication settlement and asserts byte-identical route record blobs and marker.
- [ ] A conductor-loop test asserts an ordinary non-leaf child whose `build_review` settles by adjudication emits `child_started` for the next child and no whole-feature gate `step_started` event.
- [ ] A resume test interrupts a routed host after adjudication settles its failed `build_review` and asserts the resumed run emits no `step_started` for `build_review` and takes the host's routed exit.

## Story 2: Whole-feature gates never start while routed work is outstanding

**Requirement:** #3597 desired outcomes 1 and 2; adr-2026-10-12 decisions 7 (as amended by #3445, #3455 and #3597) and 15

As the operator of a stacked feature, I want no whole-feature gate to run while routed work is outstanding, on any path into that gate, so that leaf audits only ever judge a feature whose routed rounds have finished.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature with no repair marker, an empty revalidation queue and every route record `closed`, when the loop advances from `build_review` into the whole-feature gates, then `manual_test`, `prd_audit` and `architecture_review_as_built` run exactly as today.
- Given a repair marker naming a host whose every BUILD-region gate is satisfied in the executing round, when the loop is about to start a whole-feature gate, then the run takes that host's routed exit instead and the whole-feature gate does not start.
- Given a repair marker naming a host whose BUILD region still has an unsatisfied gate, when the feature resumes after a halt, then the run re-enters that host's BUILD region at its earliest unsatisfied region gate and no whole-feature gate starts.
- Given a non-empty revalidation queue with no repair marker, when the loop is about to start a whole-feature gate, then the queued child's revalidate round is admitted first and the whole-feature gate does not start.
- Given an open audit round with a `pending` host, no repair marker and an empty revalidation queue, when the loop is about to start a whole-feature gate, then reconciliation admits that pending host with the repair marker, the run enters its BUILD region, and the whole-feature gate does not start.

#### Negative Paths
- Given outstanding routed work that reconciliation cannot advance, when the loop is about to start a whole-feature gate, then the run ends with a `mechanical` HALT whose first line names the round, the host or queue, and the reason, and no whole-feature gate step starts.
- Given the same unadvanceable routed state stopping three consecutive times with no intervening routing progress, when the third stop is recorded, then the HALT is written `needs-human` instead of `mechanical`.
- Given the repair marker, the revalidation queue or a route record cannot be read, when the loop is about to start a whole-feature gate, then the run stops without starting the gate and the HALT names the unreadable routing state.
- Given a flat or N=1 feature, or `stacked_prs.route_whole_feature_fixes` is off, when the loop starts a whole-feature gate, then no repair marker, queue or route ref is read.

### Done When
- [ ] A conductor-loop test with a repair marker present and every host region gate satisfied asserts the run emits no `step_started` for `manual_test`, `prd_audit` or `architecture_review_as_built` and takes the routed exit.
- [ ] A resume test reproduces the r2 state (host 1 `repairing` with the marker, host 2 `pending`, whole-feature gates pending) and asserts the resumed run does not start the `prd_audit` validation group before the round closes.
- [ ] A conductor-loop test with an open round holding only a `pending` host, no marker and an empty queue asserts no whole-feature gate `step_started` event and a `routed_repair_phase` admission of that host.
- [ ] A test asserts an unadvanceable marker writes `.pipeline/HALT.class` `mechanical` on the first two identical stops and `needs-human` on the third.

## Story 3: A refusal raised during an open round is built, and its fence stop is retryable

**Requirement:** #3597 desired outcomes 1, 2, 3 and 4; adr-2026-10-12 decision 7 (as amended by #3445 and #3597)

As the operator, I want a recorded over-scope refusal to be reworked once the open round finishes, and a round-admission refusal to stop as a retryable engine fault that names the blocking round, so that I am never asked to re-decide a refusal I already recorded.

### Acceptance Criteria

#### Happy Path
- Given a feature with a recorded `refuse` decision for a criterion and an open audit round whose hosts are still unsettled, when the feature resumes, then the open round's hosts finish and the round closes before `prd_audit` runs, and the refusal rework then admits a new audit round whose hosts build the refused rework with no `cannot admit` planner fault.
- Given every route record is `closed`, no repair marker exists and the revalidation queue is empty, when refusal rework or `prd_audit` remediation routes fixes on a stacked feature, then a new audit round is created and its first host is admitted exactly as today.
- Given an over-scope HALT whose every decision is already recorded, when the operator runs `halt clear` and the feature resumes, then the run makes routing progress (a host exit, a host admission or a round close) and does not write a HALT asking to revise any already-recorded decision.
- Given refusal rework whose route admission is refused by the round-admission fence, when the HALT is written, then `.pipeline/HALT.class` is `mechanical` and its first line names the blocking round id, its phase, its open host and that host's state, and an `ai-conductor stack rounds --slug «slug»` recovery command.

#### Negative Paths
- Given refusal rework refused by the round-admission fence, when the HALT body is written, then it lists the refused criterion keys for context, contains no `revise-decision` entry and no over-scope decision block requesting a new decision, and the recorded refusal decisions remain preserved for the next audit lap.
- Given refusal rework that is not admitted for a reason other than the fence (a spent allowance, a planner that cannot produce rework, a lost marker race, the round limit, or record creation failure), when the HALT is written, then it keeps that reason's existing halt class and message, including the existing refused HALT for a spent allowance or a planner that cannot produce rework.
- Given the same round-admission fence refusal, from refusal rework or from any other stacked audit routing, recurring three consecutive times with no intervening routing progress, when the third stop is recorded, then that HALT is written `needs-human` naming the same blocking round, and the first two are `mechanical`.
- Given an audit or revalidate admission refused because another round's record is unreadable, when the fence refuses, then the HALT names the unreadable round and does not claim a host or host state for it.

### Done When
- [ ] A real-git test seeds a recorded NC refusal with an open audit round (host 1 `repairing`, host 2 `pending`) and asserts the resumed feature closes that round, then admits a new audit round carrying the refusal rework, with no `Remediation planner fault` text in any HALT.
- [ ] A test asserts a fence-refused refusal rework writes `.pipeline/HALT.class` `mechanical` with a first line containing the round id, its phase, the open host, its state and `ai-conductor stack rounds --slug`.
- [ ] A regression test asserts that with all rounds closed the stacked audit routing creates one new `refs/conductor/«slug»/routes/«roundId»` ref and emits one `remediation_routed` event.
