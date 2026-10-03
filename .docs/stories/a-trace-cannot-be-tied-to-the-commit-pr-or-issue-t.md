**Status:** Accepted

# Stories: a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t

Technical track, Tier M. Governing decisions: adr-014-otel-observability-exporter D18 (provenance rides existing events, resolved at the emit site), D19 (placement), and D20 (`otel.provenance` toggles, all default on). Source: jstoup111/ai-conductor#2000. Scope boundary: `.docs/track/a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t.md`.

## Story 1: Terminal run events carry the built commit, the base, and the PR disposition

**Requirement:** adr-014 D18

As a telemetry consumer, I want the events that end a run to state which commit was built, which base it was built against, and whether a PR was expected, so that provenance reaches every subscriber of the event spine.

### Acceptance Criteria

#### Happy Path
- Given a verified run whose worktree HEAD is commit `H`, whose last rebase resolved base `B`, and whose state records a PR URL, when the run completes, then the emitted `feature_complete` event carries `headSha: H`, `baseSha: B`, the existing `prUrl`, and `prDisposition: 'opened'`
- Given a verified run whose finish choice was `keep` and whose state records no PR URL, when the run completes, then `feature_complete` carries `prDisposition: 'none'` and no `prUrl` key
- Given a run that halts after a rebase resolved base `B`, when the halt is emitted, then the `loop_halt` event carries the worktree `headSha`, `baseSha: B`, and a `prDisposition` derived the same way as for completion

#### Negative Paths
- Given a run that halts before any PR exists and with no `keep` finish choice, when the halt is emitted, then `loop_halt` carries `prDisposition: 'unrecorded'` and no `prUrl` key
- Given a worktree where resolving HEAD fails, when the run completes, then `feature_complete` is still emitted with no `headSha` key, and the completion and its DONE marker are not blocked
- Given a run that never rebased, when it completes or halts, then the terminal event carries no `baseSha` key rather than a placeholder value
- Given a pre-existing `events.jsonl` line for `feature_complete` or `loop_halt` with none of the new fields, when the event persister and the metrics listener replay it, then both accept the record without throwing or dropping it

### Done When
- [ ] `feature_complete` and `loop_halt` in the `ConductorEvent` union declare optional `headSha`, `baseSha`, and `prDisposition` fields, with `prDisposition` typed as the closed set `opened`, `none`, `unrecorded`
- [ ] `completeRun` and the centralized `emitLoopHalt` are the only sites that stamp the new fields, and each omits a key whose value is unresolved
- [ ] A unit test asserts each of the three disposition values and asserts `headSha` absence when HEAD resolution fails

## Story 2: Every rebase outcome event carries the base it resolved

**Requirement:** adr-014 D18

As a telemetry consumer, I want every rebase outcome to name the base commit it compared against, so that two runs of the same feature can be compared before and after a rebase.

### Acceptance Criteria

#### Happy Path
- Given a feature branch already current with a base whose tip is `B`, when the rebase step runs, then the emitted `rebase_noop` event carries `baseSha: B`
- Given a clean rebase onto a base whose tip is `B` that changes code paths, when the rebase step runs, then the emitted `rebase_changed` event carries `baseSha: B` alongside its existing changed-path fields
- Given a branch that is behind but cleanly mergeable against base tip `B`, when the rebase step runs, then `rebase_mergeable_skip` still carries `baseSha: B` exactly as it does today

#### Negative Paths
- Given a rebase whose base tip cannot be resolved, when the rebase outcome event is emitted, then it carries `baseSha: null` and the rebase step's outcome is otherwise unchanged
- Given a pre-existing `events.jsonl` line for `rebase_noop` or `rebase_changed` with no `baseSha`, when the event is replayed, then it is accepted without throwing

### Done When
- [ ] `rebase_noop` and `rebase_changed` declare an optional `baseSha: string or null` field in the `ConductorEvent` union
- [ ] The rebase outcome emit block populates `baseSha` for the noop, changed, and mergeable-skip outcomes from the base it resolved
- [ ] A unit test asserts `baseSha` on each of the three outcome events and `null` when the base is unresolvable

## Story 3: The trace resource names the originating tracker issue from run start

**Requirement:** adr-014 D19

As a telemetry consumer, I want every span of a run to carry the tracker issue that asked for the work, so that telemetry joins to the tracker even when the run crashes before it closes.

### Acceptance Criteria

#### Happy Path
- Given a feature whose intake marker carries `Source-Ref: jstoup111/ai-conductor#2000`, when a run of that feature starts with OTel enabled, then the trace Resource carries `conductor.source.ref` equal to `jstoup111/ai-conductor#2000`
- Given that run exports a closed step span and then the process dies before the run span closes, when the backend receives the step span, then the step span's Resource still carries `conductor.source.ref`

#### Negative Paths
- Given a feature with no intake marker, when a run starts, then the trace Resource carries no `conductor.source.ref` attribute and the run starts normally
- Given a feature whose plan path cannot be resolved from its feature description, when a run starts, then the trace Resource carries no `conductor.source.ref` and no error is raised from start-context construction
- Given an intake marker whose `Source-Ref:` line is empty, when a run starts, then no `conductor.source.ref` attribute is set rather than an empty string
- Given OTel enabled, when the metric Resource is built, then it carries no `conductor.source.ref` attribute

