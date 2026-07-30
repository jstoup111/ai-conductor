**Status:** Accepted

# Stories: Durable Provider-Time Attribution (#1101)

**Track:** Product  
**Tier:** Medium  
**Source:** `jstoup111/ai-conductor#1101`  
**PRD:** `2026-07-29-durable-provider-time-attribution.md`  
**Architecture:** `adr-2026-07-29-engine-observed-provider-time-partition.md`

## Story 1: Observe every built-in provider process without changing its outcome

**Requirement:** FR-1, FR-2, FR-7

As a harness operator, I want every actually started provider process measured by the harness so
failed attempts and provider differences do not disappear from feature timing.

### Acceptance Criteria

#### Happy Paths

- Given either built-in provider starts a process through any supported automatic, collaborative,
  or self-host invocation path, when the process exits successfully, then the attempt carries one
  non-negative engine-observed interval for that process.
- Given an invocation walks through unavailable models, retries a step, or falls back to another
  provider, when several provider processes actually start, then each started process contributes its
  own interval to the feature evidence.
- Given a provider also reports its own service or model duration, when engine-observed timing is
  recorded, then both quantities remain separately identifiable and neither changes the meaning of
  the other.

#### Negative Paths

- Given a provider process exits unsuccessfully or is killed by the existing stall behavior, when
  the attempt is classified, then its observed interval is retained and its existing failure outcome
  is unchanged.
- Given a candidate is skipped because no process is started, when timing evidence is produced, then
  the candidate contributes no interval and no synthetic zero-duration process is invented.
- Given timing evidence cannot be observed or propagated for a started process, when the feature is
  summarized, then timing is partial rather than complete and the missing timing does not authorize
  success, failure, retry, or fallback.

### Done When

- [ ] Acceptance coverage proves one interval per started process for Claude and Codex across normal,
      collaborative, failure, and self-host paths.
- [ ] A multi-model plus cross-provider sequence retains every started-process interval and omits
      skipped candidates.
- [ ] Provider-reported duration and engine-observed duration remain independently assertable.

## Story 2: Count overlapping provider activity once on the elapsed-time axis

**Requirement:** FR-3

As a harness operator, I want concurrent provider processes counted once in elapsed time so the
provider-active total describes latency rather than cumulative parallel capacity.

### Acceptance Criteria

#### Happy Paths

- Given provider intervals of 100–300 ms and 200–400 ms, when provider-active time is calculated,
  then the result is 300 ms—the union from 100 through 400—not the 400 ms sum.
- Given disjoint provider intervals, when provider-active time is calculated, then each interval
  contributes its full duration.

#### Negative Paths

- Given nested, adjacent, duplicated, or input-order-shuffled intervals, when they are aggregated,
  then the result is deterministic and never double-counts elapsed time.
- Given an interval is negative, non-finite, missing an endpoint, or otherwise malformed, when it is
  encountered, then it cannot inflate measured provider time and the evidence state becomes partial.

### Done When

- [ ] A deterministic interval corpus covers overlapping, disjoint, nested, adjacent, duplicate, and
      shuffled inputs with exact expected totals.
- [ ] Malformed intervals produce partial evidence without a negative, infinite, or fabricated total.

## Story 3: Partition active feature execution exactly

**Requirement:** FR-4

As a harness operator, I want provider-active and no-provider-active elapsed time to partition active
feature execution so I can compare the two without counting parked or duplicate time.

### Acceptance Criteria

#### Happy Paths

- Given one or more completed active-step intervals and provider intervals contained within them,
  when feature timing is summarized, then active elapsed time is the union of active steps,
  provider-active time is the provider union within it, and no-provider-active time is their exact
  non-negative difference.
- Given active steps overlap because validation work runs concurrently, when feature timing is
  summarized, then the overlapping step time is counted once.

#### Negative Paths

- Given a feature is parked or idle between two active step intervals, when timing is summarized,
  then that inactive gap is not counted as no-provider-active execution.
