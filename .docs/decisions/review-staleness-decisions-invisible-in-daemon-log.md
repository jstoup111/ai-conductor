# Architecture Review: Staleness preserve-vs-invalidate decisions are invisible in daemon.log

Status: Approved
Feature: staleness-decisions-invisible-in-daemon-log
Issue: jstoup111/ai-conductor#982
Tier: M (lightweight review)
Date: 2026-07-26

## Scope reviewed

The telemetry path only: the `verdictFreshness` facet on the completion result, its
translation to `verdict_freshness` in `conductor.ts`, the `ConductorEvent` union, and the
three sink registries. The gate decision itself (`gateVerdictStillValid`) is explicitly out
of scope and unmodified.

## Findings

### F1 — The distinction being asked for is not representable (blocking, resolved by design)

`verdictFreshness.fresh` is a boolean. The preserve path (`artifacts.ts:1967`) and the
genuinely-rewritten path (`artifacts.ts:2021`) both emit `fresh: true`. No consumer, however
well wired, could separate them. Resolved by replacing the boolean with a discriminated
`outcome`. **Verified by reading both return sites**, confidence 100%.

### F2 — Three of four preserve paths emit nothing at all (blocking, resolved by design)

`architecture_review_as_built` (`artifacts.ts:1869`) returns a bare `{ done: true }`. The
`prd_audit` (`:1750-1784`) and `manual_test` (`:1587-1606`) preserve short-circuits likewise
return without populating the facet. Only `build_review` populates it on preserve. The design
requires every return site to populate `outcome`, which converts a silent success into a
reported one. **Verified by reading**, confidence 95% — the `prd_audit` and `manual_test`
short-circuit returns were read in region rather than line-exact, so implementation must
confirm each.

### F3 — The sink contract permits silent omission (blocking, resolved by design)

`Array<ConductorEvent['type']>` is satisfied by any subset. Measured drift: 19/57 rendered,
29/57 persisted, 19 dead in all three sinks (17 genuinely emitted). Resolved by the
`Record<ConductorEvent['type'], SinkDeclaration>` registry in
`adr-2026-07-26-event-sink-registry-exhaustiveness.md`. **Verified by enumeration**,
confidence 100%.

### F4 — Blast radius on `events.jsonl` (non-blocking, mitigated)

Making sinks explicit invites routing all 28 currently-dropped types into `events.jsonl`,
changing its volume and content for any external parser. Mitigation accepted: the registry's
per-type `persist` value **reproduces today's behavior exactly** for every type except
`verdict_freshness`. The refactor is behavior-neutral by construction; any additional routing
is a separate, deliberate change. This must be asserted by a test, not left to reviewer
diligence — see the corresponding story.

### F5 — Renderer/registry can themselves drift (non-blocking, accept with test)

The registry's `render: true` flag and the actual `switch` in `renderDaemonEventUnsafe` are
two artifacts that can disagree; `Record` totality constrains the former but cannot force a
`case` to exist. Accepted with a test that reconciles the registry's render set against the
switch's handled set, so the two cannot diverge silently. A stronger alternative — a
table-driven renderer — was judged disproportionate for this tier and is noted as possible
future work.

## Assumptions surfaced (verify-claims)

| # | Assumption | Confidence | Basis | Impact if wrong | How to confirm |
| --- | --- | --- | --- | --- | --- |
| A1 | `ALL_EVENT_TYPES` and `SUBSCRIBED_EVENT_TYPES` are engine-internal, not a consumer contract | 90% | inferred — module-private consts, not exported through `bin/conduct` CLI, hooks, or `settings.json` | A migration block would be required instead of a waiver | `grep` the exports across `src/conductor/src/index.ts` and the CLI surface |
| A2 | Nothing outside the repo parses `.pipeline/events.jsonl` by exhaustive type switch | 75% | inferred — no in-repo consumer found that would break on new types | Newly-persisted types could break an external parser | Mitigated regardless by F4's behavior-neutral default |
| A3 | The 57-member count is the whole union | 95% | verified — derived by extracting `type: '...'` literals from `types/events.ts` | A missed member would be a registry gap | The `Record` totality check settles this at compile time |
| A4 | `manual_test` and `prd_audit` preserve returns do not populate `verdictFreshness` | 80% | inferred — read in region, not line-exact | Two fewer sites to change; no design impact | Read the exact return statements during implementation |

None of these is load-bearing enough to block: A1 and A2 are mitigated by the behavior-neutral
default, and A3/A4 are settled mechanically during implementation rather than by judgement.

## Verdict

**APPROVED.** The design is confined to the reporting path, leaves the gating decision
untouched, and replaces a silently-drifting contract with a total one. The one real risk (F4)
is contained by defaulting the registry to current behavior and asserting that with a test.
