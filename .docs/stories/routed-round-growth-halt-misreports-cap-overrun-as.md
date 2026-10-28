**Status:** Accepted

# Stories: A routed round's BUILD cap halt states its real charge, names its work, and reports the enforced growth cap

Source: jstoup111/ai-conductor#3456, which also covers duplicate #3476. Track: technical (no PRD). Tier: S.

A stacked feature's whole-feature repair is a routed round. It carries its charge on a route record:
the receipt's per-gate laps and declared growth, the routed items' finding ids, and the frozen
allocation's remediation task ids. It does not use the flat ledger's `pendingRepair`. When BUILD
dispatch settlement refuses such a round, today's halt reads only the flat record. It therefore says
the repair record is malformed, prints no pending growth or minimum raise, and an operator has to read
git refs to size a raise. Separately, `kickback-budget inspect` and `daemon status` derive the growth
cap from the feature worktree's config, while the dispatching engine uses the main checkout's, so
they can report a different cap from the halt. These stories make the routed halt as complete as the
flat one, reserve "malformed" and `needs-human` for records that actually fail to read, and make
the read-only surfaces report the cap the engine enforces.

Fixture conventions: a "routed feature" is a stacked feature whose BUILD execution target is a
routed host (`resolveExecutionChild` source `routed-host`) for round `rN`. Its ref
`refs/conductor/<slug>/routes/rN` holds an `audit` route record whose current host is the dispatching
child and whose receipt carries no settlement id. Its flat ledger has no `pendingRepair`. Gate lap
allowances have room unless a criterion says otherwise.

## Story 1: A routed round's growth-exhausted halt states the round's pending charge and the minimum raise

**Requirement:** #3456 desired outcome 1; #3476 desired outcome 2

As an operator reading a growth-exhausted BUILD halt on a stacked feature, I want it to state the routed round's pending growth next to the settled growth and the cap, and the minimum raise that admits the round, so that I can recover from the HALT text alone without reading route refs.

### Acceptance Criteria

#### Happy Path
- Given a routed feature for round `r8` with settled growth 13, a raised growth cap of 14, and a receipt charging `prd_audit` 1 lap and growth 2, when BUILD dispatch settlement halts, then the HALT's first line is `BUILD dispatch halted: prd_audit growth allowance exhausted.`, it contains `Plan growth: 13/14 added; 0 remaining (raised cap)` followed on the next line by `Pending growth: 2 (prd_audit 2); would reach 15/14 when build dispatches; minimum raise 1`, its recovery line contains `kickback-budget raise --feature <slug> --gate prd_audit --by 1`, and `.pipeline/HALT.class` is `kickback-cap`.
- Given a routed feature for round `r1` with settled growth 0, a config-derived growth cap of 3, and a receipt charging `architecture_review_as_built` 1 lap and growth 4, when settlement halts, then the HALT contains `Plan growth: 0/3 added; 0 remaining (config-derived cap)` and `Pending growth: 4 (architecture_review_as_built 4); would reach 4/3 when build dispatches; minimum raise 1`, and the recovery line names `--gate architecture_review_as_built --by 1`.
- Given a routed round whose receipt charges both `prd_audit` and `architecture_review_as_built` 1 lap each and growth 3, with settled growth 6 and a config-derived cap of 8, when settlement halts, then the HALT contains `Pending growth: 3 (prd_audit 3); would reach 9/8 when build dispatches; minimum raise 1`, attributing the single growth charge to `prd_audit` as the ledger does.

#### Negative Paths
- Given a routed feature whose flat ledger records settled growth 6 while an earlier round `r4` holds a settled receipt of growth 2 that the ledger has not yet recorded, a config-derived cap of 10, and a current round whose receipt charges `prd_audit` 1 lap and growth 3, when settlement reconciles `r4` and then refuses the current round, then the HALT contains `Plan growth: 8/10 added; 0 remaining (config-derived cap)` and `Pending growth: 3 (prd_audit 3); would reach 11/10 when build dispatches; minimum raise 1`, and the cap evidence records consumed 8 and limit 10.
- Given a routed round refused because the `prd_audit` lap allowance is exhausted while its growth charge of 1 fits under the cap, when settlement halts, then the HALT names the `laps` allowance, its `Pending growth: 1 (prd_audit 1)` line ends with `when build dispatches` and has no `minimum raise` segment, the recovery line keeps the `--by «N»` placeholder, and `HALT.class` is `kickback-cap`.
- Given a routed round whose receipt declares growth 0 and whose allocation is empty, when it is refused on laps, then the HALT carries no `Pending growth:` line and its `Plan growth:` line is identical to the one rendered for the same ledger with no pending charge.

