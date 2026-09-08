# ADR: Durable PRD widening decision reconciliation

**Date:** 2026-09-07
**Status:** APPROVED
**Deciders:** James Stoup, composer session for #2429
**Approval:** Operator accepted D1-D10 in chat after reviewing the architecture proposal.

## Context and verified implementation basis


The operator explicitly authorized proceeding against #2383 implementation before merge. Inspected immutable PR #2393 head bf6a0336cb184894097b132f9fd227b4f89bf54c. GitHub reports OPEN, draft, with ci-gate SUCCESS; this is implementation evidence, not a claim it shipped. The native #2429 blocked_by #2383 edge remains for implementation ordering.

At that revision, RemediationCaseStoreState adds optional suppressions to version v1, normalizes absent suppressions to [], validates their identities, and preserves them through mutate. persistBuildReviewSuppressions writes through that same store before the effective pass/fail fork. The adjudication context receives prior cases and suppressions; finalized exact source outcomes can skip a repeat judge. RemediationCaseRecord still admits only domain build_review. The class expressly owns autonomous state, never the separate operator dispositions.

At spec base 33ad7de51, routeCurrentPrdAuditOverScope validates cleared decisions against current summaries before recording them. readOverScopeDecisions treats corruption as absence. Both import and completion use the 0.8 summary-overlap matcher. These are the in-scope failures; merely adding reviewer context does not repair them.

Installed CLI help verifies Claude --json-schema and Codex exec --output-schema. InvokeOptions and the inspected provider paths do not expose a shared output-schema option yet. Thus native constrained reconciliation output needs narrow provider plumbing in this slice; it is not already supplied by #2383. No claim is made that the local help probe proves end-to-end invocation behavior.

## Options Considered

1. Extend the real case store with a distinct PRD widening domain, keep operator decisions separate, and use a narrowly typed reconciliation mode of existing remediate. Selected: establishes a second real consumer without granting PRD findings build-review act/defer powers.
2. Keep an entirely independent PRD history and judge stack. Fewer immediate shared edits, but duplicates the bookkeeping the operator wants shared; later consolidation would be another migration.
3. Force PRD widening into build_review case dispositions. Rejected: an operator-only scope decision must not become autonomous act, defer, reject, or a repair task.

## Decision

### D1 — Authority has two separate records

Operator accept/refuse authority remains in accepted-widenings.json, upgraded to version 2 with engine decision IDs, feature identity, original finding/source reference, explicit decision, rationale, operator identity, and an engine-ordered revision. Historical records are immutable; supersession explicitly names an earlier decision for the same case. A provider cannot author these fields or supersede a decision. Existing story-criterion decisions retain criterion-only scope. An NC decision binds the original behavior, not a current report ordinal.

Autonomous relationships belong in remediation-cases.json under a new discriminated prd_widening case shape, with engine case IDs, immutable original source snapshots, current source links, and reconciliation reasons. These records have no build work order, deferral issue, autonomous acceptance, confidence suppression, or act/defer/reject disposition. A relationship alone is never an operator decision.

### D2 — Extend existing storage machinery without losing #2383 data

Use the existing RemediationCaseStore lease and atomic mutate seam. Introduce a version-2 envelope with a tagged union of build_review and prd_widening records. Preserve existing build_review records, effects, suppression entries, and feature identity on v1-to-v2 migration. Preserve the existing feature identity version independently of the envelope version. Validate source uniqueness within its domain namespace; a lap-local NC ordinal is not a global source ID.

Every build-review consumer filters or exhaustively handles its own domain. Build-review mutations preserve PRD records; PRD mutations preserve build-review records and suppressions. Existing build-review source/outcome, suppression, and recurrence behavior is unchanged. Unknown versions/domains and malformed state fail explicitly; never normalize corruption to an empty successful store. Downgrading to an older writer is unsupported and must fail closed rather than overwrite newer state.

This is the first real second-domain implementation. Shared storage and projection primitives are reused; shared gate authority is not inferred. Cross-gate equivalence still belongs to #2441.

