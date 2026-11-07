# Conflict Check: per-feature artifact manifest and one lookup (#3405, spec 1 of 3)

**Date:** 2026-10-25
**New stories:** `.docs/stories/decide-artifacts-are-too-repetitive-for-people-to-.md` (Stories 1–4)
**Result:** PASS. 1 blocking conflict resolved; 2 degrading conflicts accepted by the operator.

The resolutions below were approved by the operator on 2026-10-25. They removed operator-reseal
registration and the build_review drift halt from this spec (both now spec 2), and limited the
manifest lookup to feature-scoped reads.

## Conflict: Reseal cannot register a file an amendment adds

**Stories involved:** Story 4 (draft: operator reseal registers an added file) vs ADR: operator-only scoped artifact reseal; #1281 Stories 2–3
**Files:** [.docs/stories/decide-artifacts-are-too-repetitive-for-people-to-.md] vs [.docs/decisions/adr-2026-08-09-operator-only-scoped-artifact-reseal.md], [.docs/stories/no-operator-command-to-reseal-a-protected-decide-a.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-09-operator-only-scoped-artifact-reseal
**Story ID:** Story 4 (draft)
**ADR opposing sentence (verbatim):** "The scoped head must not add or remove entries. Naming a path absent from the seal is refused — adding a protected artifact is a different operation with a different threat model."
**Story opposing sentence (verbatim):** "Given feature `f` with a manifest and an operator commit adding `.docs/specs/f.md`, when `ai-conductor reseal --slug f --path .docs/specs/f.md` runs, then the manifest lists it as `prd`, the manifest change is committed, and one `feature_artifacts_registered` event names it."

**Description:** A newly added file is never in the seal, so reseal refuses it before it reaches
registration (`protected-artifact-seal.ts`, "Protected artifact reseal target is not sealed"). The
draft build_review drift story then halted on the same unlisted file, leaving hand-editing the
manifest as the only way out.

**Resolution Options:**
1. Drop reseal registration and the build_review drift halt; land is the only writer; drift checks, manifest protection and post-land registration move to spec 2.
2. Add a separate operator command that registers an added file.
3. Supersede adr-2026-08-09 D1 so reseal may add entries.

**Recommendation and decision:** Option 1. Spec 2 already owns the seal, hooks and build_review
scope, which is where adding a file has to be judged. Stories 4 and 5 were removed; ADR decisions
6 and 7 were revised.

## Conflict: Manifest filtering breaks repository-scoped reads and DECIDE entry

**Stories involved:** Story 2 vs ADRs: feature-aware artifact resolution D2; fail-closed DECIDE entry D1
**Files:** [.docs/stories/decide-artifacts-are-too-repetitive-for-people-to-.md] vs [.docs/decisions/adr-2026-07-28-feature-aware-artifact-resolution.md], [.docs/decisions/adr-2026-08-03-fail-closed-decide-entry.md]
**Type:** contradiction
**Severity:** degrading (resolved)
**ADR filename stem:** adr-2026-07-28-feature-aware-artifact-resolution
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "`repository`: the declared corpus intentionally applies to the checkout as a whole; feature filtering is not applied."
**Story opposing sentence (verbatim, superseded draft):** "Given feature `f` with a manifest listing two `decision` entries, when `f`'s decisions are resolved, then both paths are returned."

**Description:** ADR and architecture patterns are repository-scoped. An authoritative manifest
would filter them to one feature's files, and DECIDE-entry checks for `architecture_review`,
`architecture_diagram` and `plan_review` could then halt daemon builds.

**Resolution Options:**
1. Apply the manifest rung only to feature-scoped patterns; keep repository- and run-scoped reads unchanged.
2. Amend D2 so manifest entries scope those corpora.

**Recommendation and decision:** Option 1. Story 2 now asserts that those steps resolve the same
files with and without a manifest. ADR decision 5 and the amendment note on adr-2026-07-28 D3 state
the feature-scoped limit.

## Other conflicts resolved in the stories and ADR

| Conflict | Party | Resolution |
|---|---|---|
| build_review drift halt preempts the seal's scope judgement of plan-justified additions | adr-2026-07-27-protected-artifact-seal-self-amendment-visibility D3, adr-2026-08-12-operator-reseal-as-second-scope-justification | Drift halt removed from spec 1; spec 2 owns it. |
| Discovery could build a plan at a non-legacy path that the seal does not protect | adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts D3 | Criterion removed; no spec-1 writer produces such paths. |
| A leftover manifest could resurrect an abandoned spec | #1574 Story 3 | Story 4: a manifest whose listed plan is absent is not a candidate. |
| Plan `**Stories:**` line and manifest `stories` entry could disagree | annotated-stories-line stories | Story 2: with a manifest, the `stories` entry wins. |
| A shipped or parked slug with a malformed manifest could be reported as blocked | adr-2026-08-05-blocked-classification-after-dedup D1–D2 | Story 4: shipped, processed and parked checks run before parsing. |
| Discovery coherence check hard-codes `.docs/coherence/<slug>.md` | adr-2026-07-26-daemon-decide-preseed-ownership D3; #1881 Story 2 | Amendment note on D3: manifest-backed specs use the manifest's `coherence` entry. |
| Completion, review and dashboard must share one resolution | step-completion-globs (TS-993) | No conflict: all three use `resolveArtifactFiles`, which carries the manifest rung. |
| New ADR claimed the docs write guard stops BUILD writing the manifest | adr-2026-07-22-phase-scoped-docs-write-guard D4, D6 | Claim corrected: the guard covers Edit, Write and NotebookEdit, not Bash; spec 2 seals the manifest. |

## Accepted degrading conflicts

**docs-prune leaves stale manifests.** `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts`
D1 and D4, and #2963 Stories 1–2: the prune family list does not include `.docs/<slug>/`, and a prune
commit may touch only selected prunable paths, so a pruned feature's manifest stays on the default
branch listing deleted files. Accepted: discovery skips shipped slugs before parsing, post-prune audits
read the parent commit where the manifest and files agree, and spec 2 moves retention onto the
manifest.

**adr-2026-10-10 D7 says plan-review records are committed.**
`adr-2026-10-10-source-grounded-adversarial-plan-review-step` D7: "The review artifact is committed
state, and a model-free land rung enforces it." The code has excluded plan-review records from land
since #3239, and Story 3 follows the code. That ADR's stale text predates this spec, so it is out of
scope here.

## Re-check

After the resolutions, Stories 1–4 were rechecked against each other and against every party above,
in both directions. No blocking conflict remains, and no oscillating pair was found. Story 2's
"listed path missing" result and Story 4's silent non-candidate for a missing plan do not conflict:
the lookup returns a result naming the missing path, and discovery decides not to emit it.

## Inventory

**Story files examined:** decide-artifacts-are-too-repetitive-for-people-to- (new),
2026-07-22-idea-scoped-land-artifact-resolution, 2026-07-03-intake-marker-plan-stem-keying,
shipped-features-decide-artifacts-accumulate-in-do, no-operator-command-to-reseal-a-protected-decide-a,
protected-artifact-halt-prints-no-recovery-command, an-operator-s-protected-artifact-reseal-is-invisib,
post-plan-decide-amendments-never-reconcile-with-t, 2026-07-27-protected-artifact-seal-self-amendment-1047,
base-inherited-artifact-deletion-deadlocks-both-se, multi-child-feature-cannot-resume-after-an-operato,
abandoned-specs-are-kept-in-git-instead-of-the-iss, coherence-artifact-passes-engineer-land-then-block,
annotated-stories-line-makes-a-merged-spec-silentl, content-aware-shipped-work-dedup-never-re-dispatch,
batch-git-blob-reads-in-backlog-discovery-and-prot, step-completion-globs-are-feature-unscoped-so-anot,
plans-cannot-declare-ordered-slices-of-one-feature, sliced-plans-can-be-landed-whose-stories-span-chil,
conflict-artifact-stem-is-validated-only-at-build-, reject-non-date-named-adrs-at-spec-land,
summarize-the-decide-artifacts-in-the-spec-land-co, fail-closed-when-build-review-cannot-resolve-which,
block-edits-to-docs-spec-artifacts-during-build-an, engineer-worktree-isolation,
accepted-stories-are-never-checked-against-the-eng, decide-artifact-coherence-check. Screened by
search (no relevant hits): accept-trailing-tables-in-a-coherence-artifact,
daemon-autonomous-runs-must-fail-closed-on-any-amb, build-review-grades-plan-vs-diff-against-a-stale-o,
2026-07-26-daemon-decide-phase-coherence-ownership-971, durable-shipped-record-enforcement-and-backfill-916-936,
spec-authoring-is-blind-to-unmerged-dependent-work, and the remaining files matching "seal",
"discover", "backlog", "blocked", "prune" and "stacked".

**ADRs examined (narrowed in):** adr-2026-07-28-feature-aware-artifact-resolution,
adr-2026-07-22-phase-scoped-docs-write-guard, adr-2026-07-26-protected-artifact-seal-rebaseline,
adr-2026-07-27-protected-artifact-seal-self-amendment-visibility,
adr-2026-08-05-provenance-based-protected-artifact-inheritance,
adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts,
adr-2026-08-09-operator-only-scoped-artifact-reseal, adr-2026-08-09-reseal-audit-rides-the-existing-event-spine,
adr-2026-08-09-seal-rotation-authorship-predicate, adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator,
adr-2026-08-12-operator-reseal-as-second-scope-justification,
adr-2026-10-07-prune-base-inherited-deletions-from-the-seal,
adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts, adr-2026-08-03-fail-closed-decide-entry,
adr-2026-07-27-daemon-decide-kickback-halt, adr-2026-07-26-daemon-decide-preseed-ownership,
adr-2026-08-05-blocked-classification-after-dedup, adr-2026-08-05-blocked-is-a-distinct-state-from-halted,
adr-2026-08-26-shared-coherence-parser-at-discovery, adr-2026-07-03-dependency-gate-backlog-waiting-channel,
adr-2026-07-03-owner-gate-gated-channel, adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition,
adr-2026-07-22-coherence-gate-placement-and-validation-split, adr-2026-07-22-coherence-waiver-and-duplicate-claim,
adr-2026-08-09-adr-layer-gated-by-committed-adr-signal, adr-2026-08-23-criterion-layer-is-structural-at-land,
adr-2026-08-24-evidentiary-defects-are-not-waivable, adr-2026-07-03-engineer-checkpoint-commits-idempotent-land,
adr-2026-06-29-track-marker-location, adr-2026-10-03-per-feature-step-applicability,
adr-2026-10-10-source-grounded-adversarial-plan-review-step,
adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts, adr-2026-08-23-committed-halt-record,
adr-2026-07-28-total-halt-classification-legacy-boundary, adr-2026-09-20-halt-resolution-queue-derived-from-markers,
adr-2026-07-25-fail-closed-durable-shipment-evidence, adr-2026-07-06-daemon-false-ship-guard,
adr-2026-07-22-per-feature-cost-rollup-in-shipped-record, adr-2026-10-03-stacked-child-plans-identity-and-state,
adr-2026-10-07-per-child-build-region, adr-2026-09-29-plan-slice-manifest,
adr-2026-10-23-slice-topology-from-sealed-plan, adr-2026-10-10-stacked-restack-journaled-replay,
adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-08-11-halt-events-ride-the-persisted-spine,
adr-2026-07-23-build-review-fresh-base-disposition, adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane,
adr-2026-07-21-owner-stamped-at-authoring, adr-2026-06-30-owner-provenance-recording,
adr-2026-07-21-intake-only-enforcement.

**Excluded as fully superseded:** adr-2026-07-03-gated-writeback-announcements,
adr-2026-07-21-completeness-as-build-review-rubric, adr-2026-08-12-removal-anchored-tautology-exemption,
adr-2026-08-15-verify-only-anchored-tautology-exemption,
adr-2026-08-16-preservation-anchored-completeness-exemption, adr-2026-07-30-finish-only-mergeability-gate,
adr-2026-08-29-build-review-remediate-case-adjudication,
adr-2026-08-29-operator-authorized-kickback-budget-recovery.

**Narrowed out (approximate counts, no artifact-path subject):** provider, model, auth and cost (~45);
build_review rubric content and dispositions (~30); task evidence, stamping and trailers (~25);
rebase and restack (~15); finish and publication (~25); daemon process lifecycle (~25); park markers
(~10); intake queue, ledger and trackers (~25); release and migration gates (~20); memory subsystem
(~10); self-host containment (~15); engineer and composer infrastructure (~20); kickback budgets and
retry control (~20); remediation, as-built and prd_audit gates (~20); observability and roadmap
(~10); ADR and story format (~6). The partially superseded wiring-check-gate and
content-addressed-full-suite-proof ADRs stayed in the inventory and were narrowed out here.