- Given a provider interval falls outside known active-step evidence, or a started step lacks terminal
  evidence, when timing is summarized, then the record is partial rather than forcing the interval
  into a complete partition.
- Given no trustworthy active-step timing exists, when timing is summarized, then the state is
  unavailable and neither component is presented as a measured zero.

### Done When

- [ ] Concurrent-step and provider-overlap examples satisfy `active = provider-active +
      no-provider-active` exactly.
- [ ] Parked gaps, out-of-bound provider evidence, and incomplete steps have explicit expected states.
- [ ] No accepted input can produce a negative component or a component larger than active time.

## Story 4: Keep timing durable and visible after shipment

**Requirement:** FR-5, FR-6

As a harness operator, I want the feature timing partition committed and reportable so workspace
cleanup cannot erase the evidence I need for performance prioritization.

### Acceptance Criteria

#### Happy Paths

- Given a feature has complete timing evidence, when it ships, then its committed shipment record
  contains the measured active, provider-active, and no-provider-active values plus an unambiguous
  measured state.
- Given the feature workspace has been removed, when the durable performance report is read, then it
  displays the committed timing partition without accessing transient execution data.

#### Negative Paths

- Given timing evidence is partial or unavailable at shipment, when the record is committed, then
  shipment preserves the available state and values without presenting a complete total or blocking
  otherwise valid shipment.
- Given a committed timing section is malformed, when the durable report reads it, then the affected
  feature is marked partial or unavailable and other feature records still render.

### Done When

- [ ] A ship-to-report acceptance path proves timing survives removal of the feature workspace.
- [ ] The durable report renders measured, partial, and unavailable records distinctly.
- [ ] A malformed timing section does not crash or suppress unrelated feature reporting.

## Story 5: Preserve history and allow additive timing refinement

**Requirement:** FR-8, FR-9, FR-10

As a harness maintainer, I want timing records to distinguish unknown history and accept additive
future fields so #1101 never rewrites existing cost or timing meanings.

### Acceptance Criteria

#### Happy Paths

- Given a historical shipment record with no timing section, when it is read after #1101, then its
  existing non-timing data remains available and timing is explicitly unavailable.
- Given a future record subdivides no-provider-active time or adds cumulative-work fields, when the
  #1101-compatible reader processes it, then the original provider-active and no-provider-active
  meanings remain unchanged and recognized fields still render.
- Given a record contains existing provider-reported duration or cost data, when the new timing
  section is added, then those existing values and classifications remain unchanged.

#### Negative Paths

- Given an older record lacks timing fields, when it participates in aggregate reporting, then the
  reader never substitutes zero or includes it in a measured timing average.
- Given a timing section contains unknown additive fields, when an older compatible reader processes
  it, then unknown fields do not corrupt recognized timing or non-timing data.
- Given a feature was built partly before and partly after timing capture became available, when it
  ships, then it is marked partial and does not masquerade as either fully measured or wholly absent.

### Done When

- [ ] Historical no-timing, mixed-version partial, and future-additive records have pinned read behavior.
- [ ] Existing cost and provider-reported duration fixtures are byte-for-byte or semantically unchanged,
      as appropriate to their existing contract.
- [ ] Aggregate timing excludes unavailable records and identifies partial records without fabricating zero.

## Requirement Coverage

| Requirement | Stories |
|---|---|
| FR-1 | Observe every built-in provider process without changing its outcome |
| FR-2 | Observe every built-in provider process without changing its outcome |
| FR-3 | Count overlapping provider activity once on the elapsed-time axis |
| FR-4 | Partition active feature execution exactly |
| FR-5 | Keep timing durable and visible after shipment |
| FR-6 | Keep timing durable and visible after shipment |
| FR-7 | Observe every built-in provider process without changing its outcome |
| FR-8 | Preserve history and allow additive timing refinement |
| FR-9 | Preserve history and allow additive timing refinement |
| FR-10 | Preserve history and allow additive timing refinement |
