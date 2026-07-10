# Architecture Review: Priority-banded intake claim (#461)
**Date:** 2026-07-10
**Mode:** lightweight (tier M — feasibility + alignment only)
**Input reviewed:** issue #461 + explore decision (Approach A, operator-confirmed) + approved diagrams (`.docs/architecture/2026-07-10-priority-banded-intake-claim.md`, `sequences/…`)
**Verdict:** APPROVED

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Pure reuse: `parsePriorityLabels`, `ghIssueLabelReader`, band vocabulary all exist in `backlog-priority.ts` (PR #460). No new deps. One additive export needed: the band ranking (`BAND_RANK`) is currently module-private — export it (or a comparator) rather than duplicate it. Verified in source. |
| Prerequisites | None — no migrations, config, or external setup. `gh` CLI already a claim-path dependency (blocker resolver uses it). |
| Integration surface | Two modules: `dependency-claim.ts` (walk order) + `backlog-priority.ts` (export). `engineer-cli.ts` wiring passes a label reader into the walk. Queue, ledger, delivery guard, blocker resolver untouched. |
| Data implications | None. No schema, no ledger format change, no envelope shape change (`receivedAt` already required — verified in port.ts). |
| Performance | One sequential REST call per pending ref per claim (~22 today). Operator explicitly accepted; claims are operator-frequency, not a polling loop. |
| Worktree isolation | No new services/ports/state. The inbox dir is host-global (`~/.ai-conductor/engineer/`) as today. |

## Alignment

- **ADR-011 (async intake queue):** the atomic-rename claim primitive and lock independence
  are preserved — banding sorts envelopes the walk already holds; `createFileQueue` is
  unchanged. ADR-011's *selection order* ("oldest un-claimed") is amended by the new ADR,
  not silently violated.
- **adr-2026-07-03-priority-from-linked-issue-labels / priority-fetch-fail-soft:** same
  band vocabulary, same read-only REST source, same fail-open-to-chronological outage
  contract — extended to a second scheduler without forking the definition.
- **Pattern consistency:** ordering-as-a-pure-seam-above-discovery is exactly the shape
  #460 used for the daemon (`orderBacklog` after `discoverBacklog`); this applies the same
  pattern at the claim walk. No new pattern introduced.
- **Deterministic-first (CLAUDE.md):** ordering is plain code — no LLM judgment anywhere.
- **State management:** no new states; deferral remains stateless (no ledger writes for
  deferred entries), per dependency-claim's existing contract.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Reader outage mid-claim produces half-banded order | Technical | Low | Medium | Whole-claim fallback: any throw → entire claim uses drain (FIFO) order; never a partial band map (mirrors fail-soft ADR) |
| Full drain lengthens the hold window; concurrent claim sees empty | Integration | Low | Low | Pre-existing all-blocked walk behavior; claims are operator-frequency; finally-block release guarantees no entry is dropped |
| Rank table drift between daemon and intake | Technical | Low | Medium | Single exported ranking from backlog-priority.ts; no duplicate map (ADR decision 4) |
| Quota burn if pending count grows large | Performance | Low | Low | Reads only on explicit claim; operator accepted; revisit batching only if pending count grows 10× |

## ADRs Created

- `adr-2026-07-10-intake-claim-priority-banding` — DRAFT, pending operator approval
  (amends ADR-011 selection order; companions: the two 2026-07-03 priority ADRs).

## Conditions

None. Approval is contingent only on the ADR reaching APPROVED before land (engineer-loop
hard gate).
