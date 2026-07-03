# ADR: Priority-fetch failure degrades to pure date order with an in-memory once-per-outage warning

**Date:** 2026-07-03
**Status:** APPROVED
**Feature:** daemon issue-priority scheduling (jstoup111/ai-conductor#200)
**PRD:** `.docs/specs/2026-07-03-daemon-issue-priority-scheduling.md`
**Companion:** `adr-2026-07-03-priority-from-linked-issue-labels`

## Context

FR-7: if the priority source is unreachable, the daemon must fall back to today's pure
chronological order for that scan, warn once per outage, and never block or fail a build.
Two open questions: (a) should a mid-outage scan reuse the last successfully fetched
priorities instead of pure date order? (b) where does the once-per-outage warning dedup
state live, given the existing durable `.daemon/warned/<slug>` mechanism?

## Decision

1. **Pure date-order fallback — no last-known-cache reuse across a failed refresh.** When a
   refresh-scan label fetch fails, the priority map is cleared and subsequent scans order by
   plan-stem date until a refresh succeeds again. Deterministic and matches the product
   default: the operator sees exactly the pre-feature behavior during an outage, never a
   possibly-stale ranking presented as current. (The in-memory cache from the companion ADR
   is a *between-refresh* optimization, not an outage survival mechanism.)
2. **Per-fetch-failure granularity is whole-scan, not per-issue.** Any label-read failure in
   a refresh pass marks that pass's priority resolution failed (date-order fallback for the
   whole scan) rather than mixing resolved and unresolved bands — a partially-banded order is
   harder to reason about than a clean fallback. A single missing/deleted issue (404) is NOT
   an outage: it resolves as `unlabeled` band; only transport/auth-level failures trigger
   fallback.
3. **Warn-once state is an in-memory outage-episode flag, not a durable `.daemon/warned/`
   marker.** Warn on the first failed fetch, suppress while failures continue, reset the flag
   on the next successful fetch (so a new outage warns again). Rationale: an outage is
   transient process-lifetime state; the durable warned-markers exist for *persistently
   broken merged specs* that would otherwise re-log forever and are only cleared by fixing
   the spec — the wrong lifecycle for connectivity blips. Evidence: `daemon-backlog.ts`
   `warnOnce` markers have no reset-on-success path.

## Alternatives rejected

- **Reuse last-known priorities during an outage** — a stale ranking silently masquerades as
  current; product explicitly chose the predictable fallback (PRD Key Decisions).
- **Durable `.daemon/warned/` key for the outage notice** — never resets on recovery, so the
  second outage would be silent; also pollutes a spec-keyed namespace with transient state.
- **Per-issue fallback (mixed bands)** — non-deterministic-looking order under partial
  failure; harder to verify against FR-10 output.

## Consequences

- Outage behavior is trivially testable: fetch failure → ordering equals today's, log
  contains exactly one warning; recovery → banded order resumes, next outage warns again.
- FR-10 status output should surface which mode the current order came from (banded vs
  date-order fallback) so the operator can tell an outage from an all-unlabeled backlog.
