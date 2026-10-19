# Architecture Review: Operator acceptance of a build_review finding does not survive a re-raise

**Date:** 2026-10-19
**Mode:** Lightweight (Tier M), pre-stories
**Input:** intake jstoup111/ai-conductor#3271, `.docs/track/operator-acceptance-of-a-build-review-finding-does.md`
(technical track), `.docs/architecture/operator-acceptance-of-a-build-review-finding-does.md` (operator-approved)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All claims verified against `src/conductor/src/engine/` on `main` at `8daf31609f` unless marked.

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency, store, service, step, skill, or provider member. One resolver function and one `ConductorEvent` variant. |
| Prerequisites | None. Case source links already persist `sourceId`, `outcome`, `recordedAt` (`remediation-case-store.ts` `RemediationCaseSourceLink`); disposition records already persist `finding`, `sourceLapId`, `operator`, `rationale`, `acceptedAt` (`build-review-dispositions.ts`). Verified 95%. |
| Integration surface | One engine domain (build_review adjudication) plus the `remediate` skill contract. Consumers rewired: effective verdict (`build-review-effective.ts`, `build-review-aggregate.ts`), coordinator accepted set and `finalize`/`failUnlessAccepted` (`build-review-adjudication-coordinator.ts`, `conductor.ts` accepted-id construction), reuse classifier and `neverBuilt` binding strip (`remediation-case-reconciler.ts`, coordinator), decision stop (`remediation-case-effects.ts` `persistBuildReviewDecisionStop`), prior-case context (`build-review-adjudication-context.ts`), `build-review findings` (`build-review-cli.ts`), PR/shipped-record renderer (`build-review-accepted-risk.ts`, `finish-publication-production.ts`, `shipped-record*.ts`). |
| Data implications | None persisted. Both store schemas and versions are unchanged, so no migration. Retired cases already keep their original source ids, so features already stuck benefit on the next lap. Verified 90% (coordinator `finalize` sets only `resolution`). |
| Performance | The resolver joins at most 128 cases × 512 sources (`MAX_CASES`, `MAX_SOURCES_PER_CASE`) with the feature's disposition list, which is bounded and in-memory. |
| Worktree isolation | Reads only the feature worktree's `.pipeline/` stores; no shared resource. |

**Root cause (verified 95%).** Acceptance matches by exact canonical identity
(`matchesBuildReviewDisposition`). Custom identity includes the policy bundle digest, the candidate
provider/model/effort, the reviewed-input digest and region content hashes
(`build-review-finding-identity.ts`), so it changes lap to lap. A judge binding to the accepted case
then hits `classifyRemediationCaseReuse` → `halt-regression`, an open-case escalate returns
`conflicting-case-id`, and a resolved-case escalate mints a new open blocking case. No acceptance
marker exists on cases, in the reuse classifier, or in the judge's context.

## Alignment

