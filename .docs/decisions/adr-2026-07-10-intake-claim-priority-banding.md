# ADR: Intake claim orders candidates by priority band above receivedAt FIFO, resolved at claim time, fail-open

**Date:** 2026-07-10
**Status:** APPROVED
**Feature:** priority-banded intake claim (jstoup111/ai-conductor#461)
**Track:** technical (no PRD; intent per issue #461 + `.docs/track/2026-07-10-priority-banded-intake-claim.md`)
**Companions:** `adr-2026-07-03-priority-from-linked-issue-labels`, `adr-2026-07-03-priority-fetch-fail-soft`
**Amends:** `adr-011-async-intake-queue-and-github-source` (claim *selection order* only — the atomic-rename claim primitive and lock independence are untouched)

## Context

After PR #460 the daemon build backlog is priority-banded, but `conduct-ts engineer claim`
still dequeues pure oldest-first (`receivedAt` FIFO): `claimUnblocked` walks the file
queue's lexicographic filename order and returns the first unblocked entry. Observed
2026-07-10: a claim served #368 (high) while five `priority: critical` issues sat pending.
The brain loop (`intake-loop --continuous`) only polls/enqueues/notifies — verified: claim
is the **sole** ordering point in the idea→spec pipeline, so fixing claim fixes the whole
gap (#461's "brain planning order" collapses into this).

Constraints in force:
- ADR-011 C1: the queue's `fs.rename` atomic claim is the only concurrency primitive; no
  lock imports.
- adr-2026-07-03-priority-fetch-fail-soft: label-source outages degrade to pure
  chronological order, warn once, never block work.
- Operator-confirmed (2026-07-10): per-pending-ref REST reads at claim time are acceptable
  (claims are operator-frequency; ~22 pending today); relabels must take effect on the
  *next claim* without any restart or re-poll.

## Decision

1. **Ordering is applied inside the claim walk, above the queue.** `claimUnblocked`
   (dependency-claim.ts) drains all pending envelopes via the (delivery-guarded) queue's
   existing atomic `claim()` — the hold-and-release mechanics it already uses for
   all-blocked detection — then stable-sorts the held candidates band-first
   (no-issue → critical → high → medium → low → unlabeled, the #460 ranking), preserving
   `receivedAt` FIFO within a band, and only then evaluates blocker verdicts in that order.
   First unblocked wins; every non-selected envelope is released back untouched (deferral
   stays stateless). `createFileQueue` is byte-for-byte unchanged.
2. **Bands are resolved at claim time from the linked issue's labels**, via the existing
   `ghIssueLabelReader` + `parsePriorityLabels` (backlog-priority.ts) — one read-only
   `gh api repos/«owner»/«repo»/issues/«n»` call per held sourceRef, no cache across claims
   (each claim is a fresh process). Claim-time resolution is the point of the feature: an
   operator escalating a label *after* capture reorders the very next claim. An envelope
   without a `sourceRef` takes the `no-issue` band (rank 0) for parity with the daemon;
   `not-found` refs and unlabeled issues take `unlabeled`.
3. **Fail-open to today's FIFO.** Any reader throw (transport, quota) logs exactly one
   warning for that claim invocation and proceeds with the held candidates in their
   original drain order (pure `receivedAt` FIFO) — a claim is never blocked, failed, or
   emptied by a label outage. This mirrors adr-2026-07-03-priority-fetch-fail-soft's
   whole-scan granularity: one failure → whole claim falls back, never a half-banded order.
4. **One shared ranking vocabulary.** `backlog-priority.ts` exports its band ranking
   (currently module-private `BAND_RANK`) — or an ordering comparator over it — so intake
   claim and daemon backlog sort by the same table. No duplicated rank map in
   dependency-claim.ts.

## Consequences

- Marking an issue `priority: critical` now jumps both the build backlog (PR #460) and the
  idea→spec intake queue; the two schedulers cannot drift apart on vocabulary.
- A claim invocation momentarily holds every pending envelope (the all-blocked walk already
  did this). A concurrent claim during that window sees an empty inbox and reports
  `empty` — pre-existing behavior, operator-frequency, accepted.
- Claim latency grows by one sequential REST call per pending entry (~22 today, ~5s worst
  case) — accepted by the operator; a batched GraphQL reader was explicitly declined.
- Within-band order remains `receivedAt` FIFO — deterministic and stable across claims.

## Alternatives rejected

- **Queue `list()`/peek + targeted claim** — opens a list→claim race window and expands the
  ADR-011 C1 surface for no behavioral gain over sorting envelopes the walk already holds.
- **Band stamped into the pending filename at enqueue** — freezes priority at capture;
  a post-capture relabel (the observed failure mode) would never reorder. Disqualifying.
- **Reusing `createPriorityResolver`'s cross-scan cache** — claim is a fresh process per
  invocation; the resolver's in-memory cache and outage state cannot survive it. The
  simpler per-claim read + fail-open achieves the same contract.

## Evidence

- `queue.ts` `claim()` sorts pending filenames lexicographically (`receivedAt`-prefixed) —
  verified in source.
- `claimUnblocked` already drains/holds/releases for all-blocked detection; the finally
  block releases every held envelope on all exits — verified in source.
- `Envelope.receivedAt` is a required string field (port.ts) — within-band sort key exists.
- `parsePriorityLabels` already ranks `critical` (PR #460 follow-up #460/critical band) —
  verified in source.
- Delivery guard (`createDeliveryGuardedQueue`) holds rejected candidates during a walk and
  releases them at exhaustion — composes with a full drain unchanged; verified in source.
- `gh api repos/.../issues/N` label reads are unaffected by the Projects-classic mutation
  breakage (PR #172 evidence, reads verified working).
