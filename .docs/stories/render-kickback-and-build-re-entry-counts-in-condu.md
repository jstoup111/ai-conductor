**Status:** Accepted

# Stories: Render kickback and BUILD re-entry counts in the run report (#2252)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is one new section in the existing run report, attributed per source gate, plus the explicit empty statement and the documentation that currently records the gap. Halt tables, cumulative lap accounting across progress resets, and every other diagnostic surface remain outside this slice.

## Story 1: Read BUILD re-entries and their source gates from the report

### Acceptance Criteria

#### Happy Path

- Given a ledger records kickbacks that re-opened BUILD, when the report is rendered, then it states how many times BUILD was re-entered without the reader inspecting the ledger.
- Given a ledger records kickbacks from several source gates, when the report is rendered, then each source gate appears with its own occurrence count so one re-opening by three gates is distinguishable from three by one gate.
- Given kickbacks are emitted through the real emitter and persisted by the real persister, when the report is rendered over that ledger, then the section reports the same gates and counts that were emitted.

#### Negative Paths

- Given a kickback record carries no recognisable source or target step, when the report is rendered, then the section renders that record under a stable placeholder instead of failing or omitting the whole section.
- Given a ledger contains kickbacks that re-opened a step other than BUILD, when the report is rendered, then the BUILD re-entry figure counts only the records that re-opened BUILD.

### Done When

- [ ] Report fixtures with single-gate, multi-gate, and non-BUILD kickbacks each assert the rendered BUILD re-entry figure and the per-gate rows.
- [ ] A fixture driving the real emitter and persister asserts the rendered section against the emitted kickbacks.
- [ ] A fixture with missing source and target fields asserts a rendered placeholder row and an otherwise intact section.

## Story 2: Distinguish no kickbacks from no reporting, without a second channel

### Acceptance Criteria

#### Happy Path

- Given a ledger records no kickback at all, when the report is rendered, then the section is present and states explicitly that none were recorded.

#### Negative Paths

- Given the report is rendered over a ledger containing kickbacks, when rendering completes, then no file is created, modified, or deleted anywhere under the feature directory.
- Given a ledger contains kickbacks, when the timing and cost rollups are computed over it, then those rollups are unchanged by the presence of kickback records.

### Done When

- [ ] An empty-ledger fixture asserts the section heading and its explicit no-kickbacks sentence.
- [ ] A fixture snapshots the feature directory before and after rendering and asserts an identical listing and identical file contents.
- [ ] The existing rollup-isolation fixture asserts timing and cost equality only, and no longer asserts that the report ignores kickbacks.

## Negative-category review

Input integrity is covered by the malformed-record and non-BUILD-target criteria, which are the only shapes a resilient JSONL parse can hand this section. Absence is covered as its own criterion rather than folded into the happy path, because indistinguishable absence is the defect being fixed. Side-effect freedom is covered by the directory-invariance criterion, which is the observable form of the "no new telemetry channel, file, or side-writing" requirement, and by preserving the existing rollup-isolation proof. Concurrency, permissions, deletion, queueing, datastore, upload, and transaction categories are inapplicable: the section is a pure function over an already-parsed in-memory event array, reached only through a read-only command that opens no network, spawns no process, and holds no lock. Unreadable-ledger handling is already owned by the report's existing error path and is not re-litigated here.