### Done When
- [ ] A test drives `Conductor.run()` through BUILD settlement for the `r8` routed fixture and asserts the HALT's first line, both growth lines, `--gate prd_audit --by 1`, and the `kickback-cap` class.
- [ ] A test with an unrecorded earlier settled receipt asserts the halt reports the reconciled settled growth of 8, not the pre-reconciliation 6, and that the cap evidence records 8 and 10.
- [ ] A lap-exhaustion test asserts no `minimum raise` segment and the `«N»` placeholder.

## Story 2: Raising growth by the stated minimum admits the routed round at the next dispatch

**Requirement:** #3456 desired outcome 1

As an operator who raised the growth cap by exactly the minimum a routed halt stated, I want the next BUILD dispatch to settle that round, so that one halt costs one raise.

### Acceptance Criteria

#### Happy Path
- Given the `r8` halt stating `minimum raise 1` with settled growth 13 and cap 14, when the operator raises the growth allowance by 1, so the flat ledger's effective growth cap is 15, and BUILD dispatches again, then settlement returns `settled`, the route record's receipt gains a settlement id, the flat ledger records growth added 15 and `prd_audit` laps increased by 1, no HALT is written, and the BUILD step is dispatched.

#### Negative Paths
- Given the same halt and no raise, when BUILD dispatches again, then settlement halts again stating `minimum raise 1`, the route record's receipt still has no settlement id, and the flat ledger's growth and gate laps are unchanged.
- Given a routed halt stating `minimum raise 7` for settled growth 0, cap 10, and round growth 17, when the operator raises the growth allowance by 6, so the effective growth cap is 16, and BUILD dispatches again, then settlement halts again with `Plan growth: 0/16 added; 0 remaining (raised cap)` and `minimum raise 1`, and charges nothing.

### Done When
- [ ] A test applies a growth raise equal to the halt's stated minimum and asserts the next `settleRoundAtDispatch` returns `settled`, with ledger growth added equal to the old cap plus the raise.
- [ ] A test raising by one less than the stated minimum asserts a second halt stating `minimum raise 1` and an unsettled receipt.

## Story 3: A routed round's cap halt names the round, its findings, and the tasks it would add

**Requirement:** #3456 desired outcome 2; #3476 desired outcomes 1 and 3

As an operator reading a cap halt on a stacked feature, I want it to name the routed round, its finding ids, and the remediation tasks it needs to add, so that I know what the raise buys without reading git refs.

### Acceptance Criteria

#### Happy Path
- Given the `r8` routed fixture whose items carry finding ids `S1.1` and `S3.1` and whose allocation gives host 1 tasks `rem-prd-audit-6.r1` and `rem-prd-audit-6.r2`, when settlement halts, then the HALT contains the line `Routed round r8 findings: S1.1, S3.1` followed by the line `Routed round r8 remediation tasks: rem-prd-audit-6.r1, rem-prd-audit-6.r2`, and contains no `repair record is malformed` text.
- Given a routed round `r1` whose allocation gives host 1 task `rem-ab-1.r1` and host 2 tasks `rem-ab-1.r2, rem-ab-1.r3, rem-ab-1.r4`, and whose record carries pending as-built finding `AB-1` (class `REMEDIABLE`, governing clause `adr-x D2`, summary `drift`), when settlement halts on `architecture_review_as_built`, then the HALT contains `Routed round r1 remediation tasks: rem-ab-1.r1, rem-ab-1.r2, rem-ab-1.r3, rem-ab-1.r4` in host order and a `Blocking findings:` block containing `AB-1 (REMEDIABLE; adr-x D2): drift`.
- Given the `r8` halt, when its cap evidence is recorded, then the evidence's latest reason is `Routed round r8 findings: S1.1, S3.1` and contains no `repair record is malformed` text.

#### Negative Paths
- Given a routed round `r3` refused on laps whose only item is an existing-task repair bound to tasks `4` and `7` under finding id `S2.1`, with an empty allocation, when settlement halts, then the HALT contains `Routed round r3 findings: S2.1` and `Routed round r3 repairs existing tasks: 4, 7`, prints no `remediation tasks` line, and contains no `repair record is malformed` text.
- Given a flat (non-routed) pending repair that is refused on growth, when settlement halts, then the HALT's `Findings (<gate>):`, `Also pending`, and `Pending remediation tasks:` lines are byte-identical to their rendering before this change and no `Routed round` line appears.

