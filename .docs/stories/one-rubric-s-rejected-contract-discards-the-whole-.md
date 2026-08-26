**Status:** Accepted

# Stories: one rubric's rejected contract no longer resurrects a prior lap's findings (#1740)

Track: technical. Tier: M. Design: `architecture-review-2026-08-21-one-rubric-s-rejected-contract-discards-the-whole-` (approach A′, conforming to `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D3/D4, `adr-2026-07-13-retry-classify-rerun-vs-route`, `adr-2026-07-22-gate-evidence-code-validity-on-redispatch`).
Scope boundary: a below-cap mechanical fault still publishes no aggregate; completion treats a non-PASS aggregate from a different lap as absent; the last mechanical fault is a first-class ledger record; the stale condition rides the event spine. No FAIL aggregate on a mechanical fault, no new result kind, no carry-forward (#1657), no daemon-status work.

## Story 1: A prior lap's FAIL aggregate is never read as the current lap's verdict

**Requirement:** issue outcomes 2 and 4

As the conductor, I want build_review completion to recognise that the aggregate on disk belongs to an earlier lap, so that a build is never re-opened for findings the current lap did not judge.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/build-review.json` carries `lapId: lap-<A>` with verdict FAIL and the current checkout HEAD is `<B>` ≠ `<A>`, when build_review completion runs, then it returns `done: false` with `routeClass: 'absent'` and a reason that names both `lap-<A>` and the current lap
- Given the same stale FAIL aggregate, when completion runs, then no `kickback` event is emitted and the kickback ledger's `gates.build_review.count`, `cumulative`, and `lastReason` are unchanged
- Given `.pipeline/build-review.json` carries `lapId` equal to the current lap with verdict FAIL and one judged finding, when completion runs, then it returns `routeClass: 'named-route'` with that lap's finding reasons
- Given the stale aggregate condition is detected, when completion returns, then exactly one persisted event on `.pipeline/events.jsonl` records the stored lapId and the current lapId, and its member is declared in `EVENT_SINKS`

#### Negative Paths
- Given a stale FAIL aggregate from lap `<A>`, when completion classifies it absent, then the file `.pipeline/build-review.json` is left byte-for-byte unchanged on disk
- Given a PASS aggregate whose `lapId` ≠ current HEAD but whose `codeStamp` delta misses the gate surface, when completion runs with gate-code-validity enabled, then the verdict is preserved exactly as today (`done: true`, `verdictFreshness: preserved_surface_miss`) and the stale-lap branch is never reached
- Given a FAIL aggregate with a matching `lapId` whose mtime predates the judging session, when completion runs, then the existing mtime-staleness reason is returned unchanged (the lapId check never overrides the mtime floor)
- Given the current HEAD cannot be resolved (git failure), when completion runs on a FAIL aggregate, then it falls through to the existing mtime/JSON logic and never returns `done: true`
- Given a stale PASS aggregate with no `codeStamp` and mtime before the session, when completion runs, then it returns the existing `stale_invalidated` absent reason, not the stale-lapId reason

### Done When
- [ ] `build_review` completion in `artifacts.ts` compares a non-PASS aggregate's `lapId` to `lap-<current HEAD>` and returns `routeClass: 'absent'` with a reason containing both ids on mismatch, after the code-stamp preservation and mtime checks
- [ ] A `ConductorEvent` member (or additive field) for the stale-aggregate condition exists, is declared in `EVENT_SINKS` with `persist: true`, and a unit test asserts it is emitted once with `storedLapId` and `currentLapId`
- [ ] Unit tests cover: stale FAIL → absent; current FAIL with findings → named-route; stamped PASS with moved HEAD → preserved; git failure → no PASS

## Story 2: A mechanical-fault lap leaves no aggregate but loses no verdict

**Requirement:** issue outcomes 1 and 5; adr-2026-08-18 D3

As the build_review step, I want a lap in which one rubric was rejected after repair while the others judged clean to end without publishing an aggregate and without discarding the clean verdicts, so that the lap's outcome is recorded where it was judged and the rejected rubric still blocks PASS.

### Acceptance Criteria

#### Happy Path
- Given three rubrics judged PASS and one rubric returns `dispatch-failure` after its repair turn with allowance remaining, when the lap join completes, then `.pipeline/build-review/<lapId>/<rubric>.json` exists for each of the three judged rubrics with their PASS results
- Given that lap, when the step returns, then `success` is false, `currentLapMechanicalFault` is true, and `.pipeline/build-review.json` was not written for `<lapId>`
- Given that lap, when the conductor handles the result, then build_review is re-run without incrementing `gates.build_review.count` or `cumulative`
- Given the rejected rubric is re-dispatched on the next lap and returns a judged PASS, when that lap joins, then the aggregate for the new lap is published with coverage `judged` for all four rubrics and verdict PASS

#### Negative Paths
- Given three PASS rubrics and one infrastructure-failure rubric at the allowance cap, when the lap join completes, then the aggregate is published with `coverage.<rubric>: infrastructure-failure` and the effective verdict is FAIL
- Given one rubric judged FAIL with a finding and another rubric rejected after repair, when the lap join completes, then the aggregate is published for the current lap with the judged finding and the infrastructure failure, and the kickback reason names only that lap's finding
- Given a lap where every rubric is an infrastructure failure, when the lap join completes below cap, then no aggregate is written and the step result names the first failing rubric and its closed reason
- Given the prior lap's aggregate is on disk and the current lap is a below-cap mechanical fault, when completion is consulted for build_review, then it classifies the verdict absent (Story 1) and the prior lap's findings do not appear in any kickback reason

### Done When
- [ ] An acceptance test drives a four-rubric lap with one post-repair rejection through the real lap join and asserts: no aggregate for that lapId, three branch artifacts present, `currentLapMechanicalFault: true`, ledger `count`/`cumulative` unchanged
- [ ] The same test's follow-up lap (rejected rubric now judged) publishes a four-judged PASS aggregate
- [ ] The kickback ledger's `lastReason` after the mechanical-fault lap contains no finding from a prior lap

## Story 3: The rejected rubric's concern is a first-class ledger record

**Requirement:** issue outcome 3; adr-2026-08-18 D4 ("records the rubric and closed reason last seen")

As an operator, I want the last mechanical fault's rubric, closed reason, bounded detail, and lap recorded in the kickback ledger, so that the concern a rejected rubric was reporting is readable without grepping the daemon log.

### Acceptance Criteria

#### Happy Path
- Given a below-cap mechanical fault for rubric `scope` with reason `invalid-provider-result` and a bounded detail excerpt, when the allowance is consumed, then `gates.build_review.lastMechanicalFault` equals `{ rubric: 'scope', reason: 'invalid-provider-result', detail: <excerpt>, lapId: <lapId> }`
- Given a second mechanical fault on a later lap for rubric `tautology`, when the allowance is consumed again, then `lastMechanicalFault` is replaced by the `tautology` record and `mechanicalFaults` is 2
- Given the mechanical allowance is exhausted, when the needs-human halt is rendered, then the halt body includes the recorded rubric, closed reason, and detail from `lastMechanicalFault`
- Given `lastMechanicalFault` is set, when `conduct-ts build-review findings --feature <slug>` renders, then the output includes a "Last mechanical fault" line with the rubric, reason, and lapId

#### Negative Paths
- Given a ledger file written before this change (no `lastMechanicalFault` key), when the ledger is read, then it parses as valid and `lastMechanicalFault` is undefined
- Given a ledger whose `lastMechanicalFault.reason` is not a closed `BuildReviewInfrastructureFailureReason` member, when the ledger is read, then the entry is rejected by the validator with the same failure class as any other malformed entry
- Given a detail longer than the bounded cap, when the record is written, then the stored `detail` is truncated to the cap and the ledger write still succeeds
- Given a rebase invalidation credits the gate through `creditKickbackGateLaps`, when the credited entry is persisted, then `lastMechanicalFault` is absent in the same write as `mechanicalFaults` returns to 0
- Given a build_review PASS on a later lap, when the ledger is updated, then `lastMechanicalFault` and `mechanicalFaults` are both retained (no PASS reset)

### Done When
- [ ] `KickbackGateEntry.lastMechanicalFault` is an optional typed field `{ rubric, reason, detail, lapId }` with `reason` typed as the closed infrastructure-failure reason union; `isLedgerEntry` accepts absent-or-valid and rejects malformed
- [ ] `bumpMechanicalFaultsInLedger` accepts the fault record and persists it atomically; unit tests cover write, replace, legacy-absent, malformed-reject, cap truncation
- [ ] `renderExhaustedMechanicalBuildReviewHalt` and the `build-review findings` renderer both print the record; snapshot/unit tests assert the lines
- [ ] `creditKickbackGateLaps` clears `lastMechanicalFault` together with `mechanicalFaults` (it is an object field, so the numeric lap-counting rule does not reach it unaided); a build_review PASS leaves both untouched (unit test)
