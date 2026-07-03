# ADR: Owner-gate skips ride the discovery-result gated channel

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #208

## Context

PRD FR-1..FR-4/FR-11: owner-gate skips must appear in a GATED dashboard bucket with reason +
remedy, and repo-level gate conditions (identity unresolved, no cutover) must surface too.
Today the gate's skip path `continue`-drops the spec (daemon-backlog.ts:398-415) leaving only
a warn-once log line. `adr-2026-07-03-dependency-gate-backlog-waiting-channel` (APPROVED)
already widened `discoverBacklog` to `{ items, waiting }` and stated the channel "is
deliberately shaped so #208 becomes 'add a second reason kind.'"

## Options Considered

### Option A: Add a `gated` list to the discovery result
`discoverBacklog` returns `{ items, waiting, gated }`; `gated` entries are
`{ slug, reason: GateReason-skip-subset, otherOwner?, remedy }` plus repo-scoped warning
entries for the two global conditions. Dashboard renders a GATED group; `pickEligible`
unchanged.
- **Pros:** distinct type per gate (owner vs dependency semantics differ: remedy hints,
  other-owner attribution, repo-level warnings have no blocker sets); precedence
  by construction (owner gate runs before dependency gate → a spec is gated XOR waiting);
  matches the ratified pattern.
- **Cons:** third list on the return shape.

### Option B: Reuse `waiting` with a widened reason union
- **Pros:** one list.
- **Cons:** `WaitingItem.verdict` is a `BlockerVerdict` (blocker refs, cycles) — forcing
  owner reasons into it muddies both consumers; dashboard must split one list back into two
  groups; repo-level warnings don't fit a per-slug shape at all.

## Decision

**Option A.** `gated` is a sibling list to `waiting`, carrying per-spec entries (slug, gate
reason — `other-owner` with the owning identity, `unowned-post-cutover`,
`unowned-indeterminate` — and a per-reason remedy hint derived from the existing
`ownershipSkipMessage` strings) plus repo-scoped warning entries for identity-unresolved and
no-cutover. **The identity-unresolved fail-closed early return
(daemon-backlog.ts:325-328) must return the repo warning in `gated` rather than a bare empty
result** — an empty dashboard with no explanation is the invisibility bug again. The
dashboard renders GATED after WAITING; a spec appears in exactly one bucket. Gate decisions
and build outcomes are byte-identical — this channel only observes `GateDecision`.

## Consequences

### Positive
- Closes the #208 invisibility class for the owner gate the same way #246 closed it for
  dependencies; structured reasons, no log parsing.
- Exactly-one-bucket invariant needs no precedence logic — gauntlet ordering guarantees it.

### Negative
- Return-shape ripple to `localWorkSource`, `scanInheritedState`, and tests (same
  coordinated change #246 just made; known cost).
- Two similar-but-distinct skip lists to keep conceptually separate in dashboard code.
