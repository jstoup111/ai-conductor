# ADR: Gate-local PRD and as-built finding continuity

**Date:** 2026-09-30
**Status:** APPROVED
**Deciders:** James Stoup, composer session for #2440
**Approval:** Operator approved D1-D12 in chat on 2026-09-30 after reviewing the complete architecture proposal and its trade-offs.

## Context

The operator selected durable cases, technical track, and approved the component/sequence flow. Current GitHub main and spec base are 99d077d837f6b5cbeb2a3fcbde21ed1a036a50c4. #2429 shipped original PRD widening decisions and NC reconciliation; #2188 shipped typed as-built verdicts. The remaining issue is complete history within each review gate, not cross-gate equivalence.

Verified source basis: RemediationCaseStore has a leased, atomic single mutation seam and v1/v2 readers. Its v2 state holds build-review cases, suppressions, and PRD widening cases. Several widening writers reconstruct v2 explicitly. buildPrdWideningContext selects NC OVER_SCOPE findings. buildAsBuiltProjection reads pending REMEDIABLE findings; projectPendingAsBuiltRemediationFindings projects completed repairs into the current typed verdict and clears that pending set. Neither input path supplies the complete requested history.

Structural prerequisite: adding two durable history domains, a history-completeness checkpoint, and publication/replay transitions is an uncovered state-architecture decision. Reuse the existing widening ADR's storage, original authority, native-schema, bounded-context, and freshness patterns. Its NC-only relationship contract does not already authorize general PRD/as-built history. This ADR adds that bounded structure without replacing existing gate authority.

## Options Considered

### A — Extend cases, retain domain authority (operator-selected)
Reuses real storage and structured-output seams, carries finding continuity explicitly, and supports bounded current projections. Requires coordinated state migration and careful publication ordering.

### B — Retain whole-review snapshots as the primary history
Simpler archival unit, but repeated full-review comparison expands context and leaves case identity and repair attribution to repeated inference. Not selected by the operator.

### C — Feed prior report prose into reviewers only
Does not supply source-complete typed reconciliation, durable decisions, or reliable restart identity. Insufficient for the approved outcome.

## Decision

### D1 — One feature-local store, separate histories and authority

Extend `.pipeline/remediation-cases.json` to envelope v3 through RemediationCaseStore.mutate. Retain existing build_review cases, suppressions, and prd_widening records. Add gate-local review histories keyed by prd_audit and architecture_review_as_built. Share the envelope, persistence, evidence/reference types, and validation primitives; do not reuse build-review act/defer/refute powers for these domains.

Each history contains engine-owned case identifiers, immutable original observations, later observations, attempted-repair references, recorded resolution/reopening evidence, and validated reconciliation receipts. It records facts, relationships, and current gate-local judgments, not an independent permission to append work or invent operator approval. Only validated current judgments under the same gate authority can affect effective completion. NC observations reference their existing prd_widening case and original decision provenance; they do not create a second authority for the same widening.

### D2 — Lossless migration and required-history checkpoints

Read v1/v2, validate fully, and upgrade under the existing lease. Preserve all existing feature identity, effects, suppressions, widening sources, offers, decisions, and references. Every writer/selector that assumes v2 must support v3 in the same implementation change; mutation cannot drop another domain. Unknown versions, foreign features, malformed records, and unsupported downgrade writes fail closed before replacement.

Add per-gate enrollment/publication references to existing conduct-state through its mutation port, not a new sidecar. Persist initialized history first, then its required-history checkpoint before dispatch. A crash between writes can recover the matching initialized store; an enrolled gate with an absent store must never enter the store's present ENOENT-as-empty path. Checkpoint validation is mandatory in common entry/completion readers as well as conductor dispatch.

First use with no evidence of an earlier gate is explicitly fresh. Before upgrading a feature already reviewed, inventory existing widening state, PRD report/decisions, typed as-built verdict/recorded findings, pending findings, and available task/repair evidence. Import only attributable facts, once, with legacy provenance; never manufacture missing attempts or resolutions. A partially reconstructable prior history produces a named legacy-history-incomplete stop.

