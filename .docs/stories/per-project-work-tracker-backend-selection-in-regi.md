**Status:** Accepted

# Stories: Per-project work-tracker backend selection (#845)

Technical track, no PRD. Requirements (TR-N) derive from adr-2026-07-22-canonical-tracker-client-seam
D3 and D4 (APPROVED) and the four conditions in
`architecture-review-2026-09-28-per-project-work-tracker-backend-selection-in-regi.md`. Scope: the
intake composition root only (poll, claim, and the land/handoff write-backs). Source:
jstoup111/ai-conductor#845 (Refs #774).

Claim-time checks on envelopes that were already queued before a project changed backend are
unchanged by this feature; only polling and the land/handoff write-backs select a backend.

---

## Story 1: A project declares its tracker backend in project config

**Requirement:** TR-1

As an operator, I want to declare a project's work-tracker backend and its Jira settings in the
project's `.ai-conductor/config.yml`, so that the choice is committed with the repo and validated
before anything uses it.

### Acceptance Criteria

#### Happy Path
- Given a project config containing `tracker: { backend: github }`, when the project config is loaded, then loading succeeds with no warning and the loaded config exposes the tracker backend `github`.
- Given a project config containing `tracker` with `backend: jira`, `transport: api`, `credentials: jira-work`, `site: https://example.atlassian.net`, and `project_key: ENG`, when the project config is loaded, then loading succeeds and all five values are exposed unchanged.

#### Negative Paths
- Given a project config containing `tracker: { backend: gitlab }`, when the project config is loaded, then loading fails with an error that names `tracker.backend` and lists `github` and `jira` as the accepted values.
- Given a project config containing `tracker: { backend: github, site: https://example.atlassian.net }`, when the project config is loaded, then loading fails with an error that names `tracker.site` as valid only for the `jira` backend.
- Given a project config containing `tracker` with `backend: jira` and an unknown nested key `token`, when the project config is loaded, then loading fails with an unknown-key error naming `tracker.token`.
- Given a project config containing `tracker` with `backend: jira` and `site: not a url`, when the project config is loaded, then loading fails with an error naming `tracker.site` as not an https URL.
- Given a project config containing `tracker: { backend: jira, transport: ftp }`, when the project config is loaded, then loading fails with an error that names `tracker.transport` and lists `api` and `mcp` as the accepted values.

### Done When
- [ ] `tracker` is an accepted top-level key in project config, and each of its nested keys is enumerated in the config key sets
- [ ] Each rejected shape above yields a config load error whose message names the offending `tracker.*` path
- [ ] The config-key consumer registry declares `tracker` and each nested key (`backend`, `transport`, `credentials`, `site`, `project_key`) with the tracker selection resolver as consumer, and the registry totality test passes

---

## Story 2: Projects without tracker config keep today's GitHub intake unchanged

**Requirement:** TR-2

As an operator of existing projects, I want intake to behave exactly as before when no project
declares a tracker, so that adopting this release needs zero migration.

### Acceptance Criteria

#### Happy Path
- Given a registry whose projects have no `tracker` key, when intake polls, then the polled envelopes and the ledger writes equal those produced by the pre-change composition root for the same registry and the same `gh` responses.
- Given a registry whose projects have no `tracker` key, when intake polls, then the sequence of `gh` argv issued equals the pre-change sequence exactly.
- Given a project with no `.ai-conductor/config.yml` at all, when intake polls, then that project is polled through the GitHub backend.

#### Negative Paths
- Given a project whose `config.yml` has an invalid value in an unrelated key (not `tracker`), when intake polls, then that project is still polled through the GitHub backend and no tracker event is emitted.
- Given a registry whose projects have no `tracker` key, when intake polls, then no `tracker_backend_unavailable` event is emitted.
- Given a project with an explicit `tracker: { backend: github }`, when intake polls, then its envelopes and `gh` argv are identical to the same project with no `tracker` key.