- **Governing ADRs reused, amended in place; no new ADR.** The structural decision is an
  authority rule over accepted-risk state, which
  `adr-2026-08-29-build-review-remediate-case-adjudication` D2 already owns. That ADR stays adopted
  through `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`, and #2409
  established amending it in place. Amendments added:
  - `adr-2026-08-29-build-review-remediate-case-adjudication` D2.1–D2.5 (operator-approved
    2026-10-19: judge binding may extend, never create, acceptance; derived resolver; carry
    overrides any judge disposition on an accepted case).
  - `adr-2026-08-13-stable-build-review-finding-dispositions` Decision 2 (exact identity is no
    longer the only way an acceptance applies) and Decision 6 (PR rows: id, rubric,
    carried-from origin id and lap only, operator-approved 2026-10-19).
  - Added after conflict-check (operator-approved 2026-10-19):
    `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D3 (a carried
    re-raise is neither a repeat nor a regression) and `adr-2026-09-10-portable-build-review-policy`
    D9 (an escalation bound to an accepted case is no decision stop) and D11 (the repeat stop
    excludes carried recurrences).
- **Design Principle fit.** Equivalence is the judgement call (CLAUDE.md names `build_review`
  re-raise cycling as the canonical over-mechanization). The judge's existing schema-constrained
  `existingCaseId` binding is the judgement; bookkeeping (derivation, scoping, refusal) stays
  mechanical.
- **Event spine.** Carry is an occurrence; it extends the `ConductorEvent` union with one variant
  registered in `EVENT_SINKS` (`engine/event-sinks.ts`). No sidecar or second channel.
- **Domain boundaries.** The disposition store keeps sole ownership of accepted risk, and the case
  store keeps sole ownership of equivalence links (D5). The resolver reads both and writes neither.
- **State.** No boolean flag is added. "Carried" is a derived classification (direct, carried,
  none) computed from existing typed records, so an accepted state cannot drift from its origin.
- **Stacked children.** The coordinator already reads a child-scoped case store with a flat
  disposition store (coordinator `:210-213`, verified 85%); the resolver must take the same pair,
  so a child carries only through its own cases.
- **Sequencing.** #3292 (resolved-case re-raise invariant) and #3294 (re-raise convergence) touch
  the same reconciler, decision-stop path, and ADRs; both are natively blocked by #3271
  (operator-approved 2026-10-19).
- **Story drift note.** Accepted story `.docs/stories/equivalent-re-worded-findings-escape-their-accepte.md`
  Story 2 says "No suppression path exists that is broader than one exact identity". Those stories
  belong to shipped #1611; the Decision 2 amendment above is the authoritative narrowing.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| Shared acceptance resolver (direct / carried / none, with origin) | Called by the effective-verdict derivation, the coordinator's accepted set and `finalize`, the reuse classifier, the decision-stop path, the prior-case context builder, `dispatchBuildReviewFindings`, and the accepted-risk renderer used by finish publication and the shipped-record writer. |
| Reuse classification for a binding to an accepted case (settle as carried) | The coordinator's pre- and post-reconciliation reuse checks, before `halt-regression`/`halt-repeat`, and the `neverBuilt` binding strip. |
| Escalate bound to an accepted case (settle as carried) | `persistBuildReviewDecisionStop`, reached from the coordinator's escalate branch. |
| Halt-time binding link (D2.6) | The coordinator's pre-reconciliation repeat and regression halt branch, before `failUnlessAccepted`. |
| `operatorAccepted` marker on prior cases | `build-review-adjudication-context.ts` prior-case projection consumed by the existing `remediate` dispatch. |
| `build_review_disposition_carried` event | Emitted by the adjudication coordinator through `ConductorEventEmitter`; registered in `EVENT_SINKS`. |
| `remediate` skill contract wording | `skills/remediate/SKILL.md`, loaded by the existing build_review remediate dispatch. |

Advisory `ai-conductor overlap-scan` over these paths: no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A consumer keeps exact-only matching and re-creates the defect (one consumer already reads a different store pair) | Technical | Medium | High | Condition 1: every consumer goes through one resolver, pinned by a test that fails on a direct `matchesBuildReviewDisposition` use outside it. |
| Carry widens to a finding the operator saw and left unaccepted in the accepting lap (late acceptance during adjudication; `recordedAt` is rewritten on rebind, reconciler `:244`) | Security | Low | High | Condition 2: carry requires a lap other than the origin's `sourceLapId` and a binding after `acceptedAt`; pinned for the mid-adjudication acceptance case. |
| Judge mis-binds a genuinely new defect to an accepted case | Technical | Low | Medium | Accepted design trade-off (operator-approved). Every carry is evented and listed in `findings` and the PR body, so it is auditable. |
| `neverBuilt` strips the binding of an acceptance-retired case whose effect was retired as `failed`, minting a fresh act case instead of carrying | Technical | Medium | Medium | Condition 3. |
| Parallel edits to the same reconciler/ADRs by #3292/#3294 | Integration | Medium | Medium | Native blocked-by edges already set. |

## ADRs Created

None. Two existing APPROVED ADRs are amended in place (see Alignment), because the structural
decision belongs to them.

## Conditions

1. **One resolver.** Every consumer listed under Wiring Surface reads accepted risk through the
   single shared resolver; a test enumerates the consumers and fails if one matches dispositions
   directly.
2. **No same-lap or pre-acceptance carry.** A finding of the origin disposition's lap, or a source
   bound before the origin `acceptedAt`, is never carried — including when the acceptance lands
   while that lap's adjudication is running.
3. **Every reuse path honors carry.** The pre- and post-reconciliation reuse checks, the
   `neverBuilt` binding strip, and the escalate decision-stop path all settle a binding to an
   accepted case as carried. None of them halts, mints a case, reserves an effect, or charges a
   kickback.
4. **Fail closed on unreadable state.** An unreadable or malformed case store or disposition store
   yields no carry. It never invents acceptance, and today's raw behavior proceeds.
5. **Unbound findings unchanged.** A finding not bound to an accepted case routes exactly as today;
   regression tests pin the act, escalate, and unbound paths.
