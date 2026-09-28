# Implementation Plan: Per-project work-tracker backend selection (#845)

**Date:** 2026-09-28
**Stories:** .docs/stories/per-project-work-tracker-backend-selection-in-regi.md
**Conflict check:** Clean as of 2026-09-28

## Summary

Hosts the per-project `tracker` config key reserved by adr-2026-07-22-canonical-tracker-client-seam (D3, amended D4), adds one resolver that reads it, and turns the `buildIntake()` intake composition root into a tracker-aware composite for polling and the land/handoff write-backs. Projects without the key keep today's GitHub behavior byte-for-byte; Jira-selected projects fail closed until #849. 11 tasks.

## Technical Approach

- **Config (tasks 1–2).** A `TrackerConfig` discriminated union on the project config type, `tracker` in the accepted top-level key set with its own nested key set, and an exported `validateTrackerConfig` used both by `validateConfig` and by the resolver. Jira-only fields on a github block are errors. The consumer registry declares every key with the resolver as consumer.
- **Resolver (task 3).** A new tracker-selection module reads the project config file, parses YAML, and validates only the `tracker` value. Absent file or key means github. An unrelated config error never changes intake. Unparseable YAML or a malformed block is `invalid-config`.
- **Spine (task 4).** One new `ConductorEvent` member, `tracker_backend_unavailable`, with a persist+render sink row. There is no side channel (event-spine skill, step 2).
- **Composite (tasks 5–10).** A new intake-backend composite module implements `IntakeSource & IntakePort` over a backend factory map injected by `engineer-cli.ts`, so the concrete-adapter import stays at the CLI composition root (FR-13).
  - It builds the unchanged GitHub issues adapter once, with a lazily resolved registry `list()` that returns only github-selected projects, mapped exactly as today. For an all-GitHub registry the adapter therefore sees an identical list, which is what makes the parity proof possible.
  - Excluded projects emit one event per exclusion episode, mirroring the adapter's `missingRegistrationEpisodes` pattern.
  - `report()` classifies the ref with the canonical `parseWorkRef` and delegates GitHub-owned refs unchanged. An unavailable backend returns the port's documented no-op `{ ok: true }`, so the ledger still advances with no pending write-back.
