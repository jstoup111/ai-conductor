**Status:** Accepted

# Stories: Growth-exhausted BUILD halt shows the pending growth charge and the halting gate's findings

Source: jstoup111/ai-conductor#3153 (consolidating #3247 and #3314). Track: technical (no PRD). Tier: S.

A remediation append authorizes plan growth without spending it; the BUILD dispatch settlement
charges every pending gate's growth against the one shared cap, all or nothing. Every operator
surface today reports settled growth only, so a growth-exhausted halt reads `Plan growth: 0/10
added; 10 remaining` while 11 tasks are pending, and its `Findings:` line can name another gate's
criteria. These stories make every surface report the pending growth charge from the same figure
settlement enforces, so the halt alone tells the operator the minimum raise that admits the
repair. Routed-host round receipts, lap-allowance mechanics (#2060), the cap formula, raise/reset
binding, and the ledger schema are unchanged.

## Story 1: A growth-exhausted BUILD halt shows the pending growth charge and the minimum raise

**Requirement:** #3153 desired outcomes 1, 2, 4; #3247/#3314 outcome 1

As an operator reading a growth-exhausted BUILD halt, I want it to state the pending growth per gate and in total next to the settled growth and the cap, and the minimum raise that admits it, so that I can recover from the HALT text alone without reading the ledger or engine source.

### Acceptance Criteria

#### Happy Path
- Given a feature with settled growth 0, a config-derived growth cap of 10, and a flat pending repair charging `prd_audit` growth 3 and `architecture_review_as_built` growth 8 with lap allowance to spare, when BUILD dispatch settlement halts, then the HALT contains `Plan growth: 0/10 added; 0 remaining (config-derived cap)` followed by `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`.
- Given the same halt, when the operator reads its recovery line, then it reads `Plan-growth allowance exhausted. Recover with: ai-conductor kickback-budget raise --feature <slug> --gate architecture_review_as_built --by 1 --rationale "«why»"` with the computed minimum raise in place of `«N»`.
- Given a feature with settled growth 9, a raised growth cap of 13, and a pending repair charging `prd_audit` growth 3 and `architecture_review_as_built` growth 2, when settlement halts, then the HALT contains `Plan growth: 9/13 added; 0 remaining (raised cap)` and `Pending growth: 5 (prd_audit 3, architecture_review_as_built 2); would reach 14/13 when build dispatches; minimum raise 1`.
- Given a feature whose settled growth already equals its cap of 10 and whose pending repair charges `prd_audit` growth 2 only, when settlement halts, then the HALT contains `Plan growth: 10/10 added; 0 remaining (config-derived cap)` and `Pending growth: 2 (prd_audit 2); would reach 12/10 when build dispatches; minimum raise 2`, naming `prd_audit` as the halting gate.

#### Negative Paths
- Given a pending repair record that is present but malformed, when settlement fails closed, then the HALT keeps its existing `Kickback budget (prd_audit): growth allowance unavailable (...)` detail, prints no `Pending growth:` line, keeps the `needs-human` class, and the recovery line keeps the `«N»` placeholder rather than a computed number.
- Given a halt caused by an exhausted lap allowance while the pending repair's growth fits under the cap, when settlement halts, then the HALT names the `laps` allowance as today, its `Pending growth:` line ends with `would reach <n>/<cap> when build dispatches` with no `minimum raise` segment, and the lap recovery line keeps the `«N»` placeholder.
- Given a pending repair whose gate charges carry laps but zero growth, when any surface renders the budget, then no `Pending growth:` line is printed and the `Plan growth:` line is identical to its rendering with no pending repair.

### Done When
- [ ] A test drives BUILD settlement with pending charges `prd_audit` 3 and `architecture_review_as_built` 8 against cap 10 and asserts the HALT body contains both exact lines above and `--by 1` in the recovery command
- [ ] A test with settled growth equal to the cap asserts the `minimum raise 2` line and `prd_audit` as the halting gate
- [ ] A test with a malformed pending repair asserts no `Pending growth:` line, the `«N»` placeholder, and the `needs-human` class

## Story 2: Raising growth by the stated minimum admits the pending repair at the next dispatch

**Requirement:** #3247/#3314 outcome 1; #3153 desired outcome 2

As an operator who raised the growth cap by exactly the minimum a halt stated, I want the next BUILD dispatch to settle the pending repair, so that one halt costs one raise and never a second growth halt for the same repair.

### Acceptance Criteria

#### Happy Path
- Given a growth-exhausted halt stating `minimum raise 1` for settled growth 0, cap 10, and pending growth 11 split across two gates, when the operator raises the growth allowance by 1 and BUILD dispatches again with lap allowance to spare, then settlement charges both gates' laps and growth, records growth `11/11`, clears the pending repair, and writes no HALT.
- Given a pending repair whose total growth fits under the cap, when BUILD dispatches, then settlement charges every gate exactly as before this change: the same per-gate laps and growth increments, the same `plan_growth` event, and the pending repair cleared.

#### Negative Paths
- Given the same halt stating `minimum raise 1` and a growth cap that has not been raised, when BUILD dispatches again, then settlement halts with `minimum raise 1` again, charges no lap or growth to either gate, and leaves the pending repair record byte-identical.
- Given a pending repair whose first gate fits and whose second gate would push the cumulative growth over the cap, when settlement halts, then the halting gate named in the HALT and in the cap evidence is the second gate, as before this change, and neither gate is charged.

### Done When
- [ ] A test raises the growth cap by the halt's stated minimum and asserts the next settlement returns settled with growth added equal to the old cap plus the raise
- [ ] A test with pending growth 12 over cap 10 and a raise of 1 (one short of the stated minimum 2) asserts a second `exhausted` result stating `minimum raise 1` and an unchanged pending repair
- [ ] The existing `settlePendingRepair` suite passes unchanged

## Story 3: The halt's Findings line names the halting gate's findings

**Requirement:** #3153 desired outcome 3

As an operator reading a BUILD dispatch halt, I want the `Findings:` line to name the findings of the gate that halted, so that I act on the right gate while still seeing every pending finding.

### Acceptance Criteria

#### Happy Path
- Given a pending repair carrying `prd_audit` criteria `S5.1, S5.2, S5.3` and as-built findings `as-built:a:1` and `as-built:a:2`, when settlement halts on `architecture_review_as_built`, then the HALT contains `Findings (architecture_review_as_built): as-built:a:1, as-built:a:2` and `Also pending (prd_audit): S5.1, S5.2, S5.3`, and the cap evidence's latest reason names the as-built findings first.
- Given the same pending repair, when settlement halts on `prd_audit`, then the HALT contains `Findings (prd_audit): S5.1, S5.2, S5.3` and `Also pending (architecture_review_as_built): as-built:a:1, as-built:a:2`.
- Given a pending repair charging only `prd_audit` with criteria `S1.1`, when settlement halts on `prd_audit`, then the HALT contains `Findings (prd_audit): S1.1` and no `Also pending` line.

#### Negative Paths
- Given a halt on `architecture_review_as_built` whose pending repair records no as-built findings but lists task ids `rem-1, rem-2`, when the HALT renders, then it contains `Pending remediation tasks: rem-1, rem-2` rather than another gate's criteria under that gate's `Findings` label.
- Given a malformed pending repair, when settlement fails closed, then the HALT keeps `Pending remediation findings are unavailable because the repair record is malformed.` and names no gate's findings.

### Done When
- [ ] A test halting on `architecture_review_as_built` with both gates' findings pending asserts the `Findings (architecture_review_as_built):` and `Also pending (prd_audit):` lines and that no `Findings: S5.1` line appears
- [ ] A test halting on `prd_audit` asserts the mirrored lines
- [ ] The `Blocking findings:` detail block is unchanged

## Story 4: daemon status and kickback-budget inspect show the same pending growth figure

**Requirement:** #3247/#3314 outcomes 2, 3

As an operator checking a feature before or after a halt, I want `daemon status` and `kickback-budget inspect` to show the same pending growth figure next to `Plan growth`, so that I can see an impending growth halt without waiting for the dispatch.

### Acceptance Criteria

#### Happy Path
- Given a feature with authored 40, settled growth 0, cap 10, and a pending repair charging `prd_audit` growth 3 and `architecture_review_as_built` growth 8, when the operator runs `ai-conductor kickback-budget inspect --feature <slug>`, then the human output for each remediation gate contains `Plan growth: 0/10 added; 0 remaining (config-derived cap)` and `Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1`.
- Given the same feature, when the operator runs inspect with `--format json`, then each view's `planGrowth` carries `remaining: 0` and `pendingGrowth` equal to `{ total: 11, byGate: { prd_audit: 3, architecture_review_as_built: 8 }, projected: 11, minimumRaise: 1 }`.
- Given the same feature, when the operator runs `ai-conductor daemon status`, then its plan growth line reads `PLAN GROWTH [<slug>]: authored 40; added 0; remaining 0/10; pending 11 (prd_audit 3, architecture_review_as_built 8), minimum raise 1`.
- Given a feature with settled growth 2, cap 10, and pending growth 3 for `prd_audit` only, when either surface renders, then inspect shows `Plan growth: 2/10 added; 5 remaining (config-derived cap)` and `Pending growth: 3 (prd_audit 3); would reach 5/10 when build dispatches`, and daemon status shows `remaining 5/10; pending 3 (prd_audit 3)` with no minimum raise.

#### Negative Paths
- Given a feature with no pending repair, when either surface renders, then the output is byte-identical to its output before this change: no `Pending growth:` line, no `pending` segment, and no `pendingGrowth` JSON field.
- Given a feature whose ledger growth record is unreadable, when daemon status renders, then the plan growth line keeps its existing `unavailable (...)` form with no pending segment, and inspect exits with its existing unreadable-ledger refusal.
- Given a feature whose plan is unresolved and whose pending repair charges growth 4, when daemon status renders, then the line keeps its `plan unresolved; added <n>` form and appends `; pending 4 (<gate> 4)` without inventing a cap or minimum raise.
- Given a routed-host round whose pending growth lives in a route receipt rather than a flat pending repair, when either surface renders, then the output is unchanged from before this change.

### Done When
- [ ] An inspect test asserts the human `Pending growth:` line and the JSON `pendingGrowth` object and `remaining: 0` for the two-gate fixture
- [ ] A daemon status test asserts the exact `PLAN GROWTH` line with the `pending` segment for the same fixture
- [ ] A test with no pending repair asserts byte-identical inspect human output, JSON output with no `pendingGrowth` key, and daemon status output
- [ ] The halt, inspect, and daemon status figures for the same fixture agree on total, per-gate breakdown, and minimum raise
