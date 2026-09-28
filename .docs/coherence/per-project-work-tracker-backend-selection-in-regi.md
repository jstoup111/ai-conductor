# Coherence Check: Per-project work-tracker backend selection

Date: 2026-09-28
Source: jstoup111/ai-conductor#845
Tier: M; technical track; session-default model.
Verdict: PASS — all required layers covered, no waiver required.

## Inputs and Judgment

This review compares three things: the three staged issue outcomes in `.pipeline/intake-outcomes.md`, four accepted stories, and 11 plan tasks. It also covers the one ADR changed by this change set, adr-2026-07-22-canonical-tracker-client-seam, whose four citable decisions are judged individually below. All 25 happy and negative criteria have task completion evidence. The criterion rows match the plan's `## Coverage Check` rows, which passed an independent coverage judgement: 24 passed in round one, and the one refusal passed in round two after the criterion was narrowed to the write-back.

The `fr` row class is omitted because this is a technical-track spec with no PRD.

Outcome 1 says settings are declared "via registry and/or project config". The approved design satisfies that with project config alone, and D4 of the amended ADR explicitly excludes the registry record. The "or" branch is delivered, so this is not a narrowing gap.

## Outcomes

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote |
|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | - A project can declare its work-tracking backend (`github` default, `jira`) plus backend-specific settings (e.g. Jira site URL, project key) per repo/project via registry and/or project config. |
| outcome | outcome-2 | story-3, story-4 | covered | - The intake composition root selects the adapter from that config instead of hardcoding GitHub. |
| outcome | outcome-3 | story-2 | covered | - Projects with no tracker config behave byte-for-byte as today (GitHub, zero migration). |

Outcome notes, in order:
1. Story 1 declares `backend` (github or jira), plus `site` and `project_key`, in project config, validated by task-1 and consumed by task-3.
2. Story 3 moves polling selection into the composite. Story 4 moves write-back selection there too. Tasks 5–10 replace the hardwired adapter construction with a backend factory map.
3. Story 2 pins envelopes, ledger writes, and `gh` argv to the pre-change reference composition (task-5).

## Stories

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-2 | covered | Config declaration, validation, and consumer registry. |
| story | story-2 | task-5 | covered | Zero-migration parity through the composite. |
| story | story-3 | task-3, task-4, task-6, task-7, task-8 | covered | Resolver, spine event, fail-closed exclusion, and episode suppression. |
| story | story-4 | task-9, task-10, task-11 | covered | Write-back routing, reported no-ops, and the entry-point proof. |

## Tasks

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| task | task-1 | story-1 | covered | validateConfig loads `tracker: { backend: github }` with no warning and the loaded config exposes backend github, asserted by the tracker config test |
| task | task-2 | story-1 | covered | the config-key consumer registry declares tracker and each nested key backend, transport, credentials, site and project_key with resolveTrackerSelection as consumer |
| task | task-3 | story-3 | covered | resolveTrackerSelection returns backend github for a project without config.yml and for a config.yml that omits tracker |
| task | task-4 | story-3 | covered | the ConductorEvent union has a tracker_backend_unavailable member carrying project, backend and a reason limited to no-adapter or invalid-config |
| task | task-5 | story-2 | covered | the composite-backed buildIntake poll and the pre-change reference composition, given the same registry of projects without a tracker key and the same scripted gh responses, return equal envelopes and write equal ledger entries |
| task | task-6 | story-3 | covered | with project A lacking a tracker key and project B selecting jira, the composite poll returns envelopes from project A only and the scripted gh runner records no argv referencing project B |
| task | task-7 | story-3 | covered | a project whose config.yml is unparseable YAML is excluded from the GitHub adapter registry list and a tracker_backend_unavailable event names that project with reason invalid-config |
| task | task-8 | story-3 | covered | across two polls of one composite with project B selecting jira, exactly one tracker_backend_unavailable event for project B is emitted in total |
| task | task-9 | story-4 | covered | composite report for routed on owner/repo#12 owned by a github project delegates to the GitHub adapter and the recorded gh argv and ledger advance equal the pre-change reportRouted output |
| task | task-10 | story-4 | covered | composite report on Jira ref ENG-42 makes no gh runner call, emits a tracker_backend_unavailable event with reason no-adapter, and returns an outcome whose ok is true |
| task | task-11 | story-4 | covered | dispatchEngineer land with --source-ref ENG-42 exits 0, prints its normal JSON result, records zero gh argv for the write-back, advances the ledger to routed without a pending write-back, and emits tracker_backend_unavailable with reason no-adapter on the supplied spine emitter |