For valid legacy stores only, recovery may offer an explicit new coverage boundary at the current review: persist a feature/gate/input-digest-bound offer in existing conduct-state, capture an attributed operator choice and rationale through the existing HALT/cleared-decision pattern, and record the acknowledged gap permanently. An unedited clear grants nothing. This acknowledgement approves starting history coverage here, never the findings, a widening, or a gate pass. It cannot discard known records, apply to already-enrolled lost history, or repair corrupt/foreign state. Corrupt or lost enrolled history requires restoration of matching evidence; preserve damaged bytes.

The lossless v1/v2→v3 migration also preserves #2464's lifecycle-scoped `build_review` source uniqueness (adr-2026-09-07-durable-prd-widening-decision-reconciliation D2.1): every resolved case for a source, its links, and its `distinctFrom` relations survive the upgrade unchanged, and the upgraded envelope passes the existing remediation-case validator.

### D3 — Occurrence identity is not semantic identity

Engine source IDs identify immutable occurrences using feature, gate, contract, reviewed snapshot, and row/field identity. Report-local NC/as-built IDs and text changes are not case identity. Preserve full original and current evidence plus governing references; hashes detect replay/freshness, never substantive equivalence.

The source set includes PRD non-PASS criterion findings and NC findings, as-built BLOCKED findings, PLAN_GAP findings, and nonblocking drift notes. PRD PASS rows, as-built successful verdicts, reachability evidence, and relevant source/test evidence are resolution context, not fabricated new defects. Every current finding, including informational or human-owned findings, has exactly one validated reconciliation result. Multiple occurrences may relate to one case. No source disappears because its gate cannot act on it.

### D4 — Complete, bounded history before review

Prepare gate-local history before serial dispatch and before validation-group fan-out. Pass immutable per-member context through StepRunOptions/group-core; do not use mutable runner-global history shared by concurrent members. Preserve existing PRD decision capture before this preparation.

Include all cases of that gate: open, resolved, absent, uncertain, and reopened; original/current observations; authoritative decision references; admitted repair task IDs and attempts with actual state; resolution evidence; acknowledged legacy gaps; and governing criterion/ADR/plan references. Both review skills use it as evidence. A reviewer judges the present implementation, cannot claim historic text alone proves equivalence, and cannot author engine IDs or operator decisions.

Approved initial explicit engineering limits: 512 current finding sources per gate; 128 cases per gate; 512 retained observations per case; 64 evidence references per source or resolution; 256 UTF-8 bytes per identifier/reference; 8,000 bytes per prose field; and 512 KiB total serialized history/reconciliation projection per gate. These are design constants, not measured capacity claims. Count all included arrays, decisions, attempts, and evidence toward the total; independently preserve existing review-contract bounds. Overflow names the dimension, actual size, and limit and halts without truncation or pruning. No history is silently selected away to fit.

PRD-audit history enters the typed PRD-audit input projection that #2521 introduces, not a parallel prompt path. The 512 KiB per-gate history allowance is a documented component of that projection's total under adr-2026-09-07-durable-prd-widening-decision-reconciliation D7.2, so the PRD total accommodates it plus envelope overhead; each bound still names its own dimension, actual, and limit on overflow.

### D5 — Typed reconciliation through existing provider dispatch

Add an engine-selected review-history-reconciliation mode to the existing remediate native-schema seam. Its versioned closed input/output contracts are engine-owned. The mode has no plan-writing or routing powers, reads only supplied immutable evidence, and cannot inspect arbitrary extra files. The engine supplies bounded evidence snapshots/pointers and judges uncertainty when evidence cannot establish a relationship.

