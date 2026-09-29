---
slug: preserve-project-owned-pr-body-sections-through-fi
spec_hash: 81433db82eaf0b5dbb468ad9474fae726849e8ad2cd4774e2308034e535e4c59
pr: https://github.com/jstoup111/ai-conductor/pull/2777
shipped: 2026-09-29
engine_version: 20260929T224340Z-3ed99833a1db
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/conduct-state-lease.ts:90-102 — the default lease filesystem now publishes the owner record with `link` instead of `rename`, so an existing owner is never overwritten; commit 9335e1547 also rewrites conduct-state-lease.test.ts; no story, plan task, or ADR decision covers conduct-state leases"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-001
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 4"
    outcome: remediated
    summary: "[verified, 100%] ensureOwnedStepRegion always calls restoreRegion with template bytes (conductor.ts:3274-3283); restoreRegion replaces a differing marked interior (pr-body-regions.ts:49-57). An already-present authored region is overwritten instead of remaining unchanged."
  - gate: architecture_review_as_built
    finding: AB-002
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 5"
    outcome: remediated
    summary: "[verified, 100%] No capture-discard operation exists. The pre-dispatch hook only prepares the body, while pr-body-region-store.ts:29-50 exports only read and write/replace operations, so a prior capture survives an owning-step redispatch."
  - gate: architecture_review_as_built
    finding: AB-003
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 6"
    outcome: remediated
    summary: "[verified, 100%] Runtime capture reuses parsePrTemplateRegions (conductor.ts:3303-3307), whose template-only validation rejects engine-owned text (pr-body-regions.ts:77-82). Runtime region content is therefore interpreted and can be rejected instead of being captured opaquely."
  - gate: architecture_review_as_built
    finding: AB-004
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 8"
    outcome: remediated
    summary: "[verified, 99%] Config reserves only two engine-owned strings, while upsertShipmentPlanDeclaration scans the entire body and can replace a Plan line inside a captured region. Production applies that upsert after presentation repair and the ready flip (finish-publication-production.ts:803-818), allowing an engine-owned section to mutate a verified project region."
  - gate: architecture_review_as_built
    finding: AB-005
    class: REMEDIABLE
    governing_clause: "Task 6"
    outcome: remediated
    summary: "[verified, 98%] The pre-dispatch GitHub body read is outside a contextual catch (conductor.ts:3277-3281). A thrown read failure reaches the generic halt unchanged, so the required diagnostic need not name the owning step."
  - gate: architecture_review_as_built
    finding: AB-006
    class: REMEDIABLE
    governing_clause: "Task 7"
    outcome: remediated
    summary: "[verified, 98%] The capture-time GitHub body read is likewise outside the step-naming error wrapper (conductor.ts:3301-3305), so a failed read can halt without identifying the owner."
  - gate: architecture_review_as_built
    finding: AB-007
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "[verified, 99%] restoreCapturedRegions reports guarded edit refusal without any region key (conductor.ts:3329-3334), contrary to Task 8's required halt naming the affected step."
  - gate: architecture_review_as_built
    finding: AB-008
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "[verified, 99%] createFinishPresentationRepair reports refused restoration as a generic guarded-region error without the owner key (conductor.ts:543-558); the ready transition then reduces it to presentation_repair_failed, losing the required step diagnosis."
  - gate: architecture_review_as_built
    finding: AB-009
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 9"
    outcome: remediated
    summary: "[verified, 100%] The retired Release-* snapshot subsystem remains in production source: release-metadata-flow.ts:24-177 still defines the snapshot path, persisted read/clear, capture, restore, and supersede APIs; release-metadata.ts:248-336 retains preservation-specific snapshot/merge functions. The approved diagram's deletion claim is therefore false."
  - gate: architecture_review_as_built
    finding: AB-010
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 2"
    outcome: remediated
    summary: "[verified, 100%] config.ts:577-605 validates owner ordering through selectFinishPrerequisiteSteps, whose filter at finish-custom-step-prerequisites.ts:20-23 additionally requires enforcement=gating and a completion_artifact. ADR D2 permits any declared custom step ordered before finish, so valid advisory, structural, or artifact-free pre-finish owners are rejected."
  - gate: architecture_review_as_built
    finding: AB-011
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 5"
    outcome: remediated
    summary: "[verified, 98%] ensureOwnedStepRegion discards an authoritative capture at conductor.ts:3304-3306 or :3321 before self-host dispatch admission. The queued attempt can then be cancelled before dispatch at :6316-6321, as explicitly handled at :10432-10439, violating D5's rule that capture is discarded only when its owner dispatches again."
  - gate: architecture_review_as_built
    finding: AB-012
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 5"
    outcome: remediated
    summary: "[verified, 98%] The capture store does not implement D5's imported fail-loud `.pipeline` write discipline. `writeRegionCapture` silently recreates a missing mid-run `.pipeline` root at pr-body-region-store.ts:49-50, while `discardRegionCapture` writes at line 67 without a guarded recreate or missing-root warning."
  - gate: architecture_review_as_built
    finding: AB-014
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 2"
    outcome: remediated
    summary: "[verified, 100%] Template validation checks only `## Reduced build-review coverage` and `<!-- build-review-accepted-risk:start -->` at `pr-body-regions.ts:97-98`. It still accepts the engine-owned `<!-- build-review-accepted-risk:end -->` marker and `## Accepted build-review risk` heading defined at `build-review-accepted-risk.ts:7-10`, violating D2’s requirement to reject engine-owned markers and headings."
  - gate: architecture_review_as_built
    finding: AB-015
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 2"
    outcome: remediated
    summary: "[verified, 100%] D2 requires rejection of every engine-owned PR-body marker or heading, but ENGINE_OWNED_PR_BODY_TEXTS contains only four build-review texts. Config therefore accepts PR_BODY_FLOOR_MARKER and NEEDS_REMEDIATION_BODY_MARKER inside project-owned regions, although production interprets them as engine provenance and halt signals."
  - gate: architecture_review_as_built
    finding: AB-016
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-project-owned-pr-body-regions decision 6"
    outcome: remediated
    summary: "[verified, 100%] D6 requires author/judge rewrites to restore captures before observation, but runFinishPublication restores only when StepRunResult.success is true. A false or thrown dispatcher outcome may follow a completed remote edit; authoring then immediately re-observes and can advance the un-restored revision, while judgment leaves it for the next observation."
---

## Cost
input: 6589105
output: 844775
cache_read: 148874986
cache_creation: 3486220
cost_usd: 127.2348
dispatches: 105
retries: 12
halts: 11
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 6588245, output: 417723, cache_read: 118579072, cache_creation: 0, cost_usd: 63.7028, dispatches: 56, cost_unmetered: 0
  claude: input: 860, output: 427052, cache_read: 30295914, cache_creation: 3486220, cost_usd: 63.5319, dispatches: 49, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","eeeb594d-3b81-4874-8d85-5a031b18496c","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 10
  testQuality: failures: 0, judged: 10
skip_reasons:
