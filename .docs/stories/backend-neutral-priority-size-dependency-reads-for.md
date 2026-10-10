**Status:** Accepted

# Stories: Backend-neutral priority/size/dependency reads for daemon backlog ordering

Source: intake jstoup111/ai-conductor#851. Track: technical. Governing decision:
adr-2026-10-10-backend-neutral-ordering-source (Decisions 1-7). Scope boundary: the seam plus GitHub
parity only; Jira reads, transport, and native-field mapping are out of scope (#849).

## Story 1: GitHub-linked items order by priority exactly as before

**Requirement:** ADR D2, D3, D6 (priority facts through the ordering source; GitHub parity)

As the daemon operator, I want backlog priority for GitHub-linked items to come through the backend-neutral ordering source so that ordering is unchanged today and a second backend can be added later without touching ordering policy.

### Acceptance Criteria

#### Happy Path
- Given a daemon backlog item whose sourceRef is a GitHub issue labeled `priority: high`, when a discovery pass resolves priorities, then the item is banded `high` and is ordered after `critical` items and before `medium` items, exactly as before this change.
- Given a GitHub issue that carries both `priority: low` and `priority: critical`, when its priority is resolved, then the highest band, `critical`, is used.
- Given a GitHub issue already read on an earlier local scan in the same daemon run, when a later local (`refresh: false`) scan resolves priorities, then no new GitHub read is made for that issue and its cached band is reused.
- Given an item with no sourceRef, when priorities are resolved, then the item takes the `no-issue` band with no tracker read.

#### Negative Paths
- Given a GitHub sourceRef whose issue returns HTTP 404, when priorities are resolved, then that item bands `unlabeled`, the pass stays banded rather than falling back, and no outage warning is logged.
- Given a GitHub issue with no label matching `priority: critical`, `priority: high`, `priority: medium`, or `priority: low` (for example `Priority: High` or `priority:high`), when its priority is resolved, then the item bands `unlabeled`.
- Given the GitHub label read fails with a non-404 transport or auth error during a pass, when priorities are resolved, then the whole pass returns fallback (date) ordering, the cache is cleared, and exactly one outage warning is logged for that outage episode.
- Given an outage is in progress, when a later local scan runs before any successful refresh, then that scan also returns fallback ordering and makes no further GitHub label reads.
- Given an outage was followed by a successful refresh scan, when the next GitHub read fails again, then a new outage warning is logged once.

### Done When
- [ ] The existing backlog-priority and daemon ordering tests pass with their expected outcomes unchanged; only how the resolver is constructed differs.
- [ ] The daemon builds its priority resolver from an ordering source rather than from a GitHub label reader.
- [ ] No policy module outside the GitHub ordering-source implementation parses raw `priority:` labels for ordering.

## Story 2: GitHub-linked issues resolve dependency blocking exactly as before

**Requirement:** ADR D2, D3, D6, D7 (blocker reads through the ordering source; GitHub parity)

As the daemon operator, I want dependency blocking for GitHub-linked issues to come through the ordering source so that blocked work, cycles, and lookup failures behave exactly as today.

### Acceptance Criteria

#### Happy Path
- Given a GitHub issue whose blocked_by list contains one open issue, when its blocker verdict is resolved, then the verdict is `blocked` and names that issue as `owner/repo` plus number.
- Given a GitHub issue whose blocked_by list is empty, or contains only closed issues of any close reason, when its blocker verdict is resolved, then the verdict is `unblocked`.
- Given two GitHub issues that each list the other as an open blocker, when either is resolved, then the verdict is `cycle` naming both members, and resolving the other member in the same pass returns the same cycle verdict.
- Given the same GitHub issue is resolved twice within one pass, when the second resolution runs, then it returns the memoized verdict without a second tracker read.

#### Negative Paths
- Given the blocked_by read fails with a network or API error, when the verdict is resolved, then the verdict is `indeterminate` carrying the error detail, and the scan continues with the other items.
- Given the blocked_by read returns a body that is not valid JSON, when the verdict is resolved, then the verdict is `indeterminate` with an `unparseable blocked_by response` detail.
- Given a sourceRef that is neither a GitHub reference nor a Jira key (for example `not-a-ref`), when its verdict is resolved, then the verdict is `indeterminate` and no tracker read or backend-unavailable event occurs.
- Given a blocker resolver from a previous daemon scan, when a new scan begins, then that scan uses a fresh memo and never returns an earlier scan's verdict.

### Done When
- [ ] The existing blocker-resolver, cycle-detection, and dependency-claim tests pass with their expected verdicts unchanged; only how the resolver is constructed differs.
- [ ] The blocker resolver reads blockers from an ordering source and no longer takes a GitHub runner.
- [ ] `BlockerVerdict` keeps its four kinds and its `IssueRef` element shape.

## Story 3: Jira-linked items are reported as unavailable instead of silently treated as missing

**Requirement:** ADR D4, D5 (Jira keys resolve to unavailable with an event; priority maps to unlabeled)

As the daemon operator, I want a Jira-linked backlog item to be reported on the event spine when no Jira backend is available so that I can see why it is not priority-ordered instead of it silently looking unlabeled.

### Acceptance Criteria

#### Happy Path
- Given items being priority-ordered that include one whose sourceRef is the Jira key `PROJ-123` and no Jira ordering backend is registered, when priorities are resolved, then the `PROJ-123` item bands `unlabeled`, the other items keep their bands, and the resolution stays banded.
- Given a daemon backlog spec linked to the Jira key `PROJ-123`, when a discovery pass resolves its ordering facts, then one `tracker_backend_unavailable` event is emitted with `backend: jira`, `reason: no-adapter`, and `project: PROJ-123`, and it is persisted to `.pipeline/events.jsonl` and rendered in the daemon log.
- Given a Jira-linked item, when its priority is resolved, then no GitHub or other tracker network read is made for it.

#### Negative Paths
- Given the same Jira-linked spec stays in the daemon backlog across many discovery passes in one daemon run, when each pass resolves its ordering facts, then `tracker_backend_unavailable` for `PROJ-123` is emitted at most once in that daemon run.
- Given two different Jira-linked items `PROJ-1` and `PROJ-2`, when priorities are resolved, then one event is emitted for each key, and neither suppresses the other.
- Given a Jira-linked item and a GitHub label outage in the same pass, when priorities are resolved, then the pass falls back exactly as an all-GitHub outage would, and the Jira item alone never causes a fallback or an outage warning.
- Given a consumer that runs without an event emitter, when a Jira-linked reference is resolved, then the reference still resolves as unavailable (`unlabeled` band) and the consumer does not throw.

### Done When
- [ ] A priority-resolver test shows a Jira-keyed item banded `unlabeled`, and a daemon test with a Jira-keyed spec shows exactly one `tracker_backend_unavailable` event across several passes and zero tracker reads for that key.
- [ ] The `tracker_backend_unavailable` event schema is unchanged.

## Story 4: Jira-linked dependency checks resolve as indeterminate with one report

**Requirement:** ADR D4, D5 (Jira keys yield indeterminate blocker verdicts, deduplicated per run)

As the daemon operator, I want dependency checks on Jira-linked items to resolve as indeterminate with an explicit no-adapter reason so that they follow the existing indeterminate handling and the gap is visible.

### Acceptance Criteria

#### Happy Path
- Given a backlog item whose sourceRef is `PROJ-123` and no Jira backend is registered, when its blocker verdict is resolved, then the verdict is `indeterminate` and its detail names the missing Jira adapter.
- Given the daemon rebuilds its blocker resolver every scan, when `PROJ-123` is resolved on several scans of one daemon run, then at most one `tracker_backend_unavailable` event for `PROJ-123` is emitted across priority and blocker resolution combined.

#### Negative Paths
- Given a GitHub issue whose open blocker's own blocker lookup resolves `indeterminate`, when the cycle walk runs, then the walk stops at that blocker without error and the start issue's verdict is `blocked`, as today.
- Given a Jira-linked item resolves `indeterminate`, when the daemon decides eligibility, then the item is handled exactly as any other `indeterminate` verdict is handled today, with no new state or retry loop.

### Done When
- [ ] A daemon test shows `indeterminate` with a no-adapter detail for a Jira key, and one event across several scans.
- [ ] Every switch over the new ordering-source read outcomes is exhaustive, with no default branch.

## Story 5: Every ordering consumer reads through the ordering source

**Requirement:** ADR D6 (all six construction sites use the ordering source)

As a harness maintainer, I want every place that reads priority or dependency facts to go through the ordering source so that the Jira backend (#849) can be added in one place.

### Acceptance Criteria

#### Happy Path
- Given pending intake ideas linked to GitHub issues labeled `priority: critical` and `priority: low`, when `ai-conductor compose claim` runs, then the `critical` idea is claimed first, exactly as before this change.
- Given a pending intake idea linked to a Jira key, received before another linked to an unlabeled GitHub issue, when `compose claim` runs, then both band `unlabeled` and the GitHub idea is claimed, because the Jira idea's dependency verdict is `indeterminate` and the claim walk defers it.
- Given `ai-conductor overlap-scan` and the land-time coherence advisory overlap check run for a GitHub-linked spec, when they resolve blockers, then their reports are identical to before this change.

#### Negative Paths
- Given the GitHub label read throws during `compose claim`, when the claim runs, then exactly one warning is logged for that claim and the ideas are claimed in received-time FIFO order, never failing or emptying the claim.
- Given the coherence advisory overlap check runs without a GitHub runner available, when land validates the spec, then the advisory check is skipped exactly as today and land does not fail because of it.
- Given a Jira-linked intake idea, when `compose claim` evaluates its dependencies, then its verdict is `indeterminate`, and it is treated exactly as today's `indeterminate` verdicts are in the claim walk.

### Done When
- [ ] The daemon, `compose claim`, `overlap-scan`, coherence-validator, and guided monitor queue production paths each construct their ordering readers through the ordering-source factory.
- [ ] No production module constructs a GitHub label reader or a GitHub blocker runner for ordering outside the GitHub ordering-source implementation.
- [ ] The existing compose-claim banding and overlap-scan tests pass with their expected outcomes unchanged.

## Story 6: Size is reported as a normalized fact for GitHub-linked items

**Requirement:** ADR D2, D7 (size carried in ordering facts for #850)

As a harness maintainer, I want the ordering source to report each GitHub-linked item's size as S, M, or L so that born-complete intake (#850) can read size through the same source.

### Acceptance Criteria

#### Happy Path
- Given a GitHub issue labeled `size: M`, when its facts are read through the ordering source, then size is `M`.
- Given a GitHub issue labeled both `size: S` and `size: L`, when its facts are read, then size is `L` (largest wins).

#### Negative Paths
- Given a GitHub issue with no label matching `size: S`, `size: M`, or `size: L` (for example `size: XL` or `Size: M`), when its facts are read, then size is absent and priority is still reported.
- Given a Jira-linked reference, when its facts are read, then the result is unavailable and carries no size.
- Given any size value, when the daemon orders its backlog, then ordering is unchanged by size because no ordering rule reads it.

### Done When
- [ ] An ordering-source test shows `M`, `L`, and absent sizes for the label sets above.
- [ ] Daemon ordering tests show identical order with and without size labels present.