### Done When
- [ ] An equivalence test drives the new composition root and a pre-change reference fixture with identical registry and `gh` responses, and asserts equal envelopes, ledger entries, and `gh` argv
- [ ] The `buildIntake` call sites compile and run unchanged (its signature stays synchronous)

---

## Story 3: Intake polls each project through its selected backend and fails closed for Jira

**Requirement:** TR-3

As an operator with a mixed registry, I want each project polled through the backend it selects,
and a project whose backend is not available yet excluded from intake, so that no Jira project is
ever polled or written through GitHub.

### Acceptance Criteria

#### Happy Path
- Given a registry with project A having no tracker key and project B selecting `backend: jira`, when intake polls, then envelopes come from project A only and the GitHub backend receives no `gh` call for project B.
- Given the same mixed registry in a fresh intake process, when intake polls, then exactly one `tracker_backend_unavailable` event is emitted for project B naming the project, the backend `jira`, and the reason `no-adapter`.

#### Negative Paths
- Given every registered project selects `backend: jira`, when intake polls, then the poll returns zero envelopes without error, one `tracker_backend_unavailable` event is emitted per project, and no `gh` call is made.
- Given project B selects `jira` in a long-running intake process, when intake polls twice, then exactly one `tracker_backend_unavailable` event is emitted for project B across both polls; after project B becomes pollable and is later excluded again, one new event is emitted.
- Given project B selects `jira` and the GitHub poll of project A fails, when intake polls, then the failure for project A is reported as it is today and the event for project B is still emitted.
- Given a project whose `config.yml` cannot be parsed as YAML, when intake polls, then that project is excluded from polling and a `tracker_backend_unavailable` event names it with the reason `invalid-config`; it is never polled through GitHub.
- Given a project whose `tracker` block is malformed (for example `backend: gitlab`), when intake polls, then that project is excluded and a `tracker_backend_unavailable` event names it with the reason `invalid-config`.

### Done When
- [ ] A mixed-registry test shows envelopes only from GitHub-backed projects, with zero `gh` argv referencing a Jira-selected or invalid-config project
- [ ] `tracker_backend_unavailable` is a member of the `ConductorEvent` union with an event-sink registry entry that persists and renders it, and production intake emits it on the event spine passed to the engineer dispatch

---

## Story 4: Land and handoff write-backs reach the backend that owns the source ref

**Requirement:** TR-4

As an operator, I want the routed and done write-backs from `land` and `handoff` to go to the
backend of the project that owns the source ref, so that write-backs follow the same selection as
polling.

### Acceptance Criteria

#### Happy Path
- Given a GitHub source ref `owner/repo#12` whose project uses the GitHub backend, when `land` reports routed for it, then the routed comment and ledger advance are identical to pre-change behavior.
- Given the same GitHub source ref, when `handoff` reports done with a PR URL, then the done comment, `engineer:handled` label, and ledger advance are identical to pre-change behavior.

#### Negative Paths
- Given a Jira-shaped source ref `ENG-42`, when `land` reports routed for it, then no `gh` call is made for the write-back, a `tracker_backend_unavailable` event with the reason `no-adapter` is emitted, the ledger still advances to routed without marking a write-back pending, and `land` still exits 0 with its normal JSON result.
- Given a GitHub source ref whose owning project now selects `backend: jira`, when `handoff` reports done, then no `gh` write is made for it, the event is emitted, the ledger still advances to done with the PR URL and branch without marking a write-back pending, and `handoff` still reports the PR as opened.
- Given a GitHub source ref whose repo matches no registered project, when `land` reports routed, then the behavior equals today's behavior for an unregistered repo.

### Done When
- [ ] A write-back test asserts identical `gh` argv for GitHub-owned refs before and after the change
- [ ] A write-back test asserts zero `gh` argv, one emitted event, and the ledger advance for a Jira-shaped ref and for a ref owned by a Jira-selected project, with `land` and `handoff` exit codes unchanged
