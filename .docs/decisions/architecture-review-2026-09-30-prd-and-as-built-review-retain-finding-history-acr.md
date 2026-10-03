# Architecture Review: PRD and as-built finding continuity

**Date:** 2026-09-30
**Source:** jstoup111/ai-conductor#2440
**Mode:** Full, Large; technical track; before stories.
**Input:** Operator-approved approach A, scope/track marker, approved four-diagram flow.
**Verdict:** APPROVED
**Approval:** James Stoup approved the complete architecture decisions in composer on 2026-09-30.
**Stories reviewed:** None yet, by canonical DECIDE order.

## Feasibility

Current GitHub main matches worktree base 99d077d837f6b5cbeb2a3fcbde21ed1a036a50c4. #2429 and #2188 have shipped; the NC widening and native as-built contracts are verified in current source and shipped records. The original issue's build_review-only store description is superseded by v2's PRD widening support. The general criterion/as-built continuity gap remains verified from production input and persistence paths. This is source evidence, not a runtime incident reproduction.

No new runtime, service, package, network integration, or provider capability is required. Existing filesystem state leases, atomic replacement, conductor state mutations, group join, native-schema provider dispatch, and event persistence provide the necessary boundaries. The only external judgment remains the selected supported provider, using the same seam for Claude and Codex.

The main integration work is state-version preservation, complete gate-local projection, typed source/case relationships, actual repair-evidence binding, and a shared completion reader. Current writers in prd-widening-capture, -offers, -migration, -coordinator and conductor version checks must all be included in v3 migration. Reusing the existing store alone would be insufficient if any later v2 writer dropped the new domains.

Missing-state detection needs the existing conduct-state owner to retain per-gate enrollment and receipt references: RemediationCaseStore.load currently treats ENOENT as an empty store. The new completion reader must distinguish a fresh gate from a missing required history. The case-publication/checkpoint pair needs an explicit recoverable partial-write state; it is not a multi-file transaction.

## Complexity

Large is appropriate: two review authorities, a shared persisted envelope, operator provenance, concurrent/serial integration, provider calls, crash recovery, and completion/fence reuse. This remains the independently useful #2440 slice. It does not absorb #2060's routing/budget consolidation, #2441's cross-gate equivalence, or #2521/#2522 parser migrations. Shared model dispatch and engine validation remain scoped to history.

## Alignment and reuse

- Reuse adr-2026-09-07-durable-prd-widening-decision-reconciliation D1-D9 for separate authority, leased shared storage, original decision capture, native schema, complete bounded inputs, freshness, and existing event spine. Add a bounded D2 amendment for v3, with no new NC authority.
- Preserve adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback: story criteria and intent remain authority; grade/routing vocabulary, criterion-bound repair and scope decisions remain unchanged.
- Preserve adr-2026-08-25-as-built-remediable-findings-bounded-build-route: REMEDIABLE versus DESIGN, governing references, existing-task/appended repair ownership, pending findings, and configured kill switch. Add beside D6/D7 the durable-history-before-clear qualification. Its #2753 budget amendments govern repair authorization; history records outcomes and never changes when budgets are charged.
- Preserve adr-2026-07-10-validation-group-join's single-writer state/gate join and member-owned outputs. History projections are prepared before fan-out; shared publication happens at the join. Branch objective checks distinguish valid reviewer output from final reconciled completion so they cannot retry endlessly waiting for a join-owned artifact.
- Consume the shipped #2188 as-built projection/verdict amendments to the widening ADR and existing recorded-findings reader. As-built Markdown remains a derived view.

Focused local precedent: RemediationCaseStore.mutate supplies feature binding, locking, validation-before-write, and atomic replacement. coordinatePrdWidening supplies frozen inputs, native result validation, short publication leases, authority rechecks, and exact-input reuse. Those semantic traits apply directly. New gate-specific history shapes, current/prior source completeness, evidence transitions, and the independent enrollment checkpoint are the bounded structural additions; copying the NC contract wholesale would incorrectly impose widening-only authority on general findings. Stable paths/symbols are rediscovery hints, not fixed line coordinates.

