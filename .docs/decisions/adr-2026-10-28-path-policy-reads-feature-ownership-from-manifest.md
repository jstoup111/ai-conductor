# ADR: Path policy reads feature ownership from the artifact manifest

**Date:** 2026-10-28
**Status:** APPROVED
**Deciders:** James Stoup (operator) and the ai-conductor architecture review
**Feature:** path-policy-still-decides-feature-ownership-by-fol (jstoup111/ai-conductor#3418, spec 2 of 3 for #3405)
**Related:** adr-2026-10-24-per-feature-artifact-manifest (amended by this feature),
adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts (amended by this feature),
adr-2026-07-27-protected-artifact-seal-self-amendment-visibility (its stem-based self-amendment report is replaced for manifest-backed features by decision 4),
adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts,
adr-2026-08-09-operator-only-scoped-artifact-reseal, adr-2026-08-05-provenance-based-protected-artifact-inheritance,
adr-2026-07-22-phase-scoped-docs-write-guard, adr-2026-09-11-selective-post-rebase-verification,
`.agents/skills/event-spine/SKILL.md`

## Context

Spec 1 (`adr-2026-10-24-per-feature-artifact-manifest`) added a committed manifest at
`.docs/<slug>/manifest.json` and a lookup that reads it. Every policy that decides which `.docs/`
files belong to a feature still matches by folder and basename:

- **Seal.** `protected-artifact-seal.ts` protects five folders. `namesOwnFeature` decides a
  self-amendment by stem.
- **Pre-commit hook.** `git-hook-assets.ts` re-implements that stem rule in bash, keyed on the
  `plan_ref` in `task-status.json`.
- **Write allowlist.** `phase-marker.ts` lets `remediate` write all of `.docs/plans/`.
- **Gate invalidation.** `rebase.ts` `resolveReviewInputs` adds same-stem paths in four folders,
  and the folder-prefix lists in `gate-invalidation.ts` decide what counts as a review document.
- **Rebase.** `docsKeepBothResolver` resolves any all-`.docs/` add/add conflict by keeping both
  sides. A manifest conflict would become `manifest~ours.json`.
- **Prune.** `docs-retention.ts` and `docs-prune.ts` select files by family folder and stem, and
  leave the manifest on the default branch.
- **build_review.** The graded diff in `build-review-inputs.ts` has no notion of feature artifacts.
  The testQuality preflight classifies every changed `.docs/` file as production.

None of these reads the manifest. The docs write guard blocks Edit, Write and NotebookEdit under
`.docs/` in BUILD, but not Bash, and no seal or hook covers `.docs/<slug>/`. So a BUILD agent can
rewrite the manifest through a shell command undetected. Once spec 3 moves files under
`.docs/<slug>/`, every folder-matched policy would silently stop protecting or scoping them.

## Options Considered

### Option A: Seal the manifest, and give each policy its own manifest branch
- **Pros:** Closes the Bash gap through the existing seal. Each policy changes in isolation.
- **Cons:** Seven places would decide ownership, and the bash hook would keep a separate copy.
  Drift found only at build_review entry and land is found after the whole build has run.

### Option B: One engine-computed ownership result that every policy reads (chosen)
- **Pros:** One rule for every policy. Tampering and drift stop the run at the next step boundary,
  whatever tool made the change. Legacy specs keep today's code path.
- **Cons:** Extends the phase-marker format and adds an operator command, so both need release
  handling.

### Option C: Treat `.docs/<slug>/` as owned by folder convention
- **Pros:** Smallest change.
- **Cons:** Contradicts manifest ADR decision 1, which makes the manifest the authority. It would
  also leave every spec 1 manifest, whose entries point at legacy folders, unprotected.

## Decision

1. **One ownership result per feature.** A new engine module beside the manifest module computes
   one result for a feature slug from a file source (worktree, git ref or prefetched tree). It finds
   the slug the way `resolveArtifactFiles` already does: active plan stem, then plan stem, then
   `feature_desc`. The result is a discriminated union:
   - **legacy:** no manifest exists.
   - **manifest:** the owned paths (every listed path), the protected paths, and the manifest path.
   - **malformed:** the spec 1 parser's named failure.
   - **drift:** every missing path and every unlisted path, each named.

   Policies never re-derive ownership from names when the result is `manifest`. When it is `legacy`,
   each policy runs today's rule unchanged.

2. **Drift is checked in both directions.**
   - **Missing:** a listed path is absent from the source.
   - **Unlisted:** the feature added the path, the path is in scope, and the manifest does not list
     it. The feature added a path when it appears as added or untracked between the merge base of
     HEAD with the feature's base branch and the working tree.
   - **In scope:** a path the spec 1 kind table (`MANIFEST_KIND_LOCATIONS`) classifies as a manifest
     kind, or any path under `.docs/<slug>/`.
   - **Excluded:** the manifest itself, plan-review, shipped and halted records, and release waivers
     (manifest ADR decision 3).

   A run never proceeds on a partial set.

3. **Evaluated where the seal already is.** The result is computed at every BUILD and SHIP step
   entry, before the seal is verified. It is computed again before rebase moves HEAD, and in
   restack, wherever the seal is verified there. A `malformed` or `drift` result refuses the step
   exactly as a seal failure does today: refusal kind `seal`, a reason naming each path, and a HALT
   of the protected-artifact class from the second attempt. The recovery text names the remedy:
   - an unlisted path: the register command (decision 8)
   - a missing path: restore the file
   - a malformed manifest: fix the file

   Land performs no separate drift check. It rebuilds the manifest from its own change set (manifest
   ADR decision 6), so land output cannot disagree with its files.

4. **Protection by kind, wherever the file lives.** For a manifest-backed feature:
   - **Protected:** the protected set is today's five folders, plus every listed path of a
     protected kind (`plan`, `stories`, `prd`, `architecture`, `decision`), plus the manifest
     itself.
   - **Seal:** the seal fingerprints that set when it is created and inspects it on every check.
   - **Self-amendment:** a changed listed protected-kind path is a self-amendment, reported and
     judged by build_review as today. This replaces the stem test `namesOwnFeature` for that
     feature.
   - **The manifest:** it is never a self-amendment. Any change to it, by any tool, is
     `Protected artifact changed`, unless decision 8 rotated the seal for it.
   - **Rotation:** every seal rotation (rebaseline, provenance rotation, reseal, registration)
     recomputes the protected set from the ownership result, never from the five folders alone.
     Each rotation's audit record lists every ownership-protected path it covered.
   - **Reseal:** `reseal` accepts a listed protected-kind path wherever it lives, as it accepts a
     path in the five folders. It always refuses the manifest, naming `register-artifact` as the
     only way to change it. The protected-artifact halt's recovery hint names only paths reseal
     accepts.
   - **Unchanged:** kinds outside that list keep today's protection, which is none. Legacy features
     keep today's protected set and stem rule.

5. **The hook reads engine-computed lines.** The phase marker gains `own: <path>` and
   `protect: <path>` lines, which the engine writes from the ownership result.
   - **With lines present:** the pre-commit hook treats a staged path as the feature's own only when
     it matches an `own:` line exactly. `protect:` paths join the five folder arms, and the
     manifest is always protected and never own.
   - **With no lines** (legacy, or a marker from an older engine): the hook keeps today's stem rule.
   - **`remediate`:** for a manifest-backed feature, its write allowlist narrows from `.docs/plans/`
     to the listed plan path.
   - **Exact entries:** an `allow:` entry that does not end in `/` names one file. Both the docs
     write guard and the pre-commit hook match it exactly, so `.docs/plans/f.md` never permits
     `.docs/plans/f.md.bak`. An entry ending in `/` keeps today's directory-prefix matching.
   - **Remediation redirect:** for a manifest-backed feature, the redirect that sends remediation
     aimed at a protected target to the `plan` step treats a target as the feature's own only when
     it is an owned path, not when its stem matches. The land-time plan scanner keeps its stem rule,
     because land gates are not routed through the manifest (manifest ADR decision 5).
   - **Docs write guard:** otherwise unchanged. It already denies Edit, Write and NotebookEdit under
     `.docs/` in BUILD.

6. **Invalidation and rebase use the owned set.** For a manifest-backed feature:
   - **Review-document inputs:** `resolveReviewInputs` uses the listed `stories`, `prd`, `plan`,
     `coherence` and `decision` paths, the manifest, and the ADRs those documents cite. The
     citation scan is unchanged.
   - **Review documents:** a review document is a listed path or the manifest, in addition to
     today's folder prefixes. The declared prd_audit and as-built document surfaces include them,
     so the reported surface and the matched paths agree.
   - **Legacy only:** the same-stem loop, and the fallback that treats every changed review document
     as an input, run only for legacy features.
   - **Manifest conflicts:** no automatic tier resolves a conflict on any
     `.docs/<name>/manifest.json`. The docs keep-both resolver declines it, no model-driven tier
     receives it, and the rebase stops as needs-human with a reason naming the manifest. Recovery:
     take the base branch's manifest, then re-run `register-artifact` for each entry the feature
     registered.

7. **build_review scopes by the owned set.**
   - **Graded diff:** manifests are excluded as machinery-authored, like shipped records.
   - **testQuality preflight:** a manifest-backed feature's listed artifacts and its manifest are
     not production paths, so they are not restored for the counterfactual.
   - **No Scope rubric:** build_review no longer judges scope (#1805), so no build_review prompt
     changes. Self-amendments stay visible through the step-entry advisory that names each path.

8. **Registration after land is an operator command.** `ai-conductor register-artifact --slug
   <slug> --kind <kind> --path <path> --reason <text> [--clear-halt]` registers an in-scope artifact
   added after land.

   **Operator-only.** It is operator-only in the same three ways as `reseal`
   (`adr-2026-08-09-operator-only-scoped-artifact-reseal` decision 4):
   - no step definition exists, so the daemon can never dispatch it
   - it resolves before the pipeline boots
   - it refuses without an interactive terminal

   **Refusals.** It refuses, emitting `feature_artifact_registration_refused` with the condition,
   when:
   - the reason is blank
   - the worktree is unknown
   - the manifest is absent or malformed
   - the path is missing, outside `.docs/`, already listed, or excluded by decision 2
   - the kind is rejected by the spec 1 parser rules
   - the kind disagrees with the kind table for a legacy-located path
   - the kind is a second `plan`

   **On success.** It adds the entry through the spec 1 renderer and makes one engine commit
   (`CONDUCT_ENGINE_COMMIT=1`, as the engine's own commits are made) containing the artifact and
   the manifest. If the commit fails, the manifest and seal are left as they were. It rotates the seal for the manifest, and for the
   path when its kind is protected, with trigger `operator-register`. It then emits
   `feature_artifacts_registered` (slug and added entry) on the feature worktree's spine.
   `reseal` keeps its contract: it still refuses unsealed paths.

9. **Prune retires the manifest with the feature.** For a shipped stem whose manifest is on
   `origin/main`:
   - **Malformed:** the stem is skipped with reason `malformed-manifest`, naming the file.
   - **Selection:** otherwise the selection is the listed entries of prunable kinds (`plan`,
     `conflicts`, `coherence`, `coherence-waiver`, `track`, `complexity`, `applicability`), plus the
     manifest. Halted, plan-review and retro records keep today's stem rule, because the manifest
     does not list them.
   - **Reported reason:** `malformed-manifest` joins the closed skip-reason set of the
     `decide_artifacts_pruned` event beside `no-shipped-record`.
   - **Retention policy:** retention by kind is declared once, in `DOCS_RETENTION_POLICY`.
   - **Deferral:** open-PR deferral applies to the whole set, unchanged.
   - **Pruned-plan lookup:** it reads the plan path from the manifest at the deleting commit's parent
     when the manifest was pruned.

   Stems without a manifest are selected exactly as today.

10. **Legacy unchanged, no flag, one spec in three stacked slices.**
    - **Legacy:** specs without a manifest, and consumer repositories, behave exactly as today under
      every policy, and parity tests prove it.
    - **No flag:** no file moves in this spec, so it needs no feature flag. Every new refusal applies
      only to manifest-backed features.
    - **Delivery:** the operator chose one spec in three stacked slices on 2026-10-28. Slice 1 is
      ownership, drift, seal, hook and allowlist. Slice 2 is invalidation, rebase and build_review.
      Slice 3 is registration and prune. Each slice is safe to merge alone.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | A feature whose seal predates this change does not halt on its manifest when the feature branch never changed it: `inspectSeal` applies the same provenance-based base inheritance to a path absent from the seal as to a changed one (`protected-artifact-seal.ts`, the not-in-seal branch calling `inheritedFromBase`). | verified | 95% | yes | In-flight features would halt once after upgrade and need a registration. | n/a |
| A2 | The merge base of HEAD with the feature's base branch is the right origin for "the feature added this path", for both standalone features and stacked children. Files inherited from the base by a rebase are therefore never reported as unlisted. | inferred | 85% | yes | False drift stops on stacked children or after a rebase. The origin would need the seal baseline plus base-tip inheritance instead. | APPROVED by operator 2026-10-28 |
| A3 | Spec 1 manifests list only paths in legacy folders, so for them protection by kind adds only the manifest itself to today's protected set (`buildFeatureManifest` classifies by `MANIFEST_KIND_LOCATIONS`). | verified | 95% | no | More files would become protected for existing specs. | n/a |
| A4 | No BUILD or SHIP step legitimately adds an in-scope file, so the unlisted-drift stop does not fire on healthy builds (inherits manifest ADR assumption A4; remediation only appends to the listed plan). | inferred | 85% | yes | Healthy builds would stop until an operator registers the file. | APPROVED by operator 2026-10-28 |

## Consequences

### Positive
- One ownership rule drives every path policy, so spec 3 can move files without touching any
  policy again.
- A shell-command edit to the manifest is refused at commit, or stops the run at the next step
  boundary.
- Drift stops name each path, and registration has an audited operator path.

### Negative
- The phase-marker format and the operator CLI both grow, so the release disposition must cover the
  new subcommand.
- Legacy branches stay beside the manifest branch in every policy until legacy specs age out.
- A drift stop needs an operator to register or restore the file before the run resumes.

### Follow-up Actions
- [ ] Spec 3 (#3405 layout and content) is unblocked when this spec ships.
