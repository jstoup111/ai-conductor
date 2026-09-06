**Status:** Accepted

# Stories: Accept trailing tables in a coherence artifact (#1979)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the shared coherence parser's decision
about which pipe-delimited lines belong to the mapping table, the diagnostic it emits when a mapping
row is stranded outside one, and the preservation of every acceptance and every diagnostic the
parser produces today. Verdict vocabulary, cell grammar, row classes, failure reason ids, and the
semantic layers that run after parsing are unchanged.

## Story 1: A complete mapping table is accepted whatever follows it

As a spec author, I want a coherence artifact to be judged on its mapping table so that adding a
summary, a legend, or a per-row-class table below it does not fail my land for a reason the message
does not name.

### Acceptance Criteria

#### Happy Path

- Given a coherence artifact whose first table is a complete, well-formed mapping table and which is followed by a second markdown table carrying no mapping rows, when the shared parser reads it, then it succeeds and returns exactly the mapping table's rows.
- Given that same artifact committed for a non-S tier spec, when daemon discovery and the land gate each read it, then both accept it, so the spec is dispatch-eligible rather than blocked as missing-coherence.
- Given a coherence artifact that carries its mapping rows in more than one table, each of whose first data row is a mapping row, when the shared parser reads it, then every mapping row from every such table is returned, in file order.

#### Negative Paths

- Given a coherence artifact whose trailing table is not a mapping table but contains a row whose first cell is a known mapping row class, when the shared parser reads it, then it is rejected with a detail that names the rule about which table mapping rows must live in, alongside the offending line number.

### Done When

- [ ] A parser case proves an artifact with a well-formed mapping table plus a trailing non-mapping table returns the mapping table's rows and nothing from the trailing table.
- [ ] A discovery case and a land-gate case over one shared fixture both accept the trailing-table shape.
- [ ] A parser case proves mapping rows split across two consecutively-declared mapping tables are returned as one ordered row list.
- [ ] A parser case proves a mapping row inside an ignored trailing table is refused with a detail whose message states the rule and whose line is that row's line.

## Story 2: Nothing that parses today changes its verdict, rows, or diagnostic

As an operator, I want the widening to be provably conservative so that a merged spec that builds
today cannot become unparseable, and a malformed artifact keeps the precise diagnostic that tells
its author what to fix.

### Acceptance Criteria

#### Happy Path

- Given every fixture in the shared coherence regression corpus, when the shared parser reads each one, then each fixture accepted before the change is still accepted and yields an identical row list.

#### Negative Paths

- Given a mapping table row with the wrong cell count, an unknown row class, an empty id, an empty verdict, an empty criterion, an unknown verdict, an unknown disposition, or no cited task id, when the shared parser reads it, then the failure reason id, line number, and message are the ones the parser emits today.
- Given an artifact that is absent, is empty, contains no table at all, or whose first table's header is not followed by a separator row, when the shared parser reads it, then the existing failure reason and detail are returned unchanged.

### Done When

- [ ] The shared regression corpus records the trailing-table fixture as parser-accepted and no corpus fixture accepted before the change is recorded as rejected.
- [ ] The existing per-message parser refusal cases pass unedited, proving reason id, line, and message text are untouched.
- [ ] A parser case pins the extracted rows of an accepted multi-row artifact so a re-segmentation that dropped or reordered rows would fail.

## Negative-category review

Invalid input is the dominant category here and is covered by both the stranded-mapping-row case and
the unchanged malformed-row cases. Data integrity maps to the pinned row lists and the corpus
equality assertion, which is what would catch a silent drop — the one genuinely dangerous outcome of
widening a parser. Partial failure maps to the rule that a table is either parsed strictly or ignored
whole, never half-read. The parser is a pure text-to-value function with no clock, network,
filesystem, concurrency, permission, resource, deletion, or dependency surface, so timeouts,
auth failures, concurrent access, resource exhaustion, cascade deletion, and dependency
unavailability are inapplicable.