### Done When
- [ ] A conductor test asserts both `Routed round r8` lines and the absence of `repair record is malformed` in the `r8` halt.
- [ ] A test asserts host-ordered task ids and the `Blocking findings:` entry for the two-host as-built round.
- [ ] A test asserts the cap evidence's latest reason for the `r8` halt.
- [ ] The existing flat-repair halt tests in `test/engine/conductor-kickback-transition.test.ts` pass unchanged.

## Story 4: A routed round whose route record cannot be read halts needs-human and names the record

**Requirement:** #3456 desired outcome 3; #3476 desired outcome 3

As an operator, I want a halt that reports an unreadable routed record to carry the `needs-human` class and name the record, and a halt that does not involve an unreadable record never to call one malformed, so that I can tell corruption from a routine cap overrun.

### Acceptance Criteria

#### Happy Path
- Given a routed feature whose ref `refs/conductor/<slug>/routes/r8` holds content that does not parse as a route record, when BUILD dispatch settlement runs, then the BUILD step is not dispatched, `.pipeline/HALT.class` is `needs-human`, the HALT contains `Pending remediation findings are unavailable: ` followed by a reason that names `refs/conductor/<slug>/routes/r8`, it has no `Pending growth:` line, and its recovery line keeps `--by «N»`.
- Given the dispatching round's route record reads as absent or unreadable when `settleRoundAtDispatch` reads it under the ledger lease, when settlement runs, then it returns `halted` with the reason `route record r8 is absent` or `route record r8 is unreadable` rather than `exhausted`, and the conductor's HALT has class `needs-human` and contains that reason.
- Given another round's route ref `r2` is malformed when `settleRoundAtDispatch` reconciles receipts, when settlement runs for `r8`, then it returns `halted` with a reason naming `refs/conductor/<slug>/routes/r2`, charges nothing, and leaves `r8`'s receipt unsettled.

#### Negative Paths
- Given a routed round whose settlement halts because the round has an open restack journal, when the HALT is written, then it has class `needs-human`, contains `Pending remediation findings are unavailable: routing round r8 has an open restack journal.`, and contains no `malformed` text.
- Given a non-routed feature whose flat pending repair is malformed, when settlement fails closed, then the HALT keeps `Pending remediation findings are unavailable because the repair record is malformed.`, the `needs-human` class, and the `«N»` placeholder, exactly as before this change.

### Done When
- [ ] A conductor test with an unparseable `r8` ref asserts the `needs-human` class, the reason naming the ref, no `Pending growth:` line, and BUILD not dispatched.
- [ ] `settleRoundAtDispatch` tests assert `halted` with the named reason for an absent current record, an unreadable current record, and a malformed sibling record found during reconciliation, replacing the prior `exhausted` expectation.
- [ ] A conductor test for the open-restack-journal halt asserts the reason-bearing findings line and no `malformed` text.

## Story 5: kickback-budget inspect and daemon status report the growth cap the dispatching engine enforces

**Requirement:** #3456 desired outcome 4

As an operator sizing a raise, I want `kickback-budget inspect` and `daemon status` to report the same config-derived growth cap as the BUILD halt for the same feature at the same moment, so that the raise I compute from either is correct.

### Acceptance Criteria

#### Happy Path
- Given a main checkout whose project config sets `prd_audit.max_appended_tasks: 8` and `max_appended_ratio: 0.8`, a linked feature worktree whose checked-out config sets `max_appended_tasks: 10`, a sealed authored count of 20, settled growth 6, and no raised cap, when the operator runs `ai-conductor kickback-budget inspect --feature <slug>`, then each remediation gate's human output contains `Plan growth: 6/8 added; 2 remaining (config-derived cap)` and the `--format json` output's `planGrowth.cap` is 8.
- Given the same feature, when the operator runs `ai-conductor daemon status`, then its `PLAN GROWTH [<slug>...]` line contains `remaining 2/8`.
- Given the same feature and a BUILD halt produced for it by a conductor whose config is the main checkout's, when inspect runs, then the cap in inspect's `Plan growth:` line equals the cap in the halt's `Plan growth:` line.

#### Negative Paths
- Given the same feature with a raised growth cap of 9 in its flat ledger, when inspect and daemon status render, then both report cap 9 with `(raised cap)` on inspect, whichever config either checkout carries.
- Given a main checkout with no project config file while the feature worktree's config sets `max_appended_tasks: 10`, when inspect renders for an authored count of 20, then it reports the default-derived cap of 5, which is what a conductor started with no project config enforces, not 10.

### Done When
- [ ] An inspect test with diverging main-checkout and worktree configs asserts `6/8` in human output and `cap: 8` in JSON.
- [ ] A daemon status test with the same fixture asserts `remaining 2/8`.
- [ ] A test asserts the inspect cap equals the halt cap for one fixture.
