**Status:** Accepted

# Stories: Grade diffs for event-spine bypasses in build_review (#2043)

Technical track — acceptance criteria derive from the confirmed approach: this repository
declares a project-owned `eventSpine` custom build_review rubric backed by its repo-local
`event-spine` skill, which gains a diff-grading section. Scope boundary (Balanced): every
build_review lap in this repository grades the frozen feature diff; findings block through the
existing adjudicator; new `ConductorEvent` variants, same-schema sibling ledgers, the three
documented exceptions, and ADR-backed channels pass. Excluded: consumer projects, a new built-in
registry rubric, a mechanical pre-scan, and design-time checks at architecture-review.

## Story 1: This repository's build_review dispatches the eventSpine rubric

As the harness maintainer, I want every build_review lap in this repository to run an
event-spine rubric, so that a parallel channel cannot land without a review that looks for it.

### Acceptance Criteria

#### Happy Path
- Given this repository's `.ai-conductor/config.yml`, when the build_review configuration is resolved, then the custom catalog contains exactly one member `eventSpine` that is enabled, names skill `event-spine` with source `project`, and carries a question asking whether the diff adds an observation or coordination channel outside the event spine
- Given a build_review lap for a feature in this repository with adjudication left at its default, when the lap is dispatched, then the lap's members include `eventSpine` alongside the enabled built-in rubrics and its findings join the same aggregate verdict

#### Negative Paths
- Given the `eventSpine` declaration and a provider candidate whose project skill roots contain no `event-spine` skill, when the lap prepares that candidate, then the member settles an infrastructure failure with resolution code `absent` naming skill `event-spine`, no other skill judges it, and the build_review step does not succeed

### Done When
- [ ] Resolving `.ai-conductor/config.yml` through the engine's build_review config resolver yields a custom catalog member `eventSpine` with `enabled: true`, `skill: event-spine`, and `source: project`, asserted by a test that fails before the declaration exists
- [ ] The `event-spine` skill resolves to exactly one project installation from the Claude candidate's project skill roots (`.claude/skills/` and `.agents/skills/`), which the declaration's `llm_provider: claude` routing selects
- [ ] No file under the shipped `skills/` catalog and no built-in registry id in `BUILD_REVIEW_RUBRIC_IDS` changes

## Story 2: A diff that adds a parallel channel fails with a finding naming it

As the harness maintainer, I want the eventSpine rubric to fail a diff that introduces a
channel outside the spine, so that the finding names what to move onto the bus.

### Acceptance Criteria

#### Happy Path
- Given a feature diff that adds a writer of a new bespoke-format ledger or sidecar file that records occurrences, when the eventSpine rubric grades it, then it returns a blocking finding that names the channel and cites the added write as a changed-hunk evidence location
- Given a feature diff that stamps a timestamp, counter, or status field into an existing artifact so a later reader can reconstruct when something happened, when the eventSpine rubric grades it, then it returns a blocking finding that names the stamped field and the artifact
- Given a feature diff that adds a watcher or poller that observes files or state to infer that something happened, when the eventSpine rubric grades it, then it returns a blocking finding that names the watcher
- Given a feature diff that adds an out-of-band IPC path or status endpoint carrying an occurrence between components, when the eventSpine rubric grades it, then it returns a blocking finding that names the path

#### Negative Paths
- Given a feature diff that writes a bespoke-format record into a file that already exists, when the eventSpine rubric grades it, then it still returns a blocking finding, because the violation is judged by schema and reader path rather than by whether the file is new
- Given a feature diff that adds a parallel channel and cites one of the three exceptions while also introducing its own record format, when the eventSpine rubric grades it, then it returns a blocking finding stating that an exception moves the write but never changes the schema

### Done When
- [ ] The `event-spine` skill contains a diff-grading section that states the four channel kinds, the schema-not-file test, and that each finding names the channel and cites a changed-hunk evidence location
- [ ] A build_review lap run against a fixture diff that adds a bespoke-format sidecar ledger records an `eventSpine` finding whose evidence location cites the added write, and the lap's verdict is not a pass

## Story 3: Legitimate spine extensions and documented exceptions pass

As the harness maintainer, I want diffs that extend the spine or fall inside a documented
exception to pass, so that the rubric does not block the work the principle asks for.

### Acceptance Criteria

#### Happy Path
- Given a feature diff that adds a variant to the `ConductorEvent` union and emits it through `ConductorEventEmitter`, when the eventSpine rubric grades it, then it returns no finding for that change
- Given a feature diff that adds a single-writer sibling ledger written in the same `ConductorEvent` schema and merged by the existing reader, justified by exception A or B, when the eventSpine rubric grades it, then it returns no finding for that ledger
- Given a feature diff that adds durable state such as a gate evidence artifact or a committed design document, when the eventSpine rubric grades it, then it returns no finding, because exception C covers state rather than occurrences
- Given a feature diff that adds a new channel together with an approved architecture decision record that names the concern, the applicable exception or why none applies, the channel's consumers, and the reconciliation story, when the eventSpine rubric grades it, then it returns no finding for that channel
- Given a feature diff whose only file writes are inside test files or test fixtures, when the eventSpine rubric grades it, then it returns no finding, because test scaffolding is not a production channel

#### Negative Paths
- Given a feature diff that adds a new channel and an ADR for it whose status is DRAFT or which omits one of the four required elements, when the eventSpine rubric grades it, then it returns a blocking finding naming the channel and the missing approval or element

### Done When
- [ ] The `event-spine` skill's diff-grading section lists the pass cases: a new `ConductorEvent` variant, a same-schema sibling ledger under exception A or B, durable state under exception C, an approved ADR naming all four elements, and test-only writes
- [ ] A build_review lap run against a fixture diff that only adds and emits a new `ConductorEvent` variant records no `eventSpine` finding

## Story 4: eventSpine findings route through the existing adjudicator

As the harness maintainer, I want eventSpine findings to follow the same decision and repair
path as every other rubric, so that a bypass is fixed or refuted rather than re-litigated.

### Acceptance Criteria

#### Happy Path
- Given a build_review lap that returns an `eventSpine` finding, when the post-join adjudication runs, then the finding receives an adjudicator decision and is remediated, deferred, or refuted by the same path the built-in rubrics use

#### Negative Paths
- Given this repository's config with `build_review.adjudication.enabled: false` and the `eventSpine` declaration enabled, when the configuration is loaded, then config validation fails with the existing error `build_review.custom_rubrics.eventSpine cannot be enabled while build_review.adjudication.enabled is false`, rather than running eventSpine findings unadjudicated

### Done When
- [ ] `.ai-conductor/config.yml` leaves `build_review.adjudication` at its default (enabled) and the resolved config reports adjudication enabled alongside the `eventSpine` member