## Domain integrity

Use distinct typed feature/gate/case/source/decision/attempt references and discriminated state/result unions. Validate external provider values and persisted state at their entry boundaries; trusted internal code must not guess unknown versions or map malformed states to empty success. Engine-authored identifiers, receipts, repair facts, and operator revisions cannot be supplied by a model. The semantic reconciler provides relationships, reasons, and a current evidence-backed judgment of a matched repeated assertion; it cannot author decisions, task effects, or approve unrelated new findings. The raw review remains attributable and all untouched classifications remain in force.

Every source and supplied prior case needs a disposition. Resolution and reopening are evidence-bearing history facts, separate from gate success and operator permission. Original operator decisions remain immutable and scoped; previous autonomous outcomes remain evidence, never approval. Current unresolved failures keep their existing routing authority. A repeat can clear only through a fresh source-complete judgment grounded in current evidence under the same criterion/ADR authority; a prior dismissal or relationship alone cannot clear it.

## Wiring Surface

New module names below are design seeds; equivalent local organization is allowed while preserving these boundaries and production callers.

| Surface / candidate paths | Production caller and consumer |
| --- | --- |
| v3 history types, migration, preservation helpers in `remediation-case-store.ts`, `remediation-case-artifact.ts`, and existing widening readers/writers | Every existing store read/mutate path; new history coordinator; preserve existing build-review effects and suppressions |
| `review-history-contract.ts` and `review-history-projection.ts` | Pre-dispatch conductor preparation; step-runners renders immutable context for PRD/as-built; post-review coordinator validates native results |
| `review-history-coordinator.ts` | Serial review transition and validation-group single-writer join; adapts existing NC reconciliation output and publishes complete batches |
| `review-history-evidence.ts` | Existing planRemediation admission, BUILD work-order/task outcome transitions, and as-built recorded-findings projection; supplies durable facts and idempotent repair bindings |
| `review-history-completion.ts` | Existing artifact predicates, gate-verdict computation, conductor routing, retained-sibling validation and FINISH fence; no provider dispatch from a completion reader |
| `review-history-recovery.ts` | Entry/coordinator/completion failures; conductor's existing halt/clear capture records attributed legacy-boundary decisions |
| `types/state.ts`, state mutation/validation owners, `conductor.ts` | Gate enrollment and receipt reference are committed by the existing state owner; read for loss detection and crash recovery |
| `group-core.ts`, `StepRunOptions`, `step-runners.ts`, `as-built-projection.ts` | Immutable gate-local review context reaches serial and concurrent members through the same contract; existing one-shot remediate handles new reconciliation mode |
| `prd-widening-coordinator.ts`, `prd-widening-classification.ts`, `conductor.ts` | Existing NC authority remains sole owner; adapt validated results into complete PRD history without semantic rematching |
| `kickback-ledger.ts`, existing repair admission/outcome owners | Preserve pending findings and durable admission receipts; history imports only actual attributable facts before pending projections clear |
| `as-built-verdict-store.ts`, existing PRD/verdict/shipped renderers | Derived source/case trace and recorded resolution/attempt evidence; no new Markdown parsing |
| `types/events.ts`, existing emitter call sites | State owners emit new review-history occurrences to EventPersister and existing consumers |
| `skills/prd-audit/SKILL.md`, `skills/architecture-review/SKILL.md`, `skills/remediate/SKILL.md` | Existing review and remediation dispatches supply judgment guidance; engine remains sole schema owner |
| `README.md`, `docs/reference/artifacts.md`, `docs/runbooks/stalled-or-stuck-feature.md` | Explain continuity, limits, preserved authority, migration and recovery to operators |

## Overlap report

The corrected comma-separated candidate-path scan reported:

```text
Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/engine/conductor.ts, README.md
Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/engine/conductor.ts, README.md
Note: renames or name-only diffs may not be detected by this scan.
```

