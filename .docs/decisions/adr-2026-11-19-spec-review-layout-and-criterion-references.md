# ADR: Spec review layout and criterion references

**Date:** 2026-11-19  
**Status:** APPROVED  
**Deciders:** James Stoup, approved 2026-11-20 for #3419

## Context

The 2026-10-24 manifest decision supplies feature identity and artifact lookup. The 2026-10-28 ownership decision supplies path protection and prune membership. Neither defines the persisted contract for a summary, relocated review files or references between stories, tasks and coherence. The review layout and summary retention are operator-approved.

## Options Considered

A generated review view over the current copied sources would preserve existing readers but still leave several authoritative-looking copies to maintain and reconcile. The proposed contract instead resolves each reference to the one authored source and reuses existing evidence consumers.

## Decision

1. **Select the layout when starting a spec.** A project can enable the new layout for newly authored features. Default to the current layout during rollout. Persist the selection for the feature so a configuration change during authoring or retry cannot mix layouts. Already-authored features keep their original resolution rules.
2. **Keep the executable plan distinct from the summary.** A versioned manifest for the new layout registers exactly one full plan and a separate plan-summary kind. Validate the feature slug, allowed kind/path pairs, containment, and required entries. Continue parsing existing version-one manifests under their original contract. Feature architecture can move into the review folder; shared architecture discovery must include moved diagrams wherever its existing contract requires them. ADRs and architecture-review records stay in the decision corpus; plan-review records keep their current path.
3. **Resolve a criterion and a completion check independently.** For opted-in specs each criterion receives a persistent, feature-unique ID at authoring. Its story owns that ID and the full wording. Preserve the ID when the same criterion is edited or moved; a newly introduced criterion receives a fresh ID. Deletion leaves existing references unresolved and land names the missing ID even when its former wording is unavailable. Never bind it to the row now at its old position. Legacy specs retain positional identity. Each full-plan task owns its completion checks with explicit identifiers stable across edits and reordering. A coherence row identifies a criterion and the task/check references supporting its disposition. Validate identifier uniqueness in scope, actual check ownership, missing and dangling references, and all existing waiver rules. Report affected identifiers with canonical criterion text wherever the criterion still exists. Small specs carry references in the executable plan, Medium and Large in coherence. The existing judgement still determines whether the check actually proves the criterion. A valid reference alone cannot establish coverage.
4. **Build complete input at the reader boundary.** Composer and interactive conduct share layout selection and registration using the plan stem. Before final registration, DECIDE gates resolve the feature's current authored files, including uncommitted changes. Publish a complete manifest before BUILD sealing. For a landed feature, use its manifest on every read. Plan review retains the indexed prompt and inline fallback, resolves referenced evidence at worktree paths, and receives the full plan. PRD audit and coverage judgement receive canonical wording with its linked task checks. A missing reference yields an actionable failure.
5. **Retain by kind across both directories.** Add the summary to plan-equivalent retention and protection. Existing docs-prune selects the summary and full plan in the same shipped-feature set, defers that set on an overlapping open PR, and preserves the requirements, stories, architecture and decisions. Keep #3418's malformed-manifest skip, manifest retirement, and historical full-plan lookup at the deleting commit's parent. Retained material must remain readable after manifest removal. Shared records follow their existing retention by kind.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | The current criterion check (engineer/coherence-validator.ts, checkCriterionCoverage) compares authored rows to extracted story criteria and task text. | verified | 100% | yes | A new input contract would need a different integration point. | n/a |
| A2 | The manifest and path-policy decisions cover the preceding two specs and require spec 3 to own layout adoption (October manifest and path-policy ADRs). | verified | 100% | yes | Ownership, registration and deployment would need redesign. | n/a |

## Consequences

Each reader can recover full evidence without storing a second copy. Adoption adds a second on-disk format to support. A comparison on fixed Medium and Large examples must count every required linked document and demonstrate the saving before release.
