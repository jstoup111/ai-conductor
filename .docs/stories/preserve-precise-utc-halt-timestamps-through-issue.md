# Stories: Preserve precise UTC halt timestamps through issue resolution

Source: jstoup111/ai-conductor#2176

## Story 1: Preserve the actual UTC halt instant

**Requirement:** Issue outcome 1.

As a halt-issue operator, I want the monitor's full halt timestamp preserved so that the freshness guard compares the event that occurred rather than a local-time approximation.

### Acceptance Criteria

#### Happy Path
- H1: Given a monitor NEW HALT timestamp `2026-07-04T11:58:38.984Z`, when its filed-issue verdict is parsed, then haltAt remains that exact UTC millisecond timestamp.
- H2: Given multiple valid NEW HALT timestamps for the same slug, including two in the same second, when verdicts are parsed, then the newest instant is selected regardless of line order, retaining its millisecond precision.

#### Negative Paths
- N1: Given no precise valid halt time for a verdict, when it is parsed, then no precise time is invented by padding missing digits, choosing a timezone, or substituting processing time.

### Done When
- [ ] The real monitor-log fixture and focused .984Z example produce full source timestamp strings.
- [ ] Out-of-order .100Z/.900Z timestamps select .900Z; missing, timezone-less, and invalid timestamp inputs supply no fabricated precise instant.

## Story 2: Only evidence strictly after a precise halt can resolve

**Requirement:** Both issue outcomes and approved legacy-retention policy.

As an operator, I want automatic closure refused when the halt instant is unknown or shipping evidence is not later, so a precision error cannot close an unresolved issue.

### Acceptance Criteria

#### Happy Path
- H1: Given a precise valid UTC halt time and otherwise qualifying processed-marker or shipped-record evidence, when the evidence mtime is one millisecond after the halt, then local resolution allows closure with the existing PR URL and evidence kind.

#### Negative Paths
- N1: Given the same evidence at one millisecond before or exactly at the halt, when resolution runs, then closure is refused with the existing freshness-guard reason.
- N2: Given a legacy timezone-less time, a seconds-only time, an empty value, or an invalid date, when resolution runs even with apparently newer shipping evidence, then it refuses automatic closure with a named imprecise-halt-time reason. It never infers missing milliseconds or a timezone.
- N3: Given these cases on UTC, UTC+2, and America/New_York hosts, when the same local resolution runs, then the outcomes are identical.

### Done When
- [ ] Both evidence sources accept halt+1ms and refuse halt-1ms/equal, preserving their existing PR/evidence responses.
- [ ] Every imprecise/invalid timestamp fixture remains unresolved; results do not vary across the named host timezones.

## Story 3: Recover legacy precision before deciding the current sweep

**Requirement:** Operator-approved compatibility policy and complete runtime delivery of both outcomes.

As an operator with an existing ledger, I want exact source recovery to take effect immediately so that rerunning the sweep neither uses nor persists its old truncated snapshot.

### Acceptance Criteria

#### Happy Path
- H1: Given an existing imprecise ledger entry and its precise current monitor-log timestamp, when a sweep processes the verdict, then that sweep evaluates evidence using the recovered time and persists the recovered timestamp while preserving issue identity, status, and existing stamp metadata.
- H2: Given the recovered time, when otherwise qualifying evidence is one millisecond later, then normal mode can close the issue through the existing tracker seam; an earlier/equal timestamp does not qualify.

#### Negative Paths
- N1: Given a legacy entry with no recoverable precise source time, when swept with shipping evidence, then it stays open and is counted as guarded; its timestamp is not guessed. An already-stamped guarded entry makes no tracker call.
- N2: Given dry-run mode, when precise recovery is possible, then the same recovered time governs planned actions, but no ledger or tracker writes occur. An imprecise unrecoverable entry produces no planned close.
- N3: Given a new verdict with no timestamp, when swept, then current wall-clock time is not stored as the halt instant and no automatic close occurs. A precise stored time is not overwritten merely because a later parse supplies no replacement timestamp.

### Done When
- [ ] Through the real sweep with faithful injected filesystem/tracker adapters, a .984Z source replaces the old seconds-only value before evidence comparison and survives final ledger writing.
- [ ] The same sweep refuses .983Z/equal evidence and allows .985Z evidence only through the existing close-on-ship policy.
- [ ] Dry-run preserves input ledger bytes and makes zero tracker writes; unrecoverable stamped entries remain guarded without tracker calls, and missing timestamps never become clock.now().

## Coverage dispositions

Task 1 owns Story 1 through parser unit tests. Task 2 owns Story 2 through resolver tests with injected mtimes and the same scoped checks under the three TZ environments. Task 3 owns Story 3 through the existing real sweep/parser/ledger/resolver/closer flow with faithful MockFs/MockGh adapters, plus focused ledger merge tests. This single application-service boundary is sufficient; no full daemon or additional acceptance/system spec is required.

Every criterion is diff-local. Invalid input, unknown precision, same-second data integrity, alternate dry-run flow, and state-update ordering are covered above. Existing tracker failure isolation and keep-open behavior remain under their existing tests. No new network call, timer, concurrency mechanism, resource allocation, deletion, or exception hierarchy is introduced.

**Status:** Accepted
