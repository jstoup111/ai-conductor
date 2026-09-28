# Architecture Review: Per-Project Work-Tracker Backend Selection (#845)
**Date:** 2026-09-28
**Mode:** Lightweight (tier M): Technical Feasibility and Architectural Alignment only
**Input:** `.docs/track/per-project-work-tracker-backend-selection-in-regi.md` (technical track, approach A)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. The project config loader and YAML parsing already exist in `engine/config.ts` (`loadConfig`, `projectConfigPath`). Verified, 95%. |
| Prerequisites | #846 (`engine/tracker-client.ts`) and #847 (`engineer/source-ref.ts` `parseWorkRef` with `github` and `jira` kinds) are both on main. Verified by reading both modules, 95%. No Jira adapter exists; #849 is open. |
| Integration surface | Three modules: config validation (`types/config.ts`, `engine/config.ts`), one new selection module, and the `buildIntake()` composition root in `engine/engineer-cli.ts`. It also adds one `ConductorEvent` variant. |
| Data implications | None. There is no schema or registry change, and `ProjectRecord` is untouched. |
| Performance risk | Each poll reads one small `config.yml` per registered project (5 projects today). This is negligible next to the per-project `gh issue list`. |
| Worktree isolation | No ports, services or shared state. |

`buildIntake()` is synchronous, and today its adapter reads the registry lazily inside `poll()`
(verified at `engine/engineer-cli.ts`, `registry.list`). Tracker resolution is async file I/O, so it
must also happen lazily inside the composite's `poll()` and `report()`. `buildIntake`'s signature
stays synchronous for its call sites: pre-poll, claim, land, handoff and `intake-loop-cli`.

## Alignment

- **Governing ADR reused, not duplicated.** adr-2026-07-22-canonical-tracker-client-seam D3
  reserved `tracker` and assigned selection to #845's composition root. The Jira-only `site` and
  `project_key` fields were not in that shape, so they are added by an additive, numbered amendment
  (D4 in that ADR). No new ADR: this change hosts a contracted key at an existing composition root
  and makes no new structural decision.
- **Pattern consistency.** The change mirrors adr-2026-06-29-per-project-memory-provider-selection:
  the key lives in project `.ai-conductor/config.yml` and has a single resolver with a default when
  absent. Unlike `memory_provider`, it is resolved per registered project at the engineer
  composition root, not once per conductor run, because intake spans every registered project.
- **FR-13 boundary preserved.** Only `engineer-cli.ts` imports concrete adapters. The backend
  factory map lives beside `buildIntake`, and the engineer loop, ledger and queue are untouched.
- **Event spine.** "A project was excluded from intake because its backend is unavailable" is an
  occurrence in time, so it is a new `ConductorEvent` variant emitted through the existing
  `spine.events` that `index.ts` already passes to `dispatchEngineer`. The narrow
  `GithubOperationEventEmitter` parameter type widens to include the new variant. No sidecar or ad-hoc log.
- **Config strictness.** `validateConfig` rejects unknown top-level keys, so `tracker` must join
  `CONFIG_CONSUMER_KEY_SETS.top` (with a `tracker` nested key set) or every project that declares it
  fails its daemon config load. Verified at `engine/config.ts`, `Unknown top-level key`.
- **Invalid states unrepresentable.** The resolved value is a discriminated union
  (`{ backend: 'github' } | { backend: 'jira', transport?, credentials?, site?, project_key? }`),
  not a record of optionals with a string backend.
- **Security.** `credentials` stays a reference and is never a token (ADR #846 D3 amendment by #158).
  Validation rejects nothing about its content beyond type. The resolver never logs it.
- **Diagrams.** `.docs/architecture/per-project-work-tracker-backend-selection-in-regi.md` and its
  sequence reflect this design.

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| `tracker` config key + `TrackerConfig` type + validation | `validateConfig` in `engine/config.ts`, reached by every `loadConfig` of a project config, including daemon start |
| `resolveTrackerSelection(projectPath)` (new selection module) | The composite intake source/port built by `buildIntake()` in `engine/engineer-cli.ts` |
| Backend factory map + composite `IntakeSource & IntakePort` | `buildIntake()`, called by `prePollIntake` (bare `ai-conductor compose`), `claim`/`poll`, `land` (`reportRouted`), `handoff` (`reportDone`), and `intake-loop-cli.ts` |
| `tracker_backend_unavailable` `ConductorEvent` variant | Emitted by the composite on `spine.events`, wired from `index.ts` `dispatchEngineer(…, { events: spine.events })`; persisted by `EventPersister` |
| Reference docs for `tracker` | `docs/reference/configuration.md` |

Early overlap scan over those paths: no overlap, no open blockers (advisory).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The GitHub path drifts from today's behavior (for example, different adapter construction or project naming) | Technical | Medium | High | When every project resolves to `github`, the composite delegates to one GitHub adapter built with today's exact arguments. Stories pin byte-for-byte equivalence of polled envelopes and write-back `gh` argv. |
| An unrelated error in a project's config.yml now excludes it from intake | Technical | Low | Medium | The resolver parses and validates only the `tracker` block, not the whole config. Only an unreadable file or a malformed `tracker` block excludes the project, and the exclusion is reported on the spine. |
| A stale daemon dist rejects `tracker` as an unknown key | Integration | Low | Medium | This is ordinary engine-version skew. The daemon ff-refreshes its engine, and the reference docs note the minimum version. |
| A write-back sourceRef belongs to a project that is now excluded (for example, a claim made before the project switched to jira) | Technical | Low | Low | `report()` routes by the `parseWorkRef` kind and the owning project. An unroutable write-back is reported, and it stays advisory, as today's land/handoff write-backs are. |

## ADRs Created

None. Amended adr-2026-07-22-canonical-tracker-client-seam additively, adding decision D4 (Jira
location fields and hosting rules).

## Conditions

1. For a registry with no `tracker` keys, polled envelopes, ledger writes and every `gh` argv are
   identical to pre-change behavior. This must be proven by a test, not asserted.
2. A `jira` selection or unreadable `tracker` block never falls back to GitHub. The project is
   excluded and a `tracker_backend_unavailable` event is emitted once per exclusion episode per
   process (the `missingRegistrationEpisodes` precedent), so a repeatedly ticking intake loop does not
   flood the spine. The event has an event-sink registry entry (persist and render).
5. Excluded write-backs still advance the ledger (`routed`/`done` with PR URL and branch) and never
   mark a write-back pending.
3. `buildIntake` stays synchronous for its call sites. All tracker resolution happens inside
   `poll()`/`report()`.
4. Daemon backlog, halt-issues and close/linkage composition roots are untouched (#851–#853).