For each non-NC current finding, return new-case, same-case(existing ID), or uncertain(candidate IDs), with reasons and supplied evidence references. A same-case result also judges the current assertion as upheld, resolved-by-current-evidence, or uncertain. Resolving a repeated assertion requires assertion-by-assertion current evidence against its governing criterion or approved clause; a previous resolution or dismissal is never sufficient. New-case findings retain their current gate classification; this mode does not become a general second audit of unrelated new findings. Same-case on a resolved defect must explicitly classify continued resolution versus recurrence; reopening requires the material reason and current evidence. For each supplied prior case, return still-reported, resolved, not-observed, or uncertain with supporting references. Validate exact source and prior-case coverage, duplicates, gate/feature membership, references, and consistency between the two sets. New IDs, revisions, and immutable source snapshots are stamped only by the engine.

Preserve #2429 as the sole semantic/authority owner for NC widening. Its validated same-case/different/uncertain results enter the PRD history result through an engine-owned adapter; the new judge cannot contradict or broaden them. Publish the complete PRD result only when both partitions are accounted for. A changed PRD review may therefore require the existing NC dispatch plus one general-history dispatch; this slice does not consolidate those with gap planning or across gates.

No new judge is needed for a fully known empty/new history with no prior obligations to compare; the engine records the explicit initial state and current observations. Changed input with relevant history needs judgment; unchanged validated input reuses a receipt. Missing/invalid terminal structured output is a mechanical failure, never a finding or implicit success. Claude and Codex use the existing nativeSchema/finalStructuredResult adapters, capabilities, and provider-failure precedence. Existing PRD report parsing remains #2521's responsibility; consume its landed typed contract if available by implementation, preserving this feature's semantics.

### D6 — Current authority owns resolution and recurrence

A relationship alone does not override current grades or gate verdicts. A fresh, explicit resolved-by-current-evidence judgment for a matched repeated assertion may resolve that source under the same gate authority. Retain the raw review and the current reconciliation as separately attributable evidence; effective classification is derived from both, never from a historical status alone. PRD story criteria retain their authority, and criterion-keyed operator decisions remain scoped to the original criterion; an NC match cannot widen them. As-built compliance remains governed by approved ADR/plan references. Preserve #2429 accept/refuse precedence and freshness checks. A previous autonomous dismissal, another gate's approval, or an ordinary cleared halt is never operator approval.

An attempted repair or completed task is not resolution. Record resolution only from current gate evidence plus an explicit validated case-level reason and evidence references. A disappeared finding becomes not-observed unless present evidence supports resolution. Retain the last resolution and refusal when not observed; absence neither deletes them nor invents a fix. A current blocking finding remains blocking unless this current reconciliation supplies a validated resolution with current evidence. An earlier reviewer dismissal cannot clear it. A repeated resolved assertion with unchanged underlying facts may remain resolved after this current evidence check; its rewording must not force a new unresolved obligation. Reopening a resolved case preserves its history and records why the defect materially recurred/changed; rewording alone cannot establish that reason. An uncertain relationship stays explicitly unresolved and cannot authorize a clean completion. No history outcome may silently convert DESIGN into REMEDIABLE, grant an unapproved architectural choice, or accept a scope widening.

### D7 — Serialized publication, replay, and crash safety

The engine freezes feature, gate, source set, code/diff identity, relevant approved artifact identities, operator decision revision, repair evidence, contracts, and gate-local history revision. Reviewers return their own evidence only. The conductor owns history publication after each serial review and in the validation group's single-writer join; branch providers never mutate shared case history or conduct-state. Publish valid sibling history even if another branch fails, without granting failed or incomplete branches satisfaction.

Do not hold leases across provider calls. Under case-store mutation, recheck the relevant input identities; when reading widening decisions, preserve case-store then decision-store lock order. Writes by a different review domain do not invalidate an otherwise unchanged gate snapshot, and each transition preserves sibling state.

