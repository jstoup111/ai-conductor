# Architecture Review: Route whole-feature audit fixes to the owning stacked child (#2944)

**Date:** 2026-10-12
**Stories reviewed:** none yet. This is the pre-stories review of the technical track. Inputs were
`.docs/track/whole-feature-audit-fixes-cannot-land-in-the-stack.md`,
`.docs/complexity/whole-feature-audit-fixes-cannot-land-in-the-stack.md` (Tier L) and
`.docs/architecture/whole-feature-audit-fixes-cannot-land-in-the-stack.md`.
**Verdict:** APPROVED WITH CONDITIONS

## Review process

This was a full (Large) review. The design went through three rounds of adversarial review.

| Round | Target | Reviewers | Findings |
|---|---|---|---|
| 1 | approach | 1 Claude, 1 Codex | Converged on B′; C rejected |
| 2 | diagrams | 1 Claude, 1 Codex | 27 findings, 4 blockers |
| 3 | ADR | 3 Claude lenses, 1 Codex | About 36 findings, 6 critical |
| 4 | ADR, second pass | 1 Claude, 1 Codex | 32 statuses resolved or partial; 15 new findings |
| 5 | changed decisions | 1 Codex | No blockers |

Round 3 lenses were crash and state, budget and ADR consistency, and cross-provider.

After round 3 the operator split outcome 6 (the manual landing aid, plus lifting the closed-child
rewind refusal) into #3203. #3203 is blocked by #2944 and blocks #2945 and #784, mirroring #2944's
edges. Every finding from rounds 4 and 5 was folded into
`adr-2026-10-12-routed-whole-feature-repair`.

## Delivery split

After the plan reached 99 tasks, the operator split delivery into four sequential specs (ADR decision
18):
- #2944, this spec: the foundation, shipped dark behind `stacked_prs.route_whole_feature_fixes`
  (default `false`);
- #3210: routing decisions and admission;
- #3211: host-region repair, budgets, obligations and the review base;
- #3212: routed exit, re-validation queue and leaf return. It turns the setting on.

The review below covers the whole approved design. Each later spec re-checks its own slice.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new packages or services. It uses git plumbing already in use: `update-ref --stdin` compare-and-swap on blob refs (the `cascades` and journal precedent), `read-tree -m -u` (restack-sync), and `ls-tree`. |
| Prerequisites | #2943's journaled restack, cascade cap and stack preflight are shipped. #2942's per-child region and #2941's story ownership are shipped. No migration of persisted state: new refs are created lazily. The ledger keeps its schema, adding `authored` storage for stacked features. |
| Integration surface | Wide: the gap loop, the cursor, stack preflight and resume, restack journal, replay and transition, the kickback ledger, repair obligations, `build_review` inputs, the commit hooks, `task-cli`, `kickback-budget-cli`, the event union and the persister. It is bounded by the execution-child resolver and the route record, so most consumers change in one way. |
| Data implications | Three new ref families under `refs/conductor/<slug>/` (`routes/`, `repairing`, `revalidate`) plus `red/c<k>`. All are removed at shipped-record teardown with the existing `refs/conductor/<slug>/` sweep. No `.pipeline/` layout changes beyond the ledger becoming a reconciled cache for stacked features. |
| Performance risk | Each routed round adds region passes and restacks per host, and most re-validate every closed child above the fix. The cost is bounded by the cascade cap (3 per originating child) and region caps. This is the accepted price of per-child green (Consequences). |
| Worktree isolation | All new state is per-feature refs, so there are no ports, databases or shared files. Two features never share a route record. |

## Complexity

High: more than four interacting state machines (cursor, journal, route record, queue, ledger).
Tier L was confirmed. The split to #3203 removed the landing CLI, the lease, park enforcement and
three ADR amendments, so the remainder is one ticket of #2943's size. No spike is needed: every git
mechanism is already proven in #2943.

## Alignment

- **Machinery by default, judgement where needed (CLAUDE.md).**
  - Task-bound routing, cannot-host for file-level prerequisites, receipts, queue production and
    exits are all mechanical.
  - There are two schema-constrained judgements, each verified: the residue routing call and the
    builder's `blocked-by-prerequisite` claim.
- **Event spine.** The refs are exception-C durable state, and every transition is emitted as a
  `ConductorEvent` through a transactional outbox, deduplicated by `eventId`. There is no parallel
  channel.
