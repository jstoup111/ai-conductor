**Status:** Accepted

# Stories: Stacked feature cost and time broken down by child (#2946)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/stacked-feature-cost-and-time-cannot-be-broken-dow.md`;
- `architecture-review-2026-10-22-stacked-feature-cost-and-time-cannot-be-broken-dow`, conditions
  C1–C4;
- `adr-2026-10-03-stacked-child-plans-identity-and-state` decision 12, as amended by #2946.

Terms used below:
- **Region step:** `acceptance_specs`, `build`, `test_suite` or `build_review`.
- **Stacked feature:** a feature whose ledger (`.pipeline/events.jsonl`) has at least one event
  carrying a valid `child` (an integer from 1 to 9).
- **Feature with no child:** a feature none of whose ledger events carries `child`. This covers
  single-PR features, an unsliced plan, and `stacked_prs.enabled` off.
- **Two-child ledger:** a ledger with these dispatches:
  - child 1: `build` with cost 1.25 and `test_suite` with cost 0.5;
  - child 2: `build` with cost 2;
  - feature-wide (no child): `manual_test` with cost 0.25 and `prd_audit` with cost 0.75.

  Its terminal step records give child 1 active intervals totalling 60000 ms, child 2 intervals
  totalling 30000 ms, and feature-wide intervals totalling 10000 ms, none overlapping.
- **`## Children` block:** the shipped-record block added by this feature. It sits immediately after
  `## Time` and has this exact shape:
  - a `## Children` heading;
  - a `time: <state>` line carrying the `## Time` block's state;
  - one `child <k>: cost_usd: <n>, dispatches: <n>, active_ms: <n>` line per child, in ascending `k`;
  - one `feature-wide: cost_usd: <n>, dispatches: <n>, active_ms: <n>` line.

  The `, active_ms: <n>` part is present only when the `## Time` block has an `active_ms` line.

## Story 1: A provider dispatch made for a child's region step names that child

**Requirement:** Scope boundary (per-child cost needs per-dispatch child identity); architecture
review C1; ADR decision 12 as amended

As an operator, I want every provider dispatch recorded in the ledger to name the child it was made
for, so that a dispatch's cost can be attributed to a child.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature whose active region child is 2, when the Conductor dispatches `build` through its step runner and the provider attempt succeeds, then the persisted `provider_attempt` record for that dispatch has `"child":2`.
- Given a stacked feature whose active region child is 1, when a `build_review` dispatch makes a provider attempt that fails and then a retry that succeeds, then both persisted `provider_attempt` records for that dispatch have `"child":1`.

#### Negative Paths
- Given a feature with no child, when the Conductor dispatches `build` and the provider attempt succeeds, then the persisted `provider_attempt` record has no `child` key, and every field other than its `ts` timestamp and interval timings equals the record the same dispatch produces without this feature.
- Given a stacked feature whose leaf child 3 is the active region child, when the Conductor dispatches the whole-feature step `prd_audit`, then its persisted `provider_attempt` records have no `child` key.
- Given a stacked feature whose active region child is 1, when a provider attempt is recorded for a step that is not a region step (for example `manual_test`), then the record has no `child` key.
- Given the step runner was constructed before the Conductor with the same provider execution context, when a region dispatch runs, then the persisted `provider_attempt` still carries the active child. A test that calls only the stamping helper directly does not satisfy this criterion.

### Done When
- [ ] An integration test drives a real `Conductor` with a `DefaultStepRunner` built first (the order the daemon executor uses) through a region dispatch while a child is active, and asserts `"child":<k>` on the `provider_attempt` line in `.pipeline/events.jsonl`.
- [ ] The same test with no active child asserts the `provider_attempt` line has no `child` key.
- [ ] A test asserts that a `prd_audit` attempt made while the leaf is active carries no `child` key.

## Story 2: Per-child cost and dispatch counts sum exactly to the feature's Cost block

**Requirement:** Scope boundary (cost and dispatch count per child, summing to the feature total);
architecture review C2

As an operator, I want each child's cost and dispatch count, plus a feature-wide row, so that I can
see which child drove a stacked feature's cost while the rows still add up to the feature total.

### Acceptance Criteria

#### Happy Path
- Given the two-child ledger, when the shipped record is written, then the `## Children` block has `child 1: cost_usd: 1.75, dispatches: 2`, `child 2: cost_usd: 2, dispatches: 1` and `feature-wide: cost_usd: 1, dispatches: 2`, which sum to the `## Cost` block's `cost_usd: 4.75` and `dispatches: 5`.
- Given any ledger with at least one child, when the shipped record is written, then the sum of the rendered `cost_usd` values over every child row and the feature-wide row equals the `## Cost` block's rendered `cost_usd` exactly, and the sum of the `dispatches` values equals its `dispatches` exactly.

#### Negative Paths
- Given a ledger with one dispatch of cost 0.33334 for child 1, one for child 2 and one feature-wide (so each rounds down to 0.3333 at four decimals), when the shipped record is written, then the rows are `cost_usd: 0.3333`, `cost_usd: 0.3334` and `cost_usd: 0.3333`, summing exactly to the `## Cost` block's `cost_usd: 1` rather than to 0.9999, and no row renders a floating-point artifact such as 0.33340000000000003.
- Given a ledger with an event carrying `"child":0`, `"child":10` or `"child":"x"` on a dispatch record, when the shipped record is written, then that dispatch is counted in the feature-wide row, and no `child 0`, `child 10` or `child x` row appears.
- Given a ledger where a stacked child's `provider_attempt` succeeded and its matching `step_completed` also carries `"child":1`, when the shipped record is written, then child 1's `dispatches` counts that dispatch once, not twice.
- Given a ledger with a corrupt (unparseable) line, when the shipped record is written, then the `## Children` rows still sum exactly to the `## Cost` block's `cost_usd` and `dispatches`, and the corrupt line is not counted as a dispatch in any row.
- Given a child that has stamped step events but made no provider dispatch, when the shipped record is written, then it has a row with `cost_usd: 0` and `dispatches: 0`.