## Architecture Decisions

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| adr | adr-2026-07-22-canonical-tracker-client-seam | story-1, story-3, story-4 | covered | Decisions D1-D4 each map to a disposition that satisfies it; the individual judgements are below. |

Each decision is judged below:
- **D1 (existing).** Verified: `src/conductor/src/engine/tracker-client.ts` declares `export interface TrackerClient` and `export function createGithubTrackerClient`, and it also exports `GhRunner` and `makeProductionGh`.
- **D2 (existing).** Verified: `src/conductor/src/engine/engineer/intake/github-issues.ts` imports `createGithubTrackerClient` and `IntakeTrackerClient` from the seam. This feature delegates to that adapter unchanged.
- **D3 (task-1).** The cited check loads a jira block with `transport` and `credentials` and exposes them. The first check covers the github default. Together they host the reserved key's shape.
- **D4 (task-1, task-3, task-6).** Four checks cover D4 together:
  - task-1 asserts that Jira-only fields on a github block are rejected, and that `site` and `project_key` are accepted.
  - task-3 asserts a single resolver with a github default.
  - task-6 asserts that a Jira selection is excluded and never falls back to GitHub.
  - task-7 extends that exclusion to unreadable blocks.
  No task touches the registry record, which is consistent with "never on the registry record".

## Criteria