### Done When
- [ ] The visualizer start context carries an optional `sourceRef` resolved once at run start from the intake marker
- [ ] `buildResource` for the traces signal sets `conductor.source.ref` only when `sourceRef` is a non-empty string, and the metrics signal never sets it
- [ ] A unit test asserts the trace Resource attribute present for an intake-backed feature and absent for a feature with no intake marker

## Story 4: The exported root span records commit, base, and PR at close

**Requirement:** adr-014 D19

As a telemetry consumer reading a trace, I want the run's root span to name the built commit, the base, the PR URL, and the PR disposition, so that a trace alone answers which commit and which PR the run describes.

### Acceptance Criteria

#### Happy Path
- Given an OTel-enabled run whose events flow through the production visualizer, when `feature_complete` arrives with `headSha: H`, `baseSha: B`, a `prUrl`, and `prDisposition: 'opened'`, then the exported `conductor.run` span carries `vcs.head.sha: H`, `vcs.base.sha: B`, `conductor.pr.url`, and `conductor.pr.disposition: 'opened'`
- Given a rebase outcome event with `baseSha: B` arrives while the rebase step span is open, when that step span is exported, then it carries `vcs.base.sha: B`
- Given a rebase resolved base `B` earlier in the run and a later `loop_halt` arrives with no `baseSha`, when the root span closes, then it carries `vcs.base.sha: B` from the most recent rebase outcome
- Given two rebases in one run resolving `B1` then `B2`, when the run completes with no `baseSha` on the terminal event, then the root span carries `vcs.base.sha: B2`

#### Negative Paths
- Given a run that is force-closed on stop without any terminal event, when the root span is exported, then it carries `conductor.pr.disposition: 'unrecorded'` and no `vcs.head.sha` or `conductor.pr.url`
- Given a terminal event with no `headSha`, when the root span closes, then the span carries no `vcs.head.sha` attribute rather than an empty or placeholder value
- Given a rebase outcome event with `baseSha: null`, when it reaches the visualizer, then no `vcs.base.sha` attribute is set and any previously held base value is kept
- Given the same provenance events, when the metrics listener processes them, then no metric instrument gains a new data-point label and no new metric series is created

### Done When
- [ ] The production `OtelVisualizer` routes `rebase_noop`, `rebase_changed`, and `rebase_mergeable_skip` to the span manager
- [ ] The span manager stamps the four root-span attributes at close and `vcs.base.sha` on the open rebase step span, holding the latest base in memory only
- [ ] A test drives rebase, finish, and halt events through `OtelVisualizer` with an in-memory exporter and asserts the exported root-span and rebase-span attributes

## Story 5: Provenance export is configurable under otel.provenance

**Requirement:** adr-014 D20

As an operator, I want to turn each provenance group off independently, so that I can withhold commit, PR, issue, or feature identity from an export backend.

### Acceptance Criteria

#### Happy Path
- Given a config with no `otel.provenance` block, when OTel config resolves, then `commit`, `pr`, `issue`, and `feature` all resolve to enabled and every provenance attribute is exported
- Given `otel.provenance.commit: false`, when a run completes, then the exported root span and rebase step span carry no `vcs.head.sha` or `vcs.base.sha`, while PR and issue attributes are still exported
- Given `otel.provenance.pr: false`, when a run completes with a PR, then the exported root span carries neither `conductor.pr.url` nor `conductor.pr.disposition`
- Given `otel.provenance.issue: false` and an intake-backed feature, when a run starts, then the trace Resource carries no `conductor.source.ref`
- Given `otel.provenance.feature: false`, when a run starts, then the trace Resource carries no `conductor.feature` and its `service.instance.id` is the project name, a slash, and the run id

#### Negative Paths
- Given `otel.provenance.commit: "no"`, when config resolves, then resolution fails with a validation error naming `otel.provenance.commit` and the expected boolean type
- Given `otel.provenance.branch: true`, when config resolves, then resolution fails with a validation error naming the unknown key `otel.provenance.branch`
- Given `otel.provenance: true` as a scalar instead of a mapping, when config resolves, then resolution fails with a validation error naming `otel.provenance`
- Given `otel.provenance.feature: false`, when the metric Resource is built and step metrics are recorded, then the metric Resource identity and every metric data-point `feature` label are unchanged from a run with the toggle on
- Given every toggle false, when a run completes, then the events persisted to `events.jsonl` still carry `headSha`, `baseSha`, `prUrl`, and `prDisposition`

### Done When
- [ ] `otel.provenance` is registered as a known key of the `otel` block and resolved once into `ResolvedOtelConfig` with all four toggles defaulting to true
- [ ] Each disabled toggle omits exactly its own attributes from the trace Resource or spans, and `feature: false` changes only the trace `service.instance.id`
- [ ] Unit tests cover each toggle off, the all-default case, the three validation errors, and unchanged metric identity under `feature: false`
