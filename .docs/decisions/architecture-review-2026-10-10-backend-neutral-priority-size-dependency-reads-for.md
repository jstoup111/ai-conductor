# Architecture Review: Backend-neutral priority/size/dependency reads for daemon backlog ordering
**Date:** 2026-10-10
**Stories reviewed:** none yet (pre-stories technical-track review; inputs are the explore track
marker, the Tier M complexity record, and the approved component and sequence diagrams)
**Mode:** Lightweight (Tier M), covering Technical Feasibility and Architectural Alignment
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** no new packages or services. The work is TypeScript in
  `src/conductor/src/engine/` on the existing tracker seam (verified, 95%).
- **Prerequisites:** both are on main. #846 (`tracker-client.ts`) and #847 (`parseWorkRef`,
  `JIRA_KEY_GRAMMAR` in `engineer/source-ref.ts`) are closed and present (verified, 95%).
- **Integration surface:** the change spans the policy modules (`backlog-priority.ts`,
  `blocker-resolver.ts`, `engineer/intake/dependency-claim.ts`), one new port, and six construction
  sites. That crosses the daemon, compose, and CLI entry points, but every edge is an internal
  dependency-injection change with no external API change (verified by reading each site, 90%).
- **Data implications:** none. Ordering state stays in process memory; nothing is persisted.
- **Performance risk:** none added. GitHub reference reads keep identical cadence and count. Jira
  references do no network I/O (verified against `createPriorityResolver`'s cache and attempted-ref
  logic, 90%).
- **Worktree isolation:** no new ports, files, or shared state.

## Alignment

- **adr-2026-07-22-canonical-tracker-client-seam (APPROVED).** This is the main alignment risk.
  That ADR rejected narrow per-call-site capability ports. The new `OrderingSource` is positioned as
  a domain normalization port above the seam, and the GitHub implementation keeps the canonical
  `GhRunner` via `runTrackerRepositoryRead`, which its Decision 2 permits for raw-exec modules. The
  new ADR's Decision 1 records why this is not the rejected option. Aligned, conditional on the ADR
  being approved (confidence 80%, inferred from the ADR text).
- **adr-2026-07-03-priority-from-linked-issue-labels (APPROVED; amended by #2158).** The priority
  source stays the linked issue's labels for GitHub. Cadence, cache, and cold-reference priming
  move unchanged into the policy layer, which keeps the cache. Aligned.
- **adr-2026-07-03-priority-fetch-fail-soft (APPROVED).** A throw remains a whole-scan outage, and
  `not-found` remains `unlabeled`. `unavailable` is mapped to `unlabeled` and explicitly not an
  outage, consistent with that ADR's Decision 2. Aligned.
- **adr-2026-07-10-intake-claim-priority-banding (APPROVED).** Claim-time resolution with no
  cross-claim cache, fail-open to FIFO, and one shared `PRIORITY_BAND_RANK` are all preserved;
  `resolveClaimBands` changes only its input type. Aligned.
- **Event spine (`CLAUDE.md`, `.agents/skills/event-spine`).** The change reuses the existing
  `tracker_backend_unavailable` variant with an unchanged schema and adds no side channel.
  Aligned.
- **Diagrams.** The new component and sequence diagrams (operator-approved 2026-10-10) match this
  design. `.docs/architecture/per-project-work-tracker-backend-selection-in-regi.md` already lists
  #851 as out of its scope and needs no change.
- **State management.** Read outcomes are closed unions (`not-found`, `unavailable`, facts or
  blocker list, and `indeterminate` for blockers), not flags. Every policy switch over them must
  be exhaustive.

## Wiring Surface

| New or changed surface | Production caller (design-time commitment) |
|---|---|
| `engine/ordering-source.ts` `createOrderingSource` + `OrderingSource` | Constructed once per daemon run in `daemon-cli.ts`, next to today's `createPriorityResolver` construction, and shared with the per-scan `makeResolver` closure. Also constructed by `compose claim` in `engineer-cli.ts`, the overlap-scan command in `index.ts`, land-time coherence validation in `engineer/coherence-validator.ts`, and the guided monitor queue in `engine/monitor-cli.ts` (with the operator event spine's emitter). |
| GitHub ordering-source implementation | Registered inside `createOrderingSource` for `WorkRef` kind `github`. |
| `unavailable` + `tracker_backend_unavailable` emission | Emitted by the dispatcher for `WorkRef` kind `jira`. Rendered by the existing `daemon-cli.ts` event-render case and persisted by the existing sink policy in `event-sinks.ts`. |
| `createPriorityResolver(source, log)` | Existing daemon wiring in `daemon-cli.ts` (backlog ordering + dashboard fallback) and the guided monitor queue in `engine/monitor-cli.ts`. |
| `resolveClaimBands(source, refs)` | Existing `claimUnblocked` `resolveBands` dependency in `engineer-cli.ts`. |
| `createBlockerResolver({ source })` | Existing daemon `makeResolver`, `compose claim`, `index.ts` overlap scan, and coherence-validator advisory scan. |

Early overlap scan (advisory, 2026-10-10) over these paths found
`Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/daemon-cli.ts`. It does not
block; `/plan` should keep the `daemon-cli.ts` edit to the two construction lines.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Subtle GitHub regression: error text or 404 classification shifts when code moves | Technical | Medium | Medium | ADR Decision 3: move today's argv and `runTrackerRepositoryRead` unwrapping verbatim. Pin the existing priority, claim-band, and blocker tests unchanged as the parity proof. |
| Event spam: the daemon's blocker resolver is rebuilt every scan | Performance | Medium | Low | ADR Decision 4: one source per daemon run, emission deduplicated per reference. |
| `IssueRef` stays GitHub-only, so #849 can't add Jira blockers without a verdict change | Integration | High (for #849) | Low (for #851) | ADR Decision 7 records the deferral and the follow-up on #849. |
| Merge churn in `daemon-cli.ts` against `spec/self-host-phase6-wiring` | Integration | Low | Low | Minimal edit; the rebase machinery handles it. |

## ADRs Created

- `adr-2026-10-10-backend-neutral-ordering-source.md`: APPROVED by the operator on 2026-10-10.

## Conditions

1. The new ADR is APPROVED (met 2026-10-10).
2. The plan proves GitHub parity by keeping the existing `backlog-priority`, `dependency-claim`, and
   `blocker-resolver` behavioral tests green, adapted only for the changed constructor input.
   Expected outcomes must not be edited.
3. Every switch over the new read-outcome unions is exhaustive, with no default branch.