Read-only GitHub verification found both source PRs already MERGED (#179, #180); these are retained branch matches, not open implementation blockers. #2440's native blocked_by list contains #2429, now closed. Open spec PR #2805 concerns interactive operator review of non-clean as-built verdicts; it changes when non-auto review prompts appear, not finding-history authority. Preserve that behavior if it lands. #2521 remains open and owns PRD verdict/full-input migration; integrate landed contracts instead of waiting for or reimplementing the whole migration. The scan is advisory and name/rename detection is limited.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| A legacy writer drops a new history domain | Data | Medium | High | v3 reader/writer migration in one change; shared preserve-domain helpers; tests through real writer seams |
| An incorrect semantic match transfers authority | Domain | Medium | High | Separate operator authority, immutable original sources, scoped current binding, explicit uncertainty, current gate authority and untouched failures preserved |
| Join waits for a receipt only the join can create | Integration | Medium | High | Separate reviewer-artifact validation from final history-qualified objective completion |
| Crash publishes history but not the checkpoint or repair link | Data | Medium | High | Atomic case batch; durable receipt ordering; replay from matching owner evidence; no duplicate append or invented success |
| Complete history exceeds the proposed bounds | Performance | Medium | Medium | Dimension-named overflow, preserved state, no truncation; explicit engineering limits reviewed by operator |
| Legacy history cannot be fully reconstructed | Data | Medium | High | Named stop; restore evidence or explicitly acknowledge a coverage boundary only for valid legacy state; never auto-approve findings |
| Multiple semantic calls increase review cost | Performance | High | Medium | One accepted result per unchanged input; reuse stored receipts; later consolidation remains #2060 |
| Parallel sibling writes invalidate or erase history | Integration | Medium | High | Gate-local revisions, leased domain-preserving writes, single-writer join, no provider under lease |

## Verification design

Use production engine entry points with fake provider/GitHub boundaries and temporary feature state. The later plan must assign integration proof for migration through old/new writers, complete history at both reviewer dispatch shapes, source-complete reconciliation and NC preservation, admission-to-BUILD outcome binding, completion/fence rejection of invalid history, and crash/restart replay. Lower-layer tests cover detailed schema permutations and bounds; do not duplicate those permutations in system specs. Test providers through the existing native-schema adapter seam with faithful final structured results. No real provider, GitHub, daemon, or operator session is needed. No tests or implementation have been authored or run in this DECIDE review.

## ADR and approval

Approved ADR: [Gate-local review finding continuity](adr-2026-09-30-gate-local-review-finding-continuity.md). Its D12 amendments have been applied beside the governing widening D2 and as-built route D6/D7. Original text remains intact; no unrelated decision is superseded.

The limits, additional gate-local reconciliation mode, v3/checkpoint structure, and explicit legacy coverage-boundary recovery are operator-approved engineering choices, not claims that these mechanisms already exist. Existing mechanisms relied on have been verified from source. No unconfirmed claim is represented as an approved dependency.

## Scope / event-spine verdict

Audience: consumer-facing harness behavior; not self-host-only. Catalog: n/a; no new skill or registration. Provider: agnostic through existing Claude/Codex seams. History/checkpoint records are durable state (exception C); occurrences extend the existing ConductorEvent union and emitter. No alternate telemetry channel, provider settings change, or new CLI surface.

## Verify-claims verdict

CLEAR. The current-code and prerequisite basis is verified, and the operator approved the structural decisions, limits, and recovery trade-offs on 2026-09-30. Approved artifacts and governing amendments are recorded here before stories. No implementation begins in composer.

## Approved conflict-resolution alignment

On 2026-09-30 the operator approved option 1 for all three conflict groups. The adjacent amendments and in-place older story corrections preserve approved D2/D6-D9: raw evidence remains validated, final completion uses current effective evidence, branch validation reaches the join before final history satisfaction, and pending facts are retained before clear. Older grade/routing clauses in the PRD authority and retry-classifier contracts receive the same qualification; no new routing or budget policy is introduced. The current feature stories retain all 89 accepted criteria unchanged.
