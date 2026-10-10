# ADR: Backend-neutral ordering source for backlog priority, size, and dependency reads

**Date:** 2026-10-10
**Status:** APPROVED
**Deciders:** James (operator) + composer DECIDE (architecture-review)
**Feature:** backend-neutral-priority-size-dependency-reads-for (jstoup111/ai-conductor#851, Refs #774)

## Context

Backlog ordering reads three facts per linked issue: priority, size, and open blockers. These reads
are GitHub-shaped end to end.

- `backlog-priority.ts` `ghIssueLabelReader` reads labels with
  `runTrackerRepositoryRead(... ['api', 'repos/«owner»/«repo»/issues/«n»'])`. It returns raw label
  strings, which `createPriorityResolver` and `resolveClaimBands` then parse with
  `parsePriorityLabels`. A Jira key fails `parseSourceRef` and is silently recorded as `not-found`.
- `blocker-resolver.ts` `resolveUncached` reads `.../dependencies/blocked_by` through the same
  wrapper, and models every reference as the GitHub-only `IssueRef { repo, number }`. A Jira key
  becomes `indeterminate: unparseable sourceRef`.
- Six sites construct these readers against a `gh` runner directly: the daemon priority resolver
  and per-scan blocker resolver in `daemon-cli.ts`, `compose claim` in `engineer-cli.ts`, the overlap
  scan in `index.ts`, the advisory overlap check in `engineer/coherence-validator.ts`, and the
  guided monitor queue's priority resolver in `engine/monitor-cli.ts`.

The governing ADR, adr-2026-07-22-canonical-tracker-client-seam, made `TrackerClient` plus the
canonical `GhRunner` the single tracker seam. It explicitly rejected its own **Option B**, "narrow
capability ports per call site (`IssueLabelReader`, `BlockerReader`, …) with per-backend adapter
sets", because their shapes were near-identical transport wrappers. Its Decision 2 allowed a module
that "genuinely only needs raw exec" to keep the canonical runner type. That is what
`backlog-priority.ts` and `blocker-resolver.ts` do today.

Operator-confirmed scope for #851: build the seam and keep GitHub at parity. No Jira transport
exists yet; #849 (JiraAdapter) is open and blocked by #2866. Jira references must stop degrading
silently, and every GitHub behavior must stay exactly as it is. That covers the label vocabularies,
`PRIORITY_BAND_RANK`, the cache and outage rules in adr-2026-07-03-priority-fetch-fail-soft and
adr-2026-07-03-priority-from-linked-issue-labels (as amended by #2158), the claim-time banding in
adr-2026-07-10-intake-claim-priority-banding, and the blocker memo and cycle detection.

## Options Considered

### Option A: Normalized ordering source, a domain port above the tracker seam (chosen)
A single `OrderingSource` returns facts already translated into the shared ordering vocabulary:
`PriorityBand`, an `S`/`M`/`L` size, and blockers as canonical source-ref strings. It also returns
two explicit non-fact outcomes, `not-found` and `unavailable`. A dispatcher selects a backend
implementation per reference by `parseWorkRef` kind.
- **Pros:** the policy layer (ranking, cache, outage, memo, cycle walk) becomes backend-agnostic
  without change. A Jira implementation maps native priority and "is blocked by" links once, behind
  the same port. A missing adapter becomes a typed outcome instead of a parse failure.
- **Cons:** one more module. Its name is close to the capability ports the seam ADR rejected, so
  the distinction must be stated (Decision 1).

### Option B: Grow `TrackerClient` with per-backend label and blocked_by reads (filer hypothesis)
Route reads through `TrackerClient.getIssueLabels` / `getBlockedBy` and keep label-based parsing.
- **Pros:** no new module.
- **Cons:** puts GitHub's label vocabulary into the backend-neutral contract. A Jira client would
  have to synthesize `priority: high` strings. `getIssueLabels` also surfaces errors as
  `GhRunnerError`, where today's reads unwrap them through `runTrackerRepositoryRead`, so the
  blocker `indeterminate` detail text and the 404 classification path would shift.

### Option C: Reference-kind dispatch at each construction site
Add a Jira-key check at each of the six sites.
- **Pros:** smallest diff.
- **Cons:** builds no seam. #849 would have to re-edit all six sites, and the policy layer would
  stay GitHub-shaped.

## Decision

1. **`OrderingSource` is a domain normalization port that sits above the tracker seam, not a second
   transport seam.** It neither declares nor wraps a runner type of its own. Each backend
   implementation reaches its tracker only through that backend's canonical seam. For GitHub that is
   the canonical `GhRunner` via `runTrackerRepositoryRead`, the raw-exec path the seam ADR's
   Decision 2 already permits. This is not that ADR's rejected Option B. Option B fragmented
   transport into per-call-site wrappers; this port owns the *translation* from backend-native
   fields to the shared ordering vocabulary, which no `TrackerClient` method expresses.
2. **Contract.** `engine/ordering-source.ts` exports `OrderingSource` with two methods.
   `readFacts(refs)` returns, per reference, either `{ priority: PriorityBand | undefined, size:
   'S'|'M'|'L' | undefined }`, `'not-found'`, or `'unavailable'`. It throws only on a transport or
   auth outage, keeping today's whole-scan fail-soft semantics. `readBlockers(ref)` returns a list of
   open canonical refs, `'not-found'`, `'unavailable'`, or `{ indeterminate: detail }`. A factory,
   `createOrderingSource(deps)`, dispatches each reference by `parseWorkRef` kind.
3. **The GitHub implementation moves today's code verbatim.** The label read, `parsePriorityLabels`
   (highest band wins), `parseSizeLabel`, the 404-to-`not-found` rule, the `blocked_by` read, the
   closed-blocker filter, and the `repository_url` to `owner/repo` mapping all move with their
   existing argv and error unwrapping. GitHub ordering, caching, outage fallback, warn-once
   behavior, memoization, and cycle verdicts are unchanged.
4. **A Jira key (or any reference whose backend has no registered implementation) resolves to
   `unavailable` with no network call.** The source emits `tracker_backend_unavailable` with
   `backend: 'jira'`, `reason: 'no-adapter'`, and `project` set to the reference. That follows the
   precedent in `intake-backend-composite.ts`, and the event schema is unchanged. Emission is
   deduplicated per reference for the source instance's lifetime. The daemon owns one source per
   run and shares it with its per-scan blocker resolvers, so a Jira item does not re-emit on every
   poll. Consumers without an event emitter still receive `unavailable`.
5. **Policy mapping of `unavailable`.** In priority resolution it bands as `unlabeled`, the band
   `not-found` takes today. It is not an outage, consistent with fetch-fail-soft Decision 2. In
   blocker resolution it yields `indeterminate`, which every consumer of the closed
   `BlockerVerdict` union already handles. No ordering or eligibility outcome changes for any
   reference.
6. **The policy modules consume the port, not a runner.** `createPriorityResolver`,
   `resolveClaimBands`, and `createBlockerResolver` take an `OrderingSource` and stop parsing raw
   labels or `blocked_by` JSON. `ghIssueLabelReader`, `IssueLabelReader`, and `createGhBlockerRunner`
   are retired from production wiring. All six construction sites build their source through
   `createOrderingSource`.
7. **Two deferrals.** The GitHub-only `IssueRef` stays the element type of `BlockerVerdict` for this
   feature. The blocker resolver maps canonical refs from GitHub back to `IssueRef`. Widening the
   verdict to carry Jira blockers is #849's work, alongside the Jira implementation. Size is
   carried in `readFacts` for #850's born-complete intake; no ordering consumer reads it yet.

## Consequences

### Positive
- #849 adds one `OrderingSource` implementation and registers it with the dispatcher, without
  touching any consumer.
- A Jira-linked item is now visible on the event spine instead of silently ordered as if
  unlabeled.
- Raw GitHub label parsing lives in one module rather than being repeated in each policy module.

### Negative
- Adds a module and a factory, and migrates six construction sites in one diff. The overlap scan
  flags `daemon-cli.ts` against the unmerged `spec/self-host-phase6-wiring` branch.
- `IssueRef` remains GitHub-shaped (Decision 7), a known limit #849 must lift.
- `size` is carried with no current ordering reader.

### Follow-up Actions
- [ ] #849 registers a Jira `OrderingSource` (native priority to band, "is blocked by" links) and
      widens `BlockerVerdict` refs.
- [ ] #850 consumes `size` from `readFacts` for born-complete intake.
