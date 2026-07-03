# ADR: Fail-closed indeterminate semantics and per-scan blocker cache

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #229

## Context

The dependency gate needs GitHub at decision time (live issue-graph resolution, PRD FR-1).
Two cross-cutting choices follow: what happens when blocker state cannot be determined
(GitHub unreachable, `gh` broken, Source-Ref unresolvable), and how often the resolver hits
the network. Precedent tension: the owner gate deliberately **fails open** when the daemon
owner is unresolved (adr in daemon-owner-gate lineage, PR #175) — is that precedent binding
here?

## Options Considered — indeterminate behavior

### Option A: Fail closed, visibly (skip + WAITING with `indeterminate` reason)
- **Pros:** A correctness gate that fails open is not a gate — the motivating failure
  (building #226 before its prerequisites) is exactly what an outage would permit; visibility
  (WAITING group) keeps fail-closed from becoming fail-invisible; scope is naturally bounded —
  only Source-Ref'd specs are gated (FR-3), so an outage stalls intake-originated specs, not
  the whole backlog.
- **Cons:** A GitHub outage pauses dependent specs even when their blockers are actually
  closed; a persistently broken `gh` stalls intake-originated work until fixed (mitigated: the
  stall is loudly visible with its reason).

### Option B: Fail open (owner-gate precedent)
- **Pros:** Consistent with the owner gate; no availability coupling.
- **Cons:** The owner gate's fail-open preserved *status-quo* behavior while a brand-new gate
  bedded in on a solo-operator flow — a deliberate adoption-risk trade-off. Here fail-open
  silently reintroduces the exact bug class this feature exists to prevent, at the moment
  (network trouble) least likely to be noticed.

### Option C: Fail open with stale cache (last-known blocker state)
- **Pros:** Rides through brief outages.
- **Cons:** Requires persistent cross-scan state (a second source of truth to drift); "build
  because a cached value said so an hour ago" is still a wrong-order build when the graph
  changed; complexity not justified at this scale.

## Options Considered — cache scope

### Option D: Per-scan memoization only
One resolver instance per `discoverBacklog` pass; each distinct issue ref queried at most once
per pass; nothing persisted across passes.
- **Pros:** Every scan sees fresh truth (FR-5: unblock within one cycle); no staleness or
  invalidation logic; bounds calls to O(distinct gated specs) per scan — at 5000 REST
  req/hr authenticated and single-digit gated specs per tick, orders of magnitude of headroom.
- **Cons:** Every scan pays the network round-trips again (accepted: it is the freshness
  guarantee).

### Option E: TTL cache across scans
- **Pros:** Fewer calls.
- **Cons:** A closed blocker may not unblock its dependents until TTL expiry — violates FR-5's
  "next cycle" promise for no needed rate-limit relief.

## Decision

**A + D: fail closed with a visible `indeterminate` reason, per-scan memoization, no
persistent cache.** The owner-gate fail-open precedent is explicitly **not** followed — and
this ADR documents the distinction so the two gates' opposite postures read as deliberate:
the owner gate protects against a *rare multi-operator* hazard and failed open to avoid
bricking the common solo case; the dependency gate protects against a *routine* hazard
(building in the wrong order is the default without it), so its safe state is "wait, visibly."
Intake claiming uses the same resolver semantics: an indeterminate entry is deferred in the
queue, and the all-blocked report shows the indeterminate reason (PRD FR-8/9).

## Consequences

### Positive
- No wrong-order build is possible on missing knowledge; outages degrade to visible waiting.
- One-cycle unblock latency preserved; no cache-invalidation machinery.
- The fail-open vs fail-closed asymmetry between gates is documented, not accidental.

### Negative
- GitHub availability becomes a soft dependency of dispatch progress for intake-originated
  specs (accepted: those specs already required GitHub to exist at all).
- Repeated scans re-query; if backlog scale ever grows 100×, revisit with GraphQL batching
  inside the resolver (adr-2026-07-03-issue-dependencies-api-surface keeps that swap internal).

### Follow-up Actions
- [ ] Resolver memoizes per scan pass; shared by daemon gate and intake claim
- [ ] Indeterminate → WAITING with reason; intake defers with reason
- [ ] Tests: outage path builds nothing gated, dashboard shows indeterminate