Persist current observations, relationships, case transitions, and the batch receipt atomically. The receipt distinguishes the pre-judgment revision from its own post-publication revision; replay must not invalidate itself merely because publication added history. Unrelated or later changes to the relevant gate/decision/repair evidence do invalidate it. Concurrent authority changes reject stale results without losing prior decisions.

Then persist the matching checkpoint/completion reference through the existing state owner. A crash after case publication reuses the receipt and completes the checkpoint without another judgment or effect. A missing/mismatched receipt or checkpoint is non-publishable; recover from matching persisted evidence or stop. Rebase and gate invalidation discard effective-use eligibility when their existing authority rules require it, but retain case history for fresh review. Neither replay nor history presence marks a gate done by itself.

The frozen code/diff identity follows the gate's rebase-translated code stamp. When a file-changing rebase preserves a completed `prd_audit` or `architecture_review_as_built` gate under adr-2026-07-20-post-rebase-delta-aware-invalidation (its document inputs are unchanged and no regrade is judged necessary), its matching receipt stays eligible against the translated identity, with no fresh judgment and no redispatch. When that rebase reopens the gate, the receipt loses effective-use eligibility while case history is retained.

### D8 — Record repair attempts at existing owners

The existing planRemediation/admission path binds only actually admitted appended or existing tasks to the source/case and the existing repair/work-order identity. Record planned/admitted, started, interrupted/failed, and completed evidence distinctly at the appropriate engine transitions. Associate actual BUILD evidence through that durable receipt; do not infer execution from task existence, event timing, or an as-built report summary.

Publish the admission fact at its owning boundary, then import it idempotently into history; if the second write fails, recovery replays the existing admission record rather than appending tasks again. If old admission evidence cannot prove a binding, stop with that gap. Preserve the current pendingAsBuiltRemediationFindings compatibility path; write its known attempts/outcomes to durable history before clearing or replacing its projection. Historic repair evidence remains available after later verdict files are overwritten.

The new history code never appends tasks, rewinds BUILD, changes planner dispositions, increases allowances, or charges laps/growth. Existing routing and the governing #2753 budget-enforcement decisions retain ownership; consume their current implementation at BUILD. Feed retained attempts back to the existing planner as context. Combined routing, cross-gate equivalence, and a redesign of repeat-remediation policy remain #2060/#2441.

### D9 — One completion reader, no expensive hidden judgment

Expose one engine reader for current validated history/reconciliation evidence and effective gate classification. It applies a current evidence-backed resolution only to its exact source/criterion/clause, preserves all unrelated findings and parser faults, and otherwise keeps original classifications. For a criterion resolution, the evidence must support satisfaction of that criterion; for an as-built PLAN_GAP, the result must explicitly establish current delivery of the affected outcome. Validate the derived effective judgment against the gate's existing vocabulary, references, and completeness rules before any pass. A resolved source cannot silently clear an unrelated gate-level failure or unexplained violation. Conductor routing, objective completion, validation-group reuse, and the FINISH fence consume that result alongside their existing gate evidence. Raw reviewer success cannot bypass a pending, stale, corrupt, or uncertain history result. These readers never invoke an LLM or rematch prose.

Do not create a dispatch cycle: branch result validation establishes only a valid current review artifact; the serial owner/join performs history reconciliation before the final objective satisfaction check. Group branch retries must not treat a not-yet-published history receipt as malformed provider output. Preserved sibling evidence follows the same receipt/freshness test at the join and final publication fence.

Human-readable reports and shipped findings expose case/source references, reconciliation reasons, prior repair outcomes, and any acknowledged coverage gap as derived views of state. As-built Markdown remains derived only; this slice adds no PRD Markdown parser and never reparses its own generated history section as new reviewer evidence.

### D10 — Bounded mechanical retries and actionable recovery

At most one successful general-history reconciliation per unchanged frozen gate input; reuse includes the same explicit uncertain outcome. Uncertainty is a human/evidence decision, not a request for another model opinion. Mechanical failures use the existing resolved remediate attempt allowance and provider handling, tracked durably for this gate/input so restart cannot reset spent attempts. They never consume BUILD or plan-growth allowances. A changed snapshot gets fresh validation under the existing bounded execution path, not an unbounded in-process retry loop.

