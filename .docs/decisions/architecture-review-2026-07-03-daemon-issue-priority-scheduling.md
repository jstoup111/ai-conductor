# Architecture Review: Daemon Issue-Priority Scheduling
**Date:** 2026-07-03
**Mode:** lightweight (Tier M) — feasibility + alignment
**Inputs reviewed:** PRD `.docs/specs/2026-07-03-daemon-issue-priority-scheduling.md` (Approved, FR-1..FR-10); sequence diagram `.docs/architecture/sequences/2026-07-03-daemon-issue-priority-scheduling.md`; `src/conductor/src/engine/daemon-backlog.ts` (`discoverBacklog`, `gitTreeSource`, `parseIntakeSourceRef` usage); `src/conductor/src/engine/daemon.ts` (`pickEligible`)
**Verdict:** APPROVED

## Feasibility

- **Stack:** no new dependencies. `gh` REST reads already in use (PR #172 precedent); label
  reads are unaffected by the Projects-classic mutation breakage.
- **Prerequisites:** none. `BacklogItem.sourceRef` already carries the linked issue from the
  committed intake marker; the `priority: high|medium|low` labels already exist.
- **Integration surface:** one module boundary (backlog discovery/ordering) plus a read-only
  GitHub API call at refresh cadence. Cross-repo `sourceRef`s resolve per-ref via the same
  REST path.
- **Performance:** zero network on the hot poll path — labels fetched only on `refresh: true`
  scans (idle-only cadence that already fetches origin), cached in memory for local scans.
- **Worktree isolation:** no new services, ports, files, or shared state; the only new state
  is process-local memory. Nothing dirties the working tree (critical — an untracked tracked-
  path file would stall `fastForwardRoot`'s cleanliness gate; this design writes no files).

## Alignment

- **Merged-tree-is-truth keystone preserved:** spec *content* still comes exclusively from
  the committed base-branch tree; the network read supplies only advisory ordering and
  degrades to today's exact behavior on failure (never a new build/skip decision).
- **Eligibility/ordering separation (FR-8):** ordering is a pure post-discovery stable sort
  over already-eligible items; `pickEligible`'s dedup/halt/park logic is untouched.
- **Pattern consistency:** follows the existing injectable-dependency style of
  `DiscoverBacklogOpts` (like the owner-gate injectables) so tests inject a fake label
  reader; warn-once semantics deliberately diverge from `.daemon/warned/` (transient vs
  durable — see fail-soft ADR).
- **Diagram accuracy:** the new sequence diagram matches this design (resolver as separate
  participant, fail-soft alt branch, eligibility unchanged).
- **Security:** read-only API calls using existing `gh` auth; no new inputs cross a trust
  boundary (label values map to a closed enum of bands; unknown values → unlabeled band).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| GitHub rate-limit pressure from per-issue label reads | Integration | Low | Low | Refresh-cadence only; pending-spec counts are small (≤ dozens); one REST call per linked item |
| Stale priority between refresh scans surprises operator | Integration | Medium | Low | FR-10 shows effective order + band; ADR documents refresh cadence; restart forces re-read |
| Fetch failure misread as "all specs unlabeled" | Technical | Low | Medium | Fail-soft ADR: whole-scan fallback + mode surfaced in status output, warn once per outage |
| Ordering seam accidentally filters (eligibility drift) | Technical | Low | High | Pure permutation function — property test asserts output is a permutation of input |

## ADRs Created

- `adr-2026-07-03-priority-from-linked-issue-labels` — priority source, REST read, post-
  discovery pure ordering seam, refresh-cadence caching (DRAFT → pending approval)
- `adr-2026-07-03-priority-fetch-fail-soft` — pure date-order fallback, whole-scan failure
  granularity, in-memory once-per-outage warning (DRAFT → pending approval)

## Conditions

None. (One High-impact risk registered → review marker written; ADRs require operator
approval before stories proceed.)
