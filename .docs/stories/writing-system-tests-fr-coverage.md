**Status:** Accepted

# Stories: FR→Acceptance-Spec Coverage Gate for Acceptance-Test Generation

PRD: `.docs/specs/2026-07-04-writing-system-tests-fr-coverage.md`
Tier: S (negative paths per story)

## Story: Coverage table has exactly one row per PRD FR

**Requirement:** FR-1

As the operator, I want the acceptance-test step to emit a coverage table with exactly one row
per FR-N in the approved PRD, so that no requirement can be silently unaccounted for.

### Acceptance Criteria

#### Happy Path
- Given a product-track feature whose approved PRD enumerates FR-1..FR-7, when the
  acceptance-test-generation step completes, then the emitted coverage table contains exactly 7
  rows whose FR identifiers are exactly FR-1..FR-7.

#### Negative Paths
- Given an approved PRD enumerating FR-1..FR-5, when the step drafts a coverage table that
  omits FR-4 (or invents an FR-6 absent from the PRD), then the step treats the table as
  invalid, reports the mismatched FR identifiers, and does not complete.

### Done When
- [ ] The skill's documented process includes a step that parses the enumerated FR-N list from
      the approved PRD and builds a table keyed by those identifiers, with an explicit
      row-count-equals-FR-count check.
- [ ] The skill's documented failure output names missing and invented FR identifiers.

## Story: Every row resolves to exactly one of three dispositions

**Requirement:** FR-2

As the operator, I want each FR row resolved as spec-covered, unit-covered, or already-tested,
so that skipping an acceptance spec is a deliberate, named decision instead of a silent drop.

### Acceptance Criteria

#### Happy Path
- Given an FR whose stories include a multi-step flow, when specs are generated, then that FR's
  row carries the spec-covered disposition.
- Given an FR whose stories are all single-operation (§3a unit-covered), when specs are
  generated, then that FR's row carries the unit-covered disposition citing the story that
  carries the FR.
- Given an FR whose behavior an existing test already asserts (§2 overlap check), when specs
  are generated, then that FR's row carries the already-tested disposition citing that test.

#### Negative Paths
- Given an FR row marked with two dispositions at once, or a disposition outside the three
  allowed values, when the table is finalized, then the step treats that row as unresolved and
  does not complete.

### Done When
- [ ] The skill's documented process defines the three dispositions and maps them to the
      existing §2 (already-tested) and §3a (unit-covered) classification outcomes.
- [ ] The disposition set is closed — the documented rule states any other value is unresolved.

## Story: Specs name the FR they cover, searchably

**Requirement:** FR-3

As the SHIP-phase auditor, I want every acceptance spec that covers an FR to identify that FR
visibly in the spec, so I can find an FR's tests by searching for its identifier.

### Acceptance Criteria

#### Happy Path
- Given a generated acceptance spec counted as covering FR-3, when a reader searches the
  project's acceptance-test directory for the FR identifier, then that spec is found (the
  identifier appears in the spec's describe/name text or a leading comment).

#### Negative Paths
- Given a spec-covered row whose named spec file does not contain the FR identifier anywhere,
  when the table is finalized, then that row is unresolved and the step does not complete.

### Done When
- [ ] The skill's documented spec-generation rules require the FR identifier in each generated
      spec (group name or leading comment), for specs on the product track.
- [ ] The coverage check verifies the identifier's presence in the cited spec file, not just
      the table entry.

## Story: Every disposition cites its evidence

**Requirement:** FR-4

As the operator, I want every coverage row to cite concrete evidence — spec file(s), story, or
existing test — so a disposition can be verified rather than trusted.

### Acceptance Criteria

#### Happy Path
- Given a finalized coverage table, when any row is read, then it names at least one concrete
  artifact: spec-covered → generated spec file(s); unit-covered → the story carrying the FR;
  already-tested → the existing test file.

#### Negative Paths
- Given a row whose disposition carries no citation, or cites a file/story that does not exist
  in the worktree, when the table is finalized, then that row is unresolved and the step does
  not complete.

### Done When
- [ ] The skill's documented table format includes a mandatory evidence column.
- [ ] The documented check requires each cited artifact to exist on disk (spec/test file) or in
      `.docs/stories/` (story).

## Story: An unresolved FR blocks completion

**Requirement:** FR-5

As the operator, I want the acceptance-test step to refuse to complete while any FR is
unresolved, so coverage gaps are fixed in the RED phase instead of surfacing as prd-audit
rework rounds.

### Acceptance Criteria

#### Happy Path
- Given all FR rows resolved with valid citations, when the step finishes its RED run, then it
  completes normally and reports full coverage.

#### Negative Paths
- Given FR-6 has no generated spec, no qualifying single-operation story, and no existing test,
  when the step attempts to complete, then it reports "FR-6 unresolved" (naming each unresolved
  FR explicitly) and does not report success — the pipeline cannot proceed to implementation.
- Given the step is running unattended under the daemon, when unresolved FRs exist, then the
  step's failure is a hard stop of this step (not a logged warning the run continues past).

### Done When
- [ ] The skill's SKILL.md states the blocking rule as a GATE (same enforcement language as its
      existing RED-evidence gate): unresolved FR ⇒ the step MUST NOT report success.
- [ ] The documented failure output lists every unresolved FR identifier with its reason
      (missing row / no disposition / missing citation / cited artifact absent).

## Story: Coverage table recorded as run evidence

**Requirement:** FR-6

As the SHIP-phase auditor, I want the finalized coverage table recorded as run evidence next to
the step's existing RED evidence, so audit starts from an FR→evidence map instead of rebuilding
one.

### Acceptance Criteria

#### Happy Path
- Given the step completes on the product track, when its run evidence is inspected, then the
  coverage table exists alongside the existing RED evidence (gitignored run evidence, not a
  committed `.docs/` artifact) and lists every FR with disposition + citation.

#### Negative Paths
- Given the evidence location is not writable or the table fails to be recorded, when the step
  attempts to complete, then it does not report success (evidence recording is part of the
  gate, mirroring the existing RED-evidence rule).

### Done When
- [ ] The skill documents the evidence file's location/name and format in the same section that
      documents the existing RED-evidence file.
- [ ] The documented completion checklist includes the coverage evidence file's existence.

## Story: Technical track and PRD-less features are untouched

**Requirement:** FR-7

As the operator, I want zero behavioral change on the technical track or when no approved PRD
exists, so this gate never blocks work that has no FR list to cover.

### Acceptance Criteria

#### Happy Path
- Given a technical-track feature (track marker says technical; no PRD in `.docs/specs/`), when
  the acceptance-test-generation step runs, then it performs no FR-coverage work, emits no
  coverage table, and completes exactly as it does today.

#### Negative Paths
- Given a product-track feature whose PRD exists but is not `Status: Approved`, when the step
  runs, then it does not fabricate a coverage table from an unapproved FR list — it surfaces
  the missing-approval state rather than silently proceeding without coverage.

### Done When
- [ ] The skill's documented coverage step is explicitly scoped to "product track with an
      approved PRD" and states the no-op behavior otherwise.
- [ ] The documented no-op path changes nothing about the existing §1–§7 process.