Name separate recovery results for lost required history, malformed/unsupported/foreign state, incomplete legacy provenance, overflow, missing evidence, uncertain relation, stale snapshot, invalid provider result, unsupported capability, provider exhaustion, and publication/lease failure. Name affected gate, source/case or artifact, preserved evidence, and the action needed. Restore matching evidence for corruption/loss; repair permissions/leases for persistence; choose a capable provider for capability failures; refresh a changed snapshot for staleness; obtain an attributed decision for uncertainty. No reset/delete/prune recommendation masquerades as restoration.

### D11 — Existing event spine and provider parity

History and checkpoints are state under event-spine exception C. Reconciliation started/completed/reused/reopened/uncertain/failed occurrences extend ConductorEvent and use ConductorEventEmitter/EventPersister. Emit after the owning state transition; carry gate, batch/source/case identifiers, execution context, and bounded reasons. No side log, watcher, timing reconstruction, or alternate schema. Existing consumers receive new variants through their current subscription path.

Shared engine contracts and production adapters serve both Claude and Codex. Skills carry judgment guidance only. No provider-specific settings, new skill, CLI, or external service is added. Provider support errors name the selected provider and missing capability and preserve the failure category.

### D12 — Delivery and governing amendments

This feature includes state migration, gate inputs/results, repair-history capture, both execution shapes, objective completion/reuse integration, human-readable traceability, recovery guidance, and relevant README/reference/runbook updates. It excludes new routing/budget policy, cross-gate matching, build-review rubric changes, and the outstanding parser migrations.

As part of this approved DECIDE pass before stories/BUILD, add beside #2429 D2 an amendment authorizing v3 and preservation of the two new history domains while retaining its authority constraints. Add beside the as-built bounded-route ADR D6/D7 an amendment requiring complete durable history to retain known finding/repair facts before the existing pending projection is cleared. Preserve original text and use the harness additive amendment form. This does not move those corrections into BUILD tasks or amend unrelated historical statements. The typed-as-built ADR already reserves new history for #2440; apply its existing native-contract/authority decisions.

For PRD audit, the parser migration has landed as #2521's typed verdict; the rendered PRD history view is a human projection that the typed PRD verdict store never ingests as reviewer findings; no Markdown judgment parser is introduced or relied on.

> **Amended 2026-09-30 by #2440 (operator-approved conflict resolution):** D12 also requires the narrow compatibility corrections recorded in this feature's conflict report: qualify older PRD/as-built raw-routing and satisfaction clauses with D6/D9; qualify concurrent-group D5 with the branch-validation/join-satisfaction split in D7/D9; correct the older accepted routing, stale-reuse, projection, and clear stories in place. This records the same approved behavior at its older contracts, without changing budgets, review ownership, or raw validation.

## Consequences

### Positive
Complete gate-local continuity survives wording drift, verdict replacement, and restarts; original operator decisions retain their scope. Every source and history failure stays traceable. Mechanical bookkeeping is enforceable and equivalence remains a constrained judgment.

### Negative
A coordinated v3 migration touches existing writers and readers. History plus one additional semantic judgment per changed gate input adds cost; PRD NC reconciliation may still be a separate call. Explicit limits can halt a large history, and legacy incomplete history may require one attributable operator decision. Schema validation prevents malformed/unauthorized state but cannot guarantee the model's substantive equivalence judgment is correct.

## Follow-up Actions

This ADR and the full architecture review are approved and the bounded governing amendments are applied in this spec worktree. Next author accepted stories, conflict analysis, implementation plan, and coherence mapping. Assign one integration-proof owner per changed production boundary and test crash/restart, lossless migration, stale authority, and both providers through local fakes. No implementation begins in composer.