### D3 — Capture original decisions before current-report reconciliation

When presenting a new over-scope halt, persist an engine-stamped decision offer with the feature, original finding evidence, report snapshot, and offered case reference before rendering the editable block. Capture runs at PRD-audit entry before dispatch and remains idempotently callable from both existing over-scope routing paths. Explicit accept/refuse plus rationale and resolved operator identity is required; pending or a machine clear grants nothing.

The engine validates the cleared entry against its original offer, never against a replacement report. Only the editable decision and rationale may change; an altered immutable offer reference is a named defect. Save the source/case first, then the decision referring to it, then any effective binding. A crash between these writes leaves a harmless undecided case, never an accepted finding without authority. A stable offer/entry identity prevents re-import of an old clear from overriding a later explicit reversal.

On a refused current finding, expose an explicit revise-decision entry referring to the existing decision, with no default acceptance. This makes a later operator reversal possible without silently treating an unchanged old clear as a new decision.

### D4 — Legacy authority is preserved, not guessed away

Read current version-1 decisions and existing fenced HALT.cleared entries before migration. Valid stored rows become legacy source snapshots with their full original evidence and attribution; preserve append order for decision precedence. Identical row replays are inert. Malformed stores remain intact and produce named recovery rather than partial overwrite.

A pre-offer legacy clear can be imported from its original authored summary and explicit decision/rationale using the existing machine-owner resolution; mark its provenance as legacy-clear rather than inventing an offer. It need not match the latest report to enter durable history. It cannot become effective on a current NC finding until reconciliation establishes the relationship. Ambiguous legacy identity remains durable but unresolved; multiple candidate matches do not inherit acceptance. A retired, unsupported format is named with a recovery path; no silent absence.

### D5 — One source-complete judgment for unmatched current NC findings

After the current PRD report is parsed, the over-scope coordinator assembles all valid current NC widening findings and all feature-local PRD widening history, including accepted, refused, superseded, absent, and unresolved cases. Story-criterion decisions are handled mechanically and are not rematched semantically. Include original and current source evidence, feature diff identity, decision revisions, prior validated relationships, and relevant code evidence pointers.

A validated prior relationship may be reused only for the identical source snapshot, code/diff snapshot, decision revision, and contract version. Report-local key reuse, shared commit/path, token similarity, or an unchanged summary alone is insufficient. Drift enters one existing remediate dispatch in prd-widening-reconciliation mode. This is a separate bounded responsibility from the existing gap-planning mode, not a new lifecycle step or a second cross-gate adjudicator. A lap may still need its existing gap-planning dispatch for unrelated FIXABLE/PLAN_GAP findings; #2060 owns consolidation.

The result covers each supplied current source exactly once with same-case(existing case ID), different, or uncertain(candidate case IDs and reason). New case IDs are stamped only by the engine after validation. A same-case result needs a substantive explanation; incomplete evidence may be uncertain. No judge verdict directly says accepted or refused.

### D6 — Engine-owned native output contract

Define the closed versioned input projection and JSON output schema in the engine. Thread a narrowly optional schema contract through InvokeOptions and the existing selected-provider execution path. Claude passes its native JSON-schema option; Codex uses an engine-created schema file under the feature invocation scratch directory and its native output-schema option. The adapter consumes the provider's final structured result, not markdown or arbitrary intermediate tool text. The engine validates the schema again and validates all cross-record relationships.

No other step's parser is migrated in #2429. Skills carry judgment guidance for this mode, not output-table formatting or a duplicate schema. Unsupported schema capability, absent terminal output, malformed JSON, or field violations are named mechanical failures. Existing invocations with no schema option remain unchanged. Both providers must be covered with faithful adapter fixtures; real provider calls are opt-in smoke-only. Preserve self-host write containment for the schema file.

This supplies only the contract needed here and is an incremental implementation of #2188's direction. Consume a compatible shared seam if it lands before BUILD; do not introduce a competing second option. Coordinate that ownership in #2188 before land.

### D7 — Bounded inputs and retries never erase obligations

