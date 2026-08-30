# Architecture Review: Setup fix-session repairs must converge (#1346)
**Date:** 2026-08-29
**Stories reviewed:** none yet; technical-track input is the approved explore scope and sequence diagram
**Mode:** Lightweight (Tier M — feasibility + alignment)
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Existing TypeScript engine and Git plumbing are sufficient. `GitRunner` already supports injected tests, `makeGitRunner` marks engine-owned commits, and no package or service is needed. |
| Prerequisites | The fix-session begins after `runTriage` proves a clean tree or quarantines prior dirt; `createForcedSetupPrepare` already guarantees a real setup run; `runSetupTriage` already receives the feature-scoped event emitter. |
| Integration surface | The setup-triage outcome and Git transaction, daemon production wiring, event union/sinks/renderer, HALT rendering, tests, and daemon recovery documentation are coupled but bounded. |
| Data implications | No schema or external persistence. The feature branch gains a verified repair commit on success; rejected attempts use the existing per-slug quarantine ref. |
| Performance risk | Extra Git snapshots and verification run only after setup failure and one fix-session. There is no normal dispatch-path cost. |
| Worktree isolation | Every Git operation is rooted in the feature worktree; quarantine refs remain slug-scoped; no shared port, database, or service is added. |

## Alignment

- **Governing state transition:** `adr-2026-07-09-setup-failure-triage` already requires a
  mechanically verified committed fix. Its Decision 4 is amended in place to assign the missing
  commit/provenance transaction to the engine; no duplicate ADR is warranted.
- **Forced verification:** `adr-2026-08-26-setup-once-per-worktree-marker` Decision 4 remains
  authoritative. Repair verification must call the existing forced setup path, which may update
  ignored `.daemon/` state but may not change the captured Git tree.
- **Preserve before reset:** the existing quarantine decision remains authoritative. The rejected
  repair path must retain provider commits and residue together on the quarantine ref before it may
  restore the original HEAD; a preservation failure leaves the attempt in place and parks.
- **Provider-neutral engine commit:** the existing production `makeGitRunner` seam and
  `CONDUCT_ENGINE_COMMIT=1` convention cover engine-owned recovery commits on either provider.
  Provider text never decides whether the transaction passes.
- **Event spine:** repair disposition is emitted as a `ConductorEvent`, declared in the exhaustive
  sink registry, rendered to the daemon log, and persisted to the feature's `events.jsonl`.
  `adr-2026-07-26-event-sink-registry-exhaustiveness` supplies the existing structural pattern;
  no sidecar or bespoke ledger is permitted.
- **Diagram accuracy:** the approved repair sequence shows the clean-start boundary, forward-commit
  acceptance, exact-tree engine commit, preserve-and-park fallback, and event-spine wiring.
- **Scope:** daemon setup-failure triage only. General BUILD commits, manual conduct, autoresolve,
  and the consumer-owned `bin/setup` contract remain unchanged.

## Wiring Surface

| Production surface | Production caller / consumer |
|---|---|
| Exact repair snapshot, preservation, and engine-commit transition in `engine/setup-triage.ts` | Called by `runSetupTriage` in `daemon-cli.ts` after its one `resolveSetupFailure` dispatch and forced setup callback. |
| Enriched `TriageOutcome` repair disposition and closed rejection reason | Returned through the existing `runSetupTriage` dependency to `daemon-runner.ts`, whose park path writes the actionable HALT and feature reason. |
| New `setup_repair` member of `ConductorEvent` | Emitted by production `runSetupTriage` through its existing feature-scoped `ConductorEventEmitter`; declared render+persist in `engine/event-sinks.ts`; rendered by `daemon-cli.ts`; persisted by `EventPersister`. |
| Engine-owned setup repair commit | Created through the existing worktree-rooted production Git runner; verified before `fixed-pass` returns and then consumed by the ordinary daemon BUILD/review flow. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A provider makes an unrelated edit during the fix-session and it is included in the captured tree | Technical | Low | High | Attribute only from a proven clean start, require exact setup-stable tree identity, and retain all downstream BUILD/review/SHIP gates; never infer allowed paths from error text. |
| Rejected committed history or residue is lost during restoration | Data | Low | High | Create or refresh the quarantine ref over the complete attempt before any reset; preservation failure performs no reset. |
| Setup itself changes a tracked or untracked path and contaminates the repair commit | Data | Medium | High | Compare exact Git tree identity before and after forced setup; mismatch is a closed rejection and preserve-and-park outcome. |
| A commit hook or Git failure creates a partial or incorrect repair commit | Integration | Low | High | Verify parent, committed tree, HEAD, and final porcelain; on mismatch preserve the complete attempt and restore the original HEAD only after preservation. |
| A new event is emitted but invisible to one sink | Integration | Low | Medium | `EVENT_SINKS` is an exhaustive `Record` over the event union; tests assert render and persistence behavior. |

## Early Overlap Scan

The advisory scan flags `src/conductor/src/engine/setup-triage.ts` across many retained local and
remote `spec/*` refs, including the directly related original setup-triage and #582 specs. It found
no additional candidate-path overlap in its rendered output. Conflict-check must distinguish active
story conflict from historical branch residue before plan authoring.

## ADRs Created

None. The applicable structural decision already exists; Decision 4 of
`adr-2026-07-09-setup-failure-triage` was amended additively with operator approval on 2026-08-29.

## Conditions

None.