### Done When
- [ ] A test over the two-child ledger asserts the exact three rows and that they sum to the `## Cost` block's `cost_usd` and `dispatches`.
- [ ] Tests cover the rounding ledger, the malformed-child ledger and the duplicate-suppression ledger with the exact expected rows.
- [ ] The `## Cost` block text for each test ledger is byte-identical to the text the same ledger produces without this feature.

## Story 3: Per-child active time sums exactly to the feature's Time block

**Requirement:** Scope boundary (active time per child, no double counting across child switches);
architecture review C2

As an operator, I want each child's active time, plus feature-wide active time, so that I can see
which child took the time, with no instant counted twice.

### Acceptance Criteria

#### Happy Path
- Given the two-child ledger with a measured `## Time` block of `active_ms: 100000`, when the shipped record is written, then the `## Children` block has `time: measured`, `active_ms: 60000` on child 1, `active_ms: 30000` on child 2 and `active_ms: 10000` on feature-wide, summing to 100000.
- Given a stacked ledger whose `## Time` block is `partial` with an `active_ms` line, when the shipped record is written, then the block has `time: partial`, and the rows' `active_ms` values sum exactly to that `active_ms`.

#### Negative Paths
- Given a ledger where a child-1 interval of 0–40000 ms overlaps a child-2 interval of 30000–50000 ms and the feature active union is 50000 ms, when the shipped record is written, then child 1 has `active_ms: 40000`, child 2 has `active_ms: 10000` and feature-wide has `active_ms: 0`, and the overlapping 10000 ms is counted once.
- Given a ledger where a feature-wide step's interval overlaps a child's interval, when the shipped record is written, then the overlapping time is counted only in the child's row, and the rows sum exactly to the `## Time` block's `active_ms`.
- Given a stacked ledger whose `## Time` block has no `active_ms` line (state `unavailable`, or `partial` with only a reason), when the shipped record is written, then the block has `time: <that state>` and no row has an `active_ms` field, while the cost and dispatch fields are still rendered.
- Given a stacked ledger where the timing rollup throws, when the shipped record is written, then the `## Time` block shows `state: unavailable` as today, and the `## Children` block has `time: unavailable` and no `active_ms` fields.

### Done When
- [ ] A test over the two-child ledger asserts the exact `active_ms` per row and that they sum to the `## Time` block's `active_ms`.
- [ ] A test over the overlapping-interval ledger asserts the exact rows and the single counting of the overlap.
- [ ] Tests assert that the `active_ms` fields are omitted for an `unavailable` Time block and for a `partial` Time block without `active_ms`.

## Story 4: Only a stacked feature's shipped record gains the block, and nothing else changes

**Requirement:** Scope boundary (single-PR features report exactly as today); architecture review C3
and C4; `adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 1

As an operator, I want the breakdown to appear only for stacked features and never disturb existing
records or the KPI report, so that per-feature accounting and every single-PR record stay exactly as
they are.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature at FINISH, when `conduct shipped-record` runs, then the committed `.docs/shipped/<slug>.md` has the `## Children` block immediately after the `## Time` block and before `## Build Review`, and the frontmatter, `## Cost` and `## Time` text are byte-identical to the text the same ledger produces without this feature.
- Given a committed stacked shipped record with a `## Children` block, when `conduct kpi` parses it, then `parseCostBlock` and `parseTimeBlock` return values equal to those for the same record with the `## Children` block removed.

#### Negative Paths
- Given a feature with no child, when `conduct shipped-record` runs, then the written record is byte-identical to the record written without this feature, with no `## Children` heading, and the existing N=1 golden shipped-record cells pass without being re-recorded.
- Given a stacked feature whose cost rollup throws, when `conduct shipped-record` runs, then the record is written without a `## Cost` block exactly as today, has no `## Children` block, and the command still exits 0.
- Given a stacked feature where building the `## Children` block throws, when `conduct shipped-record` runs, then the record is written without the block, stderr carries one line naming the slug and the error, and the command still exits 0 with every other block unchanged.
- Given a stacked feature whose committed record already matches the newly rendered record including `## Children`, when `conduct shipped-record` re-runs, then it reports the record as already committed and creates no new commit.
- Given a stacked record whose `## Cost` block is missing, when `conduct kpi` parses it, then `parseCostBlock` returns null, as it does for the same record without `## Children`, and does not read any `## Children` row as Cost data.

### Done When
- [ ] A `shipped-record-cli` test over a stacked ledger asserts the block's position and exact text, and that the frontmatter, `## Cost` and `## Time` are byte-identical to the no-feature rendering.
- [ ] A `shipped-record-cli` test over a ledger with no child asserts the whole record is byte-identical to the pre-change rendering.
- [ ] `kpi-report` tests assert equal `parseCostBlock` and `parseTimeBlock` results with and without the block, including when `## Cost` is absent.
- [ ] A test forces the block builder to throw and asserts exit 0, the stderr line, and an otherwise unchanged record.