| Row class | Exact criterion | Task id(s) | Verdict | Done when quote | Disposition |
|---|---|---|---|---|---|
| criterion | Story 1 happy: Given a project config containing `tracker: { backend: github }`, when the project config is loaded, then loading succeeds with no warning and the loaded config exposes the tracker backend `github`. | task-1 | covered | "validateConfig loads `tracker: { backend: github }` with no warning and the loaded config exposes backend github, asserted by the tracker config test" | diff-local |
| criterion | Story 1 happy: Given a project config containing `tracker` with `backend: jira`, `transport: api`, `credentials: jira-work`, `site: https://example.atlassian.net`, and `project_key: ENG`, when the project config is loaded, then loading succeeds and all five values are exposed unchanged. | task-1 | covered | "validateConfig loads a jira block with transport api, credentials jira-work, site https://example.atlassian.net and project_key ENG and exposes all five values unchanged" | diff-local |
| criterion | Story 1 negative: Given a project config containing `tracker: { backend: gitlab }`, when the project config is loaded, then loading fails with an error that names `tracker.backend` and lists `github` and `jira` as the accepted values. | task-1 | covered | "validateConfig rejects backend gitlab with an error naming tracker.backend and listing github and jira as accepted values, and rejects transport ftp with an error naming tracker.transport and listing api and mcp" | diff-local |
| criterion | Story 1 negative: Given a project config containing `tracker: { backend: github, site: https://example.atlassian.net }`, when the project config is loaded, then loading fails with an error that names `tracker.site` as valid only for the `jira` backend. | task-1 | covered | "validateConfig rejects a github block carrying site with an error naming tracker.site as valid only for the jira backend, and rejects site `not a url` with an error naming tracker.site as not an https URL" | diff-local |
| criterion | Story 1 negative: Given a project config containing `tracker` with `backend: jira` and an unknown nested key `token`, when the project config is loaded, then loading fails with an unknown-key error naming `tracker.token`. | task-1 | covered | "validateConfig rejects a jira block carrying nested key token with an unknown-key error naming tracker.token" | diff-local |
| criterion | Story 1 negative: Given a project config containing `tracker` with `backend: jira` and `site: not a url`, when the project config is loaded, then loading fails with an error naming `tracker.site` as not an https URL. | task-1 | covered | "validateConfig rejects a github block carrying site with an error naming tracker.site as valid only for the jira backend, and rejects site `not a url` with an error naming tracker.site as not an https URL" | diff-local |
| criterion | Story 1 negative: Given a project config containing `tracker: { backend: jira, transport: ftp }`, when the project config is loaded, then loading fails with an error that names `tracker.transport` and lists `api` and `mcp` as the accepted values. | task-1 | covered | "validateConfig rejects backend gitlab with an error naming tracker.backend and listing github and jira as accepted values, and rejects transport ftp with an error naming tracker.transport and listing api and mcp" | diff-local |
| criterion | Story 2 happy: Given a registry whose projects have no `tracker` key, when intake polls, then the polled envelopes and the ledger writes equal those produced by the pre-change composition root for the same registry and the same `gh` responses. | task-5 | covered | "the composite-backed buildIntake poll and the pre-change reference composition, given the same registry of projects without a tracker key and the same scripted gh responses, return equal envelopes and write equal ledger entries" | diff-local |
| criterion | Story 2 happy: Given a registry whose projects have no `tracker` key, when intake polls, then the sequence of `gh` argv issued equals the pre-change sequence exactly. | task-5 | covered | "the recorded gh argv sequence of the composite-backed poll equals the reference sequence exactly for the same registry" | diff-local |
| criterion | Story 2 happy: Given a project with no `.ai-conductor/config.yml` at all, when intake polls, then that project is polled through the GitHub backend. | task-5 | covered | "a project with no config.yml and a project whose config.yml has an invalid unrelated key are both polled through the GitHub adapter, and zero tracker_backend_unavailable events are emitted for the whole registry" | diff-local |
| criterion | Story 2 negative: Given a project whose `config.yml` has an invalid value in an unrelated key (not `tracker`), when intake polls, then that project is still polled through the GitHub backend and no tracker event is emitted. | task-5 | covered | "a project with no config.yml and a project whose config.yml has an invalid unrelated key are both polled through the GitHub adapter, and zero tracker_backend_unavailable events are emitted for the whole registry" | diff-local |
| criterion | Story 2 negative: Given a registry whose projects have no `tracker` key, when intake polls, then no `tracker_backend_unavailable` event is emitted. | task-5 | covered | "a project with no config.yml and a project whose config.yml has an invalid unrelated key are both polled through the GitHub adapter, and zero tracker_backend_unavailable events are emitted for the whole registry" | diff-local |
| criterion | Story 2 negative: Given a project with an explicit `tracker: { backend: github }`, when intake polls, then its envelopes and `gh` argv are identical to the same project with no `tracker` key. | task-5 | covered | "a project with explicit `tracker: { backend: github }` yields envelopes and gh argv identical to the same project with no tracker key" | diff-local |
| criterion | Story 3 happy: Given a registry with project A having no tracker key and project B selecting `backend: jira`, when intake polls, then envelopes come from project A only and the GitHub backend receives no `gh` call for project B. | task-6 | covered | "with project A lacking a tracker key and project B selecting jira, the composite poll returns envelopes from project A only and the scripted gh runner records no argv referencing project B" | diff-local |
| criterion | Story 3 happy: Given the same mixed registry in a fresh intake process, when intake polls, then exactly one `tracker_backend_unavailable` event is emitted for project B naming the project, the backend `jira`, and the reason `no-adapter`. | task-6 | covered | "in a fresh composite, that poll emits exactly one tracker_backend_unavailable event whose fields name project B, backend jira and reason no-adapter" | diff-local |
| criterion | Story 3 negative: Given every registered project selects `backend: jira`, when intake polls, then the poll returns zero envelopes without error, one `tracker_backend_unavailable` event is emitted per project, and no `gh` call is made. | task-6 | covered | "with every project selecting jira, the composite poll resolves to zero envelopes without throwing, emits one tracker_backend_unavailable event per project, and the gh runner records no argv at all" | diff-local |
| criterion | Story 3 negative: Given project B selects `jira` in a long-running intake process, when intake polls twice, then exactly one `tracker_backend_unavailable` event is emitted for project B across both polls; after project B becomes pollable and is later excluded again, one new event is emitted. | task-8 | covered | "across two polls of one composite with project B selecting jira, exactly one tracker_backend_unavailable event for project B is emitted in total" | diff-local |
| criterion | Story 3 negative: Given project B selects `jira` and the GitHub poll of project A fails, when intake polls, then the failure for project A is reported as it is today and the event for project B is still emitted. | task-8 | covered | "when the scripted GitHub poll for project A fails, the failure is reported through the same log and result path as the pre-change adapter and the event for project B is still emitted" | diff-local |
| criterion | Story 3 negative: Given a project whose `config.yml` cannot be parsed as YAML, when intake polls, then that project is excluded from polling and a `tracker_backend_unavailable` event names it with the reason `invalid-config`; it is never polled through GitHub. | task-7 | covered | "a project whose config.yml is unparseable YAML is excluded from the GitHub adapter registry list and a tracker_backend_unavailable event names that project with reason invalid-config" | diff-local |
| criterion | Story 3 negative: Given a project whose `tracker` block is malformed (for example `backend: gitlab`), when intake polls, then that project is excluded and a `tracker_backend_unavailable` event names it with the reason `invalid-config`. | task-7 | covered | "a project whose tracker block sets backend gitlab is excluded and a tracker_backend_unavailable event names that project with reason invalid-config" | diff-local |
| criterion | Story 4 happy: Given a GitHub source ref `owner/repo#12` whose project uses the GitHub backend, when `land` reports routed for it, then the routed comment and ledger advance are identical to pre-change behavior. | task-9 | covered | "composite report for routed on owner/repo#12 owned by a github project delegates to the GitHub adapter and the recorded gh argv and ledger advance equal the pre-change reportRouted output" | diff-local |
| criterion | Story 4 happy: Given the same GitHub source ref, when `handoff` reports done with a PR URL, then the done comment, `engineer:handled` label, and ledger advance are identical to pre-change behavior. | task-9 | covered | "composite report for done with a PR URL on the same ref records gh argv for the done comment and engineer:handled label, and a ledger advance, equal to the pre-change reportDone output" | diff-local |
| criterion | Story 4 negative: Given a Jira-shaped source ref `ENG-42`, when `land` reports routed for it, then no `gh` call is made for the write-back, a `tracker_backend_unavailable` event with the reason `no-adapter` is emitted, the ledger still advances to routed without marking a write-back pending, and `land` still exits 0 with its normal JSON result. | task-11 | covered | "dispatchEngineer land with --source-ref ENG-42 exits 0, prints its normal JSON result, records zero gh argv for the write-back, advances the ledger to routed without a pending write-back, and emits tracker_backend_unavailable with reason no-adapter on the supplied spine emitter" | diff-local |
| criterion | Story 4 negative: Given a GitHub source ref whose owning project now selects `backend: jira`, when `handoff` reports done, then no `gh` write is made for it, the event is emitted, the ledger still advances to done with the PR URL and branch without marking a write-back pending, and `handoff` still reports the PR as opened. | task-11 | covered | "dispatchEngineer handoff with a GitHub source ref owned by a jira-selected project makes no gh write for the write-back, emits the event, advances the ledger to done with the PR URL and branch without a pending write-back, and still prints the pr-opened result" | diff-local |
| criterion | Story 4 negative: Given a GitHub source ref whose repo matches no registered project, when `land` reports routed, then the behavior equals today's behavior for an unregistered repo. | task-9 | covered | "composite report on a GitHub ref whose repo matches no registered project delegates to the GitHub adapter unchanged, so its argv and outcome equal today's unregistered-repo behavior" | diff-local |

## Preserved-behavior sweep

Story 2 promises unchanged GitHub behavior when no project declares a tracker. The new side effects on that path are checked against it:
- **Emitting `tracker_backend_unavailable`.** Emission happens only on exclusion: task-6 and task-7 are conditioned on a Jira or invalid-config selection. Task-5 asserts that zero such events are emitted for a registry with no tracker key.
- **Reading `config.yml` per project.** The read has no observable effect, and task-5 asserts that construction performs none.
- **Write-back routing.** Task-9 delegates GitHub-owned and unregistered refs to the unchanged adapter with argv parity.

No new effect escapes those conditions. The criterion-conflict sweep over every task check against every criterion found no contradiction. Task-11 check 1 is scoped to the write-back, which matches the narrowed Story 4 criterion. Owner resolution in `land` still calls `gh`, as it does today.