- **Composition root (tasks 5, 11).** `buildIntake` keeps its synchronous signature and return fields; all resolution happens inside `poll()`/`report()`. Its `events` parameter widens to admit the new variant, and the production engineer dispatch already passes `spine.events`.
- **Out of scope** (track boundary): daemon backlog (#851), close/linkage (#852), gate/halt write-backs (#853), the Jira adapter (#849), and claim-time checks on already-queued envelopes.

## Prerequisites

None. #846 (`engine/tracker-client.ts`) and #847 (`parseWorkRef`) are on main; no migration and no new dependency.

## Tasks

### Task 1: Declare and validate the tracker config block
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in the config test file: a `tracker: { backend: github }` block loads with no warning; a jira block with all five fields loads and exposes them unchanged; `backend: gitlab`, a github block carrying `site`, a nested `token` key, `site: not a url`, and `transport: ftp` each fail with an error naming the offending `tracker.*` path.
2. Verify tests fail (RED)
3. Implement: add a `TrackerConfig` discriminated union to the config types (github: `{ backend }`; jira: `{ backend, transport?, credentials?, site?, project_key? }`), add `tracker` to `CONFIG_CONSUMER_KEY_SETS.top` plus a `tracker` nested key set, and add an exported `validateTrackerConfig` that `validateConfig` calls. Follow the existing nested-block validator shape (search `CONFIG_CONSUMER_KEY_SETS['build_review.adjudication']` in the config engine): allowed-key set first, then per-field type checks, returning a path-named error. Jira-only fields on a github block are an error, never ignored. `site` must parse as an `https:` URL.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(config): declare and validate the per-project tracker block"

**Done when:**
- validateConfig loads `tracker: { backend: github }` with no warning and the loaded config exposes backend github, asserted by the tracker config test
- validateConfig loads a jira block with transport api, credentials jira-work, site https://example.atlassian.net and project_key ENG and exposes all five values unchanged
- validateConfig rejects backend gitlab with an error naming tracker.backend and listing github and jira as accepted values, and rejects transport ftp with an error naming tracker.transport and listing api and mcp
- validateConfig rejects a github block carrying site with an error naming tracker.site as valid only for the jira backend, and rejects site `not a url` with an error naming tracker.site as not an https URL
- validateConfig rejects a jira block carrying nested key token with an unknown-key error naming tracker.token

**Files likely touched:**
- src/conductor/src/types/config.ts — `TrackerConfig` union and optional `tracker` field
- src/conductor/src/engine/config.ts — key sets and `validateTrackerConfig`
- src/conductor/test/engine/config.test.ts — tracker validation cases

**Dependencies:** none

### Task 2: Declare the tracker keys in the config-key consumer registry
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: run the config-key consumer registry totality test after task 1 added the keys; it fails because `tracker` and its nested keys have no consumer declaration.
2. Verify test fails (RED)
3. Implement: declare `tracker` and each nested key (`backend`, `transport`, `credentials`, `site`, `project_key`) with `resolveTrackerSelection` as consumer, following the existing entries for `memory_provider`.
4. Verify test passes (GREEN)
5. Commit with message: "test(config): declare tracker key consumers"

**Done when:**
- the config-key consumer registry declares tracker and each nested key backend, transport, credentials, site and project_key with resolveTrackerSelection as consumer
- the registry totality test passes with tracker in CONFIG_CONSUMER_KEY_SETS.top and a tracker nested key set

**Files likely touched:**
- src/conductor/test/engine/config-consumer-registry.ts — consumer declarations for the tracker keys

**Dependencies:** 1, 3

### Task 3: Resolve a project's tracker selection from its tracker block only
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests for `resolveTrackerSelection(projectPath)` over temp project directories: no config file; config without `tracker`; config with an invalid unrelated key; unparseable YAML; `backend: gitlab`; a valid jira block.
2. Verify tests fail (RED)
3. Implement a new tracker-selection module. Read the project config file directly, parse the YAML, take only the `tracker` value, and validate it with task 1's `validateTrackerConfig`. Do not call `loadConfig`, which validates the whole file and would let an unrelated error change intake. The result is a discriminated union: `{ ok: true, selection }` (github default when the file or key is absent) or `{ ok: false, reason: 'invalid-config', detail }`. Never log `credentials`.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(tracker): resolve per-project tracker selection"

**Done when:**
- resolveTrackerSelection returns backend github for a project without config.yml and for a config.yml that omits tracker
- resolveTrackerSelection returns backend github when config.yml carries an invalid value in an unrelated key, because it validates only the tracker block
- resolveTrackerSelection returns reason invalid-config for unparseable YAML and for a tracker block with backend gitlab, and never returns github for either
- resolveTrackerSelection returns backend jira with transport, credentials, site and project_key exposed unchanged for a valid jira block

**Files likely touched:**
- src/conductor/src/engine/tracker-selection.ts — new resolver
- src/conductor/test/engine/tracker-selection.test.ts — resolver cases

**Dependencies:** 1

### Task 4: Add the tracker_backend_unavailable event to the spine
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test in the event-sinks test file: the sink table has an entry for `tracker_backend_unavailable` with persist and render enabled.
2. Verify test fails (RED)
3. Implement: add the `ConductorEvent` member `{ type: 'tracker_backend_unavailable'; project: string; backend: 'github' | 'jira'; reason: 'no-adapter' | 'invalid-config' }` and its `EVENT_SINKS` row (persist and render, following the halt-event rows).
4. Verify test passes (GREEN)
5. Commit with message: "feat(events): tracker_backend_unavailable spine event"

**Done when:**
- the ConductorEvent union has a tracker_backend_unavailable member carrying project, backend and a reason limited to no-adapter or invalid-config
- EVENT_SINKS declares tracker_backend_unavailable with persist and render enabled, and the event-sink exhaustiveness check compiles

**Files likely touched:**
- src/conductor/src/types/events.ts — new union member
- src/conductor/src/engine/event-sinks.ts — sink row
- src/conductor/test/engine/event-sinks.test.ts — sink assertion

**Dependencies:** none

### Task 5: Compose intake through a tracker-aware composite with GitHub parity
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing parity test. It drives `buildIntake` and a pre-change reference composition, which constructs the GitHub issues adapter directly with today's registry mapping. Both get the same registry and the same scripted gh runner. Cover four registry shapes: projects without `tracker`; a project with no config file; a project with an invalid unrelated key; a project with explicit `tracker: { backend: github }`. Record envelopes, ledger entries, gh argv, and emitted events.
2. Verify test fails (RED)
3. Implement a new intake-backend composite module that does not import any concrete adapter (FR-13). It takes a backend factory map, `resolveTrackerSelection`, the registry reader and an events emitter. It builds the GitHub adapter once with a registry `list()` that resolves each project lazily and returns only github-selected projects, mapped exactly as today (`parseGhRepo` name/ghRepo/path). `buildIntake` keeps its synchronous signature and return fields; it passes `{ github: createGithubIssuesAdapter }` and widens its `events` parameter to an emitter that also admits `tracker_backend_unavailable`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(intake): tracker-aware composite at the intake composition root"

**Done when:**
- the composite-backed buildIntake poll and the pre-change reference composition, given the same registry of projects without a tracker key and the same scripted gh responses, return equal envelopes and write equal ledger entries
- the recorded gh argv sequence of the composite-backed poll equals the reference sequence exactly for the same registry
- a project with no config.yml and a project whose config.yml has an invalid unrelated key are both polled through the GitHub adapter, and zero tracker_backend_unavailable events are emitted for the whole registry
- a project with explicit `tracker: { backend: github }` yields envelopes and gh argv identical to the same project with no tracker key
- buildIntake keeps its synchronous signature and constructing it performs no config read, asserted by a spy on resolveTrackerSelection that records zero calls before poll

**Files likely touched:**
- src/conductor/src/engine/intake-backend-composite.ts — new composite source/port
- src/conductor/src/engine/engineer-cli.ts — `buildIntake` builds the composite
- src/conductor/test/engine/engineer/engineer-cli-intake-tracker-parity.test.ts — parity test

**Dependencies:** 3, 4

### Task 6: Exclude Jira-selected projects from polling and report them
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests on the composite with a scripted gh runner and a recording emitter: a mixed registry (A without tracker, B selecting jira), and an all-jira registry.
2. Verify tests fail (RED)
3. Implement: a project whose selected backend has no factory in the map is left out of the GitHub adapter's registry list, and the composite emits `tracker_backend_unavailable` with reason `no-adapter`. It never falls back to the GitHub factory.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(intake): fail closed for backends without an adapter"

**Done when:**
- with project A lacking a tracker key and project B selecting jira, the composite poll returns envelopes from project A only and the scripted gh runner records no argv referencing project B
- in a fresh composite, that poll emits exactly one tracker_backend_unavailable event whose fields name project B, backend jira and reason no-adapter
- with every project selecting jira, the composite poll resolves to zero envelopes without throwing, emits one tracker_backend_unavailable event per project, and the gh runner records no argv at all
- an excluded project is never handed to the GitHub adapter, so a jira selection never falls back to GitHub polling

**Files likely touched:**
- src/conductor/src/engine/intake-backend-composite.ts — exclusion and event emission
- src/conductor/test/engine/intake-backend-composite.test.ts — exclusion cases

**Dependencies:** 5

### Task 7: Exclude projects whose tracker block cannot be read
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: one project whose config file is unparseable YAML, and one whose tracker block sets `backend: gitlab`.
2. Verify tests fail (RED)
3. Implement: a resolver result of `invalid-config` excludes the project and emits the event with reason `invalid-config`.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(intake): exclude projects with an unreadable tracker block"

**Done when:**
- a project whose config.yml is unparseable YAML is excluded from the GitHub adapter registry list and a tracker_backend_unavailable event names that project with reason invalid-config
- a project whose tracker block sets backend gitlab is excluded and a tracker_backend_unavailable event names that project with reason invalid-config
- the gh runner records no argv referencing either invalid-config project

**Files likely touched:**
- src/conductor/src/engine/intake-backend-composite.ts — invalid-config exclusion
- src/conductor/test/engine/intake-backend-composite.test.ts — invalid-config cases

**Dependencies:** 6

### Task 8: Emit one event per exclusion episode and isolate poll failures
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: poll one composite twice with B selecting jira; flip B to github for one poll and back to jira; script the GitHub poll of A to fail while B selects jira.
2. Verify tests fail (RED)
3. Implement episode suppression. Use a per-composite set of excluded projects: add a project on first exclusion, emit only when it is added, and remove it when the project next resolves to an available backend. This mirrors the `missingRegistrationEpisodes` pattern in the GitHub issues adapter (search that name). Exclusion events are emitted before the GitHub poll runs, so a GitHub failure cannot suppress them.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(intake): episode-scoped tracker exclusion events"

**Done when:**
- across two polls of one composite with project B selecting jira, exactly one tracker_backend_unavailable event for project B is emitted in total
- after project B resolves to github for one poll and then to jira again, one new event for project B is emitted
- when the scripted GitHub poll for project A fails, the failure is reported through the same log and result path as the pre-change adapter and the event for project B is still emitted

**Files likely touched:**
- src/conductor/src/engine/intake-backend-composite.ts — episode set
- src/conductor/test/engine/intake-backend-composite.test.ts — episode and failure cases

**Dependencies:** 6

### Task 9: Route write-backs for GitHub-owned refs to the GitHub adapter unchanged
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: composite `report()` for routed and for done (with PR URL) on `owner/repo#12` owned by a github project, and on a GitHub ref whose repo matches no registered project, compared with the pre-change `reportRouted` and `reportDone` over the adapter directly.
2. Verify tests fail (RED)
3. Implement composite `report()`. Classify the ref with the canonical `parseWorkRef`. For a GitHub ref, find the owning project by repo; when that project resolves to github, or when no project owns the repo, delegate to the GitHub adapter unchanged.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(intake): route write-backs by the owning backend"

**Done when:**
- composite report for routed on owner/repo#12 owned by a github project delegates to the GitHub adapter and the recorded gh argv and ledger advance equal the pre-change reportRouted output
- composite report for done with a PR URL on the same ref records gh argv for the done comment and engineer:handled label, and a ledger advance, equal to the pre-change reportDone output
- composite report on a GitHub ref whose repo matches no registered project delegates to the GitHub adapter unchanged, so its argv and outcome equal today's unregistered-repo behavior

**Files likely touched:**
- src/conductor/src/engine/intake-backend-composite.ts — `report()` routing
- src/conductor/test/engine/intake-backend-composite.test.ts — write-back parity cases

**Dependencies:** 5

### Task 10: Skip write-backs whose backend is unavailable without marking them pending
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: composite `report()` on Jira ref `ENG-42`, and on a GitHub ref owned by a project selecting jira; then `reportRouted` and `reportDone` over those outcomes with a real ledger.
2. Verify tests fail (RED)
3. Implement: an unavailable backend makes no runner call, emits the event with reason `no-adapter`, and returns `{ ok: true }`, the port's documented no-op outcome. `reportRouted` and `reportDone` then advance the ledger with `writebackPending` false.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(intake): unavailable-backend write-backs are reported no-ops"

**Done when:**
- composite report on Jira ref ENG-42 makes no gh runner call, emits a tracker_backend_unavailable event with reason no-adapter, and returns an outcome whose ok is true
- composite report on a GitHub ref owned by a project selecting jira makes no gh write, emits the event, and returns an outcome whose ok is true
- reportRouted and reportDone over those outcomes advance the ledger to routed and to done with PR URL and branch, with writebackPending false

**Files likely touched:**
- src/conductor/src/engine/intake-backend-composite.ts — unavailable-backend write-back
- src/conductor/test/engine/intake-backend-composite.test.ts — skipped write-back cases

**Dependencies:** 9

### Task 11: Prove land and handoff through the engineer CLI entry point
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing integration tests through `dispatchEngineer` with a temp registry, a scripted gh runner and a recording spine emitter: `land --source-ref ENG-42`, and `handoff` with a GitHub source ref whose project selects jira.
2. Verify tests fail (RED)
3. Implement any remaining wiring. `land` and `handoff` pass `opts.events` into `buildIntake`, and the production engineer dispatch in the CLI entry passes `spine.events` (verify it still does).
4. Verify tests pass (GREEN)
5. Commit with message: "test(intake): land and handoff respect the selected tracker backend"

**Done when:**
- dispatchEngineer land with --source-ref ENG-42 exits 0, prints its normal JSON result, records zero gh argv for the write-back, advances the ledger to routed without a pending write-back, and emits tracker_backend_unavailable with reason no-adapter on the supplied spine emitter
- dispatchEngineer handoff with a GitHub source ref owned by a jira-selected project makes no gh write for the write-back, emits the event, advances the ledger to done with the PR URL and branch without a pending write-back, and still prints the pr-opened result
- the production engineer dispatch passes spine.events into buildIntake so the event reaches the persisted event spine, and the buildIntake events parameter type admits the tracker_backend_unavailable variant

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts — events threading if needed
- src/conductor/test/engine/engineer/engineer-cli-intake.test.ts — land and handoff cases

**Dependencies:** 10

## Task Dependency Graph

```text
Task 1 ── Task 3 ──┬─ Task 2 (also needs Task 1)
                   └─ Task 5 (also needs Task 4) ──┬─ Task 6 ──┬─ Task 7
Task 4 ────────────────────────────────────────────┘           └─ Task 8
                                                    Task 5 ── Task 9 ── Task 10 ── Task 11
```

## Integration Points

- After Task 5: every existing intake path (compose pre-poll, poll, claim, land, handoff, intake loop) runs through the composite with GitHub parity.
- After Task 11: land and handoff through the engineer CLI entry point demonstrate the fail-closed write-back end to end.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a project config containing `tracker: { backend: github }`, when the project config is loaded, then loading succeeds with no warning and the loaded config exposes the tracker backend `github`. | 1 | "validateConfig loads `tracker: { backend: github }` with no warning and the loaded config exposes backend github, asserted by the tracker config test" | diff-local |
| Story 1 happy: Given a project config containing `tracker` with `backend: jira`, `transport: api`, `credentials: jira-work`, `site: https://example.atlassian.net`, and `project_key: ENG`, when the project config is loaded, then loading succeeds and all five values are exposed unchanged. | 1 | "validateConfig loads a jira block with transport api, credentials jira-work, site https://example.atlassian.net and project_key ENG and exposes all five values unchanged" | diff-local |
| Story 1 negative: Given a project config containing `tracker: { backend: gitlab }`, when the project config is loaded, then loading fails with an error that names `tracker.backend` and lists `github` and `jira` as the accepted values. | 1 | "validateConfig rejects backend gitlab with an error naming tracker.backend and listing github and jira as accepted values, and rejects transport ftp with an error naming tracker.transport and listing api and mcp" | diff-local |
| Story 1 negative: Given a project config containing `tracker: { backend: github, site: https://example.atlassian.net }`, when the project config is loaded, then loading fails with an error that names `tracker.site` as valid only for the `jira` backend. | 1 | "validateConfig rejects a github block carrying site with an error naming tracker.site as valid only for the jira backend, and rejects site `not a url` with an error naming tracker.site as not an https URL" | diff-local |
| Story 1 negative: Given a project config containing `tracker` with `backend: jira` and an unknown nested key `token`, when the project config is loaded, then loading fails with an unknown-key error naming `tracker.token`. | 1 | "validateConfig rejects a jira block carrying nested key token with an unknown-key error naming tracker.token" | diff-local |
| Story 1 negative: Given a project config containing `tracker` with `backend: jira` and `site: not a url`, when the project config is loaded, then loading fails with an error naming `tracker.site` as not an https URL. | 1 | "validateConfig rejects a github block carrying site with an error naming tracker.site as valid only for the jira backend, and rejects site `not a url` with an error naming tracker.site as not an https URL" | diff-local |
| Story 1 negative: Given a project config containing `tracker: { backend: jira, transport: ftp }`, when the project config is loaded, then loading fails with an error that names `tracker.transport` and lists `api` and `mcp` as the accepted values. | 1 | "validateConfig rejects backend gitlab with an error naming tracker.backend and listing github and jira as accepted values, and rejects transport ftp with an error naming tracker.transport and listing api and mcp" | diff-local |
| Story 2 happy: Given a registry whose projects have no `tracker` key, when intake polls, then the polled envelopes and the ledger writes equal those produced by the pre-change composition root for the same registry and the same `gh` responses. | 5 | "the composite-backed buildIntake poll and the pre-change reference composition, given the same registry of projects without a tracker key and the same scripted gh responses, return equal envelopes and write equal ledger entries" | diff-local |
| Story 2 happy: Given a registry whose projects have no `tracker` key, when intake polls, then the sequence of `gh` argv issued equals the pre-change sequence exactly. | 5 | "the recorded gh argv sequence of the composite-backed poll equals the reference sequence exactly for the same registry" | diff-local |
| Story 2 happy: Given a project with no `.ai-conductor/config.yml` at all, when intake polls, then that project is polled through the GitHub backend. | 5 | "a project with no config.yml and a project whose config.yml has an invalid unrelated key are both polled through the GitHub adapter, and zero tracker_backend_unavailable events are emitted for the whole registry" | diff-local |
| Story 2 negative: Given a project whose `config.yml` has an invalid value in an unrelated key (not `tracker`), when intake polls, then that project is still polled through the GitHub backend and no tracker event is emitted. | 5 | "a project with no config.yml and a project whose config.yml has an invalid unrelated key are both polled through the GitHub adapter, and zero tracker_backend_unavailable events are emitted for the whole registry" | diff-local |
| Story 2 negative: Given a registry whose projects have no `tracker` key, when intake polls, then no `tracker_backend_unavailable` event is emitted. | 5 | "a project with no config.yml and a project whose config.yml has an invalid unrelated key are both polled through the GitHub adapter, and zero tracker_backend_unavailable events are emitted for the whole registry" | diff-local |
| Story 2 negative: Given a project with an explicit `tracker: { backend: github }`, when intake polls, then its envelopes and `gh` argv are identical to the same project with no `tracker` key. | 5 | "a project with explicit `tracker: { backend: github }` yields envelopes and gh argv identical to the same project with no tracker key" | diff-local |
| Story 3 happy: Given a registry with project A having no tracker key and project B selecting `backend: jira`, when intake polls, then envelopes come from project A only and the GitHub backend receives no `gh` call for project B. | 6 | "with project A lacking a tracker key and project B selecting jira, the composite poll returns envelopes from project A only and the scripted gh runner records no argv referencing project B" | diff-local |
| Story 3 happy: Given the same mixed registry in a fresh intake process, when intake polls, then exactly one `tracker_backend_unavailable` event is emitted for project B naming the project, the backend `jira`, and the reason `no-adapter`. | 6 | "in a fresh composite, that poll emits exactly one tracker_backend_unavailable event whose fields name project B, backend jira and reason no-adapter" | diff-local |
| Story 3 negative: Given every registered project selects `backend: jira`, when intake polls, then the poll returns zero envelopes without error, one `tracker_backend_unavailable` event is emitted per project, and no `gh` call is made. | 6 | "with every project selecting jira, the composite poll resolves to zero envelopes without throwing, emits one tracker_backend_unavailable event per project, and the gh runner records no argv at all" | diff-local |
| Story 3 negative: Given project B selects `jira` in a long-running intake process, when intake polls twice, then exactly one `tracker_backend_unavailable` event is emitted for project B across both polls; after project B becomes pollable and is later excluded again, one new event is emitted. | 8 | "across two polls of one composite with project B selecting jira, exactly one tracker_backend_unavailable event for project B is emitted in total" | diff-local |
| Story 3 negative: Given project B selects `jira` and the GitHub poll of project A fails, when intake polls, then the failure for project A is reported as it is today and the event for project B is still emitted. | 8 | "when the scripted GitHub poll for project A fails, the failure is reported through the same log and result path as the pre-change adapter and the event for project B is still emitted" | diff-local |
| Story 3 negative: Given a project whose `config.yml` cannot be parsed as YAML, when intake polls, then that project is excluded from polling and a `tracker_backend_unavailable` event names it with the reason `invalid-config`; it is never polled through GitHub. | 7 | "a project whose config.yml is unparseable YAML is excluded from the GitHub adapter registry list and a tracker_backend_unavailable event names that project with reason invalid-config" | diff-local |
| Story 3 negative: Given a project whose `tracker` block is malformed (for example `backend: gitlab`), when intake polls, then that project is excluded and a `tracker_backend_unavailable` event names it with the reason `invalid-config`. | 7 | "a project whose tracker block sets backend gitlab is excluded and a tracker_backend_unavailable event names that project with reason invalid-config" | diff-local |
| Story 4 happy: Given a GitHub source ref `owner/repo#12` whose project uses the GitHub backend, when `land` reports routed for it, then the routed comment and ledger advance are identical to pre-change behavior. | 9 | "composite report for routed on owner/repo#12 owned by a github project delegates to the GitHub adapter and the recorded gh argv and ledger advance equal the pre-change reportRouted output" | diff-local |
| Story 4 happy: Given the same GitHub source ref, when `handoff` reports done with a PR URL, then the done comment, `engineer:handled` label, and ledger advance are identical to pre-change behavior. | 9 | "composite report for done with a PR URL on the same ref records gh argv for the done comment and engineer:handled label, and a ledger advance, equal to the pre-change reportDone output" | diff-local |
| Story 4 negative: Given a Jira-shaped source ref `ENG-42`, when `land` reports routed for it, then no `gh` call is made for the write-back, a `tracker_backend_unavailable` event with the reason `no-adapter` is emitted, the ledger still advances to routed without marking a write-back pending, and `land` still exits 0 with its normal JSON result. | 11 | "dispatchEngineer land with --source-ref ENG-42 exits 0, prints its normal JSON result, records zero gh argv for the write-back, advances the ledger to routed without a pending write-back, and emits tracker_backend_unavailable with reason no-adapter on the supplied spine emitter" | diff-local |
| Story 4 negative: Given a GitHub source ref whose owning project now selects `backend: jira`, when `handoff` reports done, then no `gh` write is made for it, the event is emitted, the ledger still advances to done with the PR URL and branch without marking a write-back pending, and `handoff` still reports the PR as opened. | 11 | "dispatchEngineer handoff with a GitHub source ref owned by a jira-selected project makes no gh write for the write-back, emits the event, advances the ledger to done with the PR URL and branch without a pending write-back, and still prints the pr-opened result" | diff-local |
| Story 4 negative: Given a GitHub source ref whose repo matches no registered project, when `land` reports routed, then the behavior equals today's behavior for an unregistered repo. | 9 | "composite report on a GitHub ref whose repo matches no registered project delegates to the GitHub adapter unchanged, so its argv and outcome equal today's unregistered-repo behavior" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-22-canonical-tracker-client-seam#D1 | existing | none | src/conductor/src/engine/tracker-client.ts exports the TrackerClient interface, the canonical GhRunner type, makeProductionGh and createGithubTrackerClient |
| adr-2026-07-22-canonical-tracker-client-seam#D2 | existing | none | src/conductor/src/engine/engineer/intake/github-issues.ts imports createGithubTrackerClient and IntakeTrackerClient from the tracker-client seam; this feature leaves that adapter unchanged |
| adr-2026-07-22-canonical-tracker-client-seam#D3 | task | task-1 | validateConfig loads a jira block with transport api, credentials jira-work, site https://example.atlassian.net and project_key ENG and exposes all five values unchanged |
| adr-2026-07-22-canonical-tracker-client-seam#D4 | task | task-1, task-3, task-6 | an excluded project is never handed to the GitHub adapter, so a jira selection never falls back to GitHub polling |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