Initial bounds: 512 current sources, 128 PRD cases, 512 source links per case, 64 evidence pointers per source, 256 bytes per identifier/reference, 8000 bytes per prose field, and 128 KiB total serialized reconciliation input. These are explicit approved engineering limits based on the existing build-review context precedent, not measurements of this feature's needs. Overflow names the dimension, actual size, and limit and blocks reconciliation without truncation or history pruning.

At most one successful semantic reconciliation is accepted per unchanged frozen input. An uncertain result is terminal for that snapshot and asks for an explicit operator decision; it does not retry for a more agreeable answer. Mechanical dispatch failures use the configured remediate attempt allowance and then a named halt. Reconciliation never charges a BUILD or plan-growth allowance. Restart reuses committed evidence for the same input rather than replaying a completed judgment.

### D8 — Commit relationships with optimistic freshness, classify mechanically

Capture a digest of the report/source set, code/diff snapshot, feature identity, and decision-store revision before dispatch. Recheck all of them under the state transition boundary before publishing relationships. A newer decision or changed report invalidates the proposed result; leave the prior authority intact and request fresh reconciliation rather than committing stale output. Do not hold the store lease across a provider call.

Once relationships are durable, derive accepted, blocking-refused, blocking-undecided, or not-blocking from those relationships plus current authoritative decisions. Routing, verdict projection, artifact completion, and ship rendering consume that same classification and freshness evidence. They never call an LLM or re-run summary similarity independently. A raw reviewer statement that an approval exists cannot satisfy completion.

An absent current finding may make its refusal presently moot, but does not delete the refusal or history. Recurrence is reconciled against the retained case. A changed/refused widening cannot be silently converted into a repair task by this slice.

### D9 — Recovery and observability follow existing ownership

Persist decision and relation state as state, using the existing durable stores. Extend the existing ConductorEvent spine for offers, imports, relationship results, stale/invalid rejection, legacy recovery, and exact-result reuse. Events carry IDs and bounded reasons; original operator rationale remains attributable in the state/report. No watcher, separate event schema, or telemetry sidecar is added.

Missing attribution, write/lease failure, ambiguous legacy binding, corrupted stores, malformed current rows, stale output, and projection failure each have explicit recovery text. A valid sibling decision may be saved while another cleared row is defective, but defects stay visible and cannot yield a clean gate. Report parser completeness remains independently blocking.

### D10 — Architectural amendments and delivery boundary

After approval, amend the older over-scope ADR beside D3/D4/D5/D7/D8 to replace current-report/prose binding and corruption-as-absence with this capture/reconciliation contract. Preserve original ADR text with the harness amendment form. Replace the old no-owner story 4 assertions that require re-asking solely for rewording/renumbering, and the stale clear-time current-key requirement, in place without amendment records. Do this in DECIDE, never as BUILD tasks. Limit amendments to assertions actually superseded.

The existing mixed-build-review ADR and #2383's suppression/recurrence behavior remain authoritative for build_review. No NC confidence floor, plan task append, cross-gate equivalence, rubric expansion, or combined-budget redesign is introduced. Architecture/plan authoring proceeds against the inspected #2383 head as authorized; BUILD waits for the dependency. Recheck a materially changed dependency diff before land and adapt affected contracts, without reopening unrelated scope.


## Consequences

### Positive

Original operator authority survives reviewer wording drift. A second real case-history domain reuses existing persistent machinery while retaining separate gate authority. Invalid and uncertain outcomes remain visible without erasing decisions.

### Negative

This slice requires two versioned store migrations and narrow provider schema support. Semantic equivalence remains a fallible judgment; validation guarantees authority and source completeness, not the truth of an incorrect same-case judgment. The original decision and source trace support inspection and correction.

### Follow-up Actions

- Author acceptance stories and a mechanism-based implementation plan under this ADR.
- Preserve the native dependency on #2383 and verify changed predecessor contracts before land.
- Continue later review-history, combined-routing, and cross-gate slices under #2440, #2060, and #2441.