- **Durability (#497).** Every piece of new authority is in refs, never only in `.pipeline/`. This
  follows restack ADR decision 10's rejection of `.pipeline/` for cascade counts.
- **Domain integrity.**
  - Routing states are explicit enumerations: round kind, per-host state, phase. There are no
    boolean flags.
  - Owner and host are distinct typed fields.
  - Cursor kinds are unchanged; the new fields are optional and typed.
- **N=1.** It is structural: no routing ref is touched on `no-child`, enforced by a `PATH`-shimmed
  `git` guard in the golden suite.
- **Scope check.**
  - The change is consumer-facing in effect, because stacked delivery runs in consumer projects,
    but it adds no rule to `HARNESS.md`.
  - The prd-audit and architecture-review skill text only gains notes about stacked placement.
  - No new skill is created in this scope; the landing skill moved to #3203.

## Domain Integrity

There are no primitive-obsession or catch-all risks beyond those that decisions 6 and 8 already
type. Conditions C3 and C4 make the build enforce exhaustive switches.

## Wiring Surface

| New surface | Called from (design-time commitment) |
|---|---|
| Owner derivation, residue routing call, cannot-host check (`remediation-routing.ts`) | The conductor's remediation gap loop, after classification and admission, only on a cursor with durable children |
| Route record, marker, queue, outbox (`routed-repair-record.ts`) | Gap-loop admission; stack preflight and conductor resume reconciliation (after journal recovery); region entry; loop region exit; restack `applied` transaction (both the executor and recovery's `synced`→`applied` path) |
| `routedRepair` and `revalidating` cursor fields | `resolveActiveChild`, after its `no-child` return |
| Execution-child resolver | Region entry; `activateChildRegionState` and its resume variant; the conduct-state mutation port; `task-cli`; `kickback-budget-cli`; `rewind`'s default; `daemon-rekick` resume authorisation; dispatch identity |
| `blocked-by-prerequisite` verifier | The routed build step's result handling in the conductor |
| Round receipt settlement | `settleBuildPendingRepair`, at BUILD dispatch, under the budget mutation lock |
| Union merge of rem blocks | Restack replay, as a pre-resolver step |
| Queue production | The restack transition, carried in the journal and written in `applied` |
| `routedRepairCredit` | The host or re-validating child's `build_review` cap check |
| `Round:` stamp | The prepare-commit-msg hook asset, while a marker is set |
| `refs/conductor/<slug>/red/c<k>` | `closeChild` |
| Four new events | The route record and queue outboxes, drained to `ConductorEventEmitter` |

**Early overlap scan (advisory).** `ai-conductor overlap-scan` over the main paths reported
`conductor.ts` overlapping `origin/spec/daemon-self-host-guardrails` and
`origin/spec/self-host-phase6-wiring`.

The operator flagged two open implementation PRs. Both are expected to cause rebase conflicts,
not design conflicts:
- **#3136:** `land-spec.ts`, `remediation-projection.ts`;
- **#3133:** `land-spec.ts`, `remediation-projection.ts`, `events.ts`, `event-sinks.ts`.

Two more open PRs also touch the event union:
- **#3142:** `step-runners.ts`, `events.ts`;
- **#3135:** `prd-audit-projection.ts`, `events.ts`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A crash between route, marker and restack transactions leaves a half-routed round that the automatic restack closes over | Data | Medium | High | Marker-first admission; reconciliation after journal recovery; marker deletion only in `applied`; phase table with recovery per state (decisions 6, 7, 13) |
| Budget double charge or refund across crash or worktree recreation | Data | Medium | High | Route-record settlement compare-and-swap as commit point; ledger reconciled by receipt id; cap check before commit (decision 10) |
| Routed rounds cascade into re-validation of every closed child and hit the cascade cap | Performance | Medium | Medium | Cascade cap per originating child; skip only on valid gate input identity; runbook section for the cap with the marker set |
| Residue routing judgement places work in the wrong child | Technical | Low | Medium | Schema-constrained, validated against declared positions, default to the earliest candidate, verified prerequisite fallback |
| Plan-file conflicts during replay after a routed append | Integration | Medium | Medium | Deterministic rem-block union before the resolver; halt on same id with a different body (A9) |
| Conflicts with open PRs #3136 and #3133 (and #3142, #3135) on the event union and remediation projection | Integration | High | Low | Rebase at build time; additive union members only |
| GitHub stack publication (#2945) needs different behaviour for published children | Integration | Low | Medium | Out of scope; routed fixes run before publication in this chain order |

## ADRs Created

- `adr-2026-10-12-routed-whole-feature-repair`: new. It amends 15 existing ADRs, listed in its
  "Amendments made by this decision" section; each amended ADR carries an amendment note.

## Conditions

- **C1.** Every amended ADR carries a dated `> **Amended 2026-10-12 by #2944:**` note at each listed
  decision. The plan's Architecture Obligation Coverage covers every decision of every amended ADR.
- **C2.** The #3019 N=1 golden suite gains the `PATH`-shimmed `git` guard of decision 17. It must
  pass before any routed path is enabled.
- **C3.** Every switch over route kind, per-host state, phase or cursor field is exhaustive, with no
  default arm.
- **C4.** Every new ref is written only through `update-ref --stdin` compare-and-swap. Tests
  inject a concurrent writer for each transaction in decisions 5, 7 and 13.
- **C5.** The runbook gains sections for: routed repair halted on the cascade cap with the marker
  set; `reroute-moved` recovery; re-validation queue inspection.
- **C6.** The closed-child rewind refusal message is re-pointed from #2944 to #3203.
