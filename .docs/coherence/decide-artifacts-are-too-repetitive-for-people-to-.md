# Coherence: Per-feature artifact manifest and one artifact lookup (#3405, spec 1 of 3)

**Plan:** .docs/plans/decide-artifacts-are-too-repetitive-for-people-to-.md
**Stories:** .docs/stories/decide-artifacts-are-too-repetitive-for-people-to-.md
**Track:** technical, so there are no FR rows. **Tier:** L.
**Source-Ref:** jstoup111/ai-conductor#3405

This is spec 1 of a three-spec delivery (`adr-2026-10-24-per-feature-artifact-manifest` decision 10).
Outcomes that only the later layout and content spec (spec 3) can deliver are waived here, and each
waiver names that spec as its home.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 |  | gap | A reviewer can read one Medium spec PR and find each acceptance criterion stated in full in one place. — outcome-1: delivered by spec 3 (layout and content); waived in `.docs/coherence-waivers/decide-artifacts-are-too-repetitive-for-people-to-.md`. |
| outcome | outcome-2 |  | gap | The artifacts a reviewer must read for a Medium or Large spec are materially shorter than today's on the same spec. For example, #3278's plan plus coherence (64,090 characters) would shrink. — outcome-2: delivered by spec 3 (layout and content); waived in `.docs/coherence-waivers/decide-artifacts-are-too-repetitive-for-people-to-.md`. |
| outcome | outcome-3 |  | gap | The land-time coherence gate still refuses a spec whose criteria are not mapped to a task's `Done when` check, and still names each unmapped criterion. — outcome-3: spec 1 leaves the land coherence gate unrouted and unchanged (ADR decision 5); the outcome is at risk only when spec 3 references criteria by id; waived in `.docs/coherence-waivers/decide-artifacts-are-too-repetitive-for-people-to-.md`. |
| outcome | outcome-4 | story-2, story-3 | covered | Every gate that reads these artifacts today (land coherence gate, plan review, prd_audit, coverage judgement) still receives everything it needs to rule as it does now. |
| story | story-1 | task-1, task-2, task-3 | covered | The manifest has one strict, deterministic format |
| story | story-2 | task-7, task-8, task-9, task-10, task-11, task-12, task-13, task-14 | covered | Readers resolve a feature's artifacts through its manifest |
| story | story-3 | task-4, task-5, task-6 | covered | Composer land writes the manifest |
| story | story-4 | task-15, task-16, task-17 | covered | Daemon discovery finds and reads specs through manifests |
| task | task-1 | story-1 | covered | Serves story 1. |
| task | task-2 | story-1 | covered | Serves story 1. |
| task | task-3 | story-1 | covered | Serves story 1. |
| task | task-4 | story-3 | covered | Serves story 3. |
| task | task-5 | story-3 | covered | Serves story 3. |
| task | task-6 | story-3 | covered | Serves story 3. |
| task | task-7 | story-2 | covered | Serves story 2. |
| task | task-8 | story-2 | covered | Serves story 2 (infrastructure: the kind table the lookup reads). |
| task | task-9 | story-2 | covered | Serves story 2. |
| task | task-10 | story-2 | covered | Serves story 2. |
| task | task-11 | story-2 | covered | Serves story 2. |
| task | task-12 | story-2 | covered | Serves story 2. |
| task | task-13 | story-2 | covered | Serves story 2. |
| task | task-14 | story-2 | covered | Serves story 2. |
| task | task-15 | story-4 | covered | Serves story 4. |
| task | task-16 | story-4 | covered | Serves story 4. |
| task | task-17 | story-4 | covered | Serves story 4. |
| adr | adr-2026-10-24-per-feature-artifact-manifest | story-1, story-2, story-3, story-4 | covered | Decision-by-decision plan mapping in the plan's Architecture Obligation Coverage; judged under §4f. D7 and D10 are no-change: drift checks and the later specs are out of this spec. |
| adr | adr-2026-07-28-feature-aware-artifact-resolution | story-2 | covered | The D3 amendment (manifest rung before the ladder) is implemented by task-7 and task-9; D1 contracts unchanged (task-8 snapshot); D2, D4 and D5 parity by task-9; judged under §4f. |
| adr | adr-2026-07-26-daemon-decide-preseed-ownership | story-4 | covered | The D3 amendment (manifest `coherence` entry) is implemented by task-17; D1, D2 and D5 are existing behavior and D4 is unchanged; judged under §4f. |
| criterion | Story 1 happy: Given `.docs/f/manifest.json` with `schemaVersion` 1, `slug` `f`, one `plan` entry and entries of other in-scope kinds whose paths are under `.docs/`, when it is parsed, then every entry is returned with its kind and path. | 1 | covered | "returns `kind: 'parsed'` with every entry's kind and path" | diff-local |
| criterion | Story 1 happy: Given the same set of entries supplied in two different orders, when each is rendered, then both renderings are byte-identical and list entries sorted by kind, then by path. | 2 | covered | "given the same entries in two different orders returns byte-identical strings whose entries are sorted by kind, then by path" | diff-local |
| criterion | Story 1 happy: Given a manifest with two `decision` entries under `.docs/decisions/`, when it is parsed, then both entries are returned. | 1 | covered | "A manifest with two `decision` entries in the ADR folder parses with both entries returned" | diff-local |
| criterion | Story 1 negative: Given a manifest with `schemaVersion` 2, when it is parsed, then parsing fails naming the unsupported schema version. | 3 | covered | "returns `malformed` with a reason naming the unsupported schema version for `schemaVersion` 2" | diff-local |
| criterion | Story 1 negative: Given a manifest entry with kind `notes`, when it is parsed, then parsing fails naming the unknown kind `notes`. | 3 | covered | "naming the unknown kind `notes` for an entry of kind `notes`" | diff-local |
| criterion | Story 1 negative: Given a manifest with a top-level `updatedAt` field, or an entry with a field other than `kind` and `path`, when it is parsed, then parsing fails naming the unknown field. | 3 | covered | "It returns `malformed` naming the unknown field for a top-level `updatedAt` and for an entry field other than `kind` and `path`" | diff-local |
| criterion | Story 1 negative: Given a manifest entry whose path is `src/x.md` or `.docs/../x.md`, when it is parsed, then parsing fails naming the path as outside `.docs/`. | 3 | covered | "It returns `malformed` naming the path as outside `.docs/` for `src/x.md` and for `.docs/../x.md`" | diff-local |
| criterion | Story 1 negative: Given a `decision` entry whose path is `.docs/plans/x.md`, when it is parsed, then parsing fails naming the path as outside `.docs/decisions/`. | 3 | covered | "naming the path as outside the ADR folder for a `decision` entry pointing at the legacy plan file of `x`" | diff-local |
| criterion | Story 1 negative: Given `.docs/f/manifest.json` whose `slug` is `g`, when it is parsed, then parsing fails naming both `f` and `g`. | 3 | covered | "It returns `malformed` naming both `f` and `g` for `.docs/f/manifest.json` whose `slug` is `g`" | diff-local |
| criterion | Story 1 negative: Given a manifest with no `plan` entry, or with two, when it is parsed, then parsing fails naming the plan entry count. | 3 | covered | "naming the plan entry count for zero and for two `plan` entries" | diff-local |
| criterion | Story 1 negative: Given a manifest file that is not valid JSON, when it is parsed, then parsing fails naming the manifest path. | 3 | covered | "It returns `malformed` whose reason names the manifest path for text that is not valid JSON" | diff-local |
| criterion | Story 2 happy: Given feature `f` with a manifest listing `stories` at `.docs/stories/f.md`, when a reader resolves `f`'s stories, then it returns `.docs/stories/f.md`. | 7 | covered | "With a manifest listing `stories` at the legacy stories file of `f`, `resolveFeatureArtifact` returns `origin: 'manifest'` with exactly that path" | diff-local |
| criterion | Story 2 happy: Given feature `f` with a manifest listing `stories` at `.docs/f/2-stories.md` and a legacy `.docs/stories/f.md` also present, when a reader resolves `f`'s stories, then it returns `.docs/f/2-stories.md`. | 7 | covered | "with `stories` at `.docs/f/2-stories.md` and the legacy stories file also present, it returns `[.docs/f/2-stories.md]` and the `legacy` callback is never invoked" | diff-local |
| criterion | Story 2 happy: Given feature `f` with no manifest, when each routed reader resolves each feature-scoped kind, then it returns the same file or files it returned before this change. | 9, 10, 11, 12, 13, 14 | covered | "With no manifest, and with a manifest listing the legacy paths, `checkStepCompletion` and `getArtifactStatus` for prd, stories, conflict_check, plan and coherence_check each resolve the same files as before this change (fixed as the test's expected values)" | diff-local |
| criterion | Story 2 happy: Given feature `f` with a manifest whose entries point at the same paths legacy resolution finds, when each routed reader resolves each feature-scoped kind, then it returns the same file or files as with no manifest. | 9, 10, 11, 12, 13, 14 | covered | "a fixture whose manifest lists the legacy paths yields the same (track, intake Source-Ref, applicability, tier, coherence rows, plan text)" | diff-local |
| criterion | Story 2 happy: Given feature `f` with a manifest listing `stories` at `.docs/stories/f.md` and a plan whose `**Stories:**` line names `.docs/stories/other.md`, when a reader resolves `f`'s stories, then it returns `.docs/stories/f.md`. | 10 | covered | "`resolveFeatureStoriesRef` and `resolveFeatureStoriesPath` return the stories file of `f`" | diff-local |
| criterion | Story 2 happy: Given feature `f` with a manifest listing one `decision` and one `architecture` entry, when the `architecture_review` or `architecture_diagram` step resolves its artifacts for `f`, then it returns the same files it returns with no manifest. | 9 | covered | "`checkStepCompletion` for `architecture_review` and `architecture_diagram` resolves the same files it resolves with no manifest, including the architecture-review record and the whole ADR and architecture corpora" | diff-local |
| criterion | Story 2 happy: Given feature `f` with a manifest and a plan-review record in the worktree, when the `plan_review` step resolves its artifacts for `f`, then it returns the same record it returns with no manifest. | 9 | covered | "`checkStepCompletion` for `plan_review` resolves the same record it resolves with no manifest" | diff-local |
| criterion | Story 2 negative: Given feature `f` with a manifest that lists no `prd` entry and a file `.docs/specs/f.md` present, when a reader resolves `f`'s PRD, then it returns no file. | 7, 10 | covered | "With a manifest listing no `prd` entry and the legacy PRD file of `f` present, resolving `prd` returns no paths and never invokes `legacy`" | diff-local |
| criterion | Story 2 negative: Given feature `f` with a manifest that fails to parse and legacy files present, when a reader resolves any feature-scoped kind for `f`, then it fails naming the manifest path and the parse failure, and returns no legacy file. | 7 | covered | "it throws `MalformedFeatureManifestError` whose message names `.docs/f/manifest.json` and the parse failure, and `legacy` is never invoked" | diff-local |
| criterion | Story 2 negative: Given features `a` and `b` each with a manifest, when a reader resolves `a`'s plan, then it returns `a`'s listed plan and never `b`'s. | 7 | covered | "With manifests for `a` and `b`, resolving `a`'s plan returns only `a`'s listed plan" | diff-local |
| criterion | Story 2 negative: Given feature `f` with a manifest listing `coherence` at a path absent from the tree, when a reader resolves `f`'s coherence, then its result names that listed path as missing and it does not fall back to legacy resolution. | 7 | covered | "a listed `coherence` path absent from the tree yields `missing` naming that path, with no `legacy` call, for each of the three source adapters" | diff-local |
| criterion | Story 3 happy: Given a composer worktree whose authored `.docs` change set holds the plan, stories, track, complexity, conflicts, coherence, the feature architecture document and one amended ADR, when land runs, then the land commit contains `.docs/<slug>/manifest.json` listing each file under its kind and the ADR as a `decision` entry. | 5 | covered | "makes a commit containing `.docs/<slug>/manifest.json` listing each file under its kind and the ADR as `decision`" | diff-local |
| criterion | Story 3 happy: Given land writes the intake marker for an intake idea, when land completes, then the manifest lists the marker as `intake`. | 5 | covered | "When `landSpec` writes the intake marker, the committed manifest lists that marker as `intake`" | diff-local |
| criterion | Story 3 happy: Given a worktree landed once and unchanged since, when land runs again, then the manifest bytes are unchanged. | 5 | covered | "A second `landSpec` on the unchanged worktree leaves the manifest bytes unchanged, and its result reports no added entries" | diff-local |
| criterion | Story 3 happy: Given land adds entries to the manifest, when land completes, then one `feature_artifacts_registered` event is emitted naming the slug and each added kind and path. | 6 | covered | "appends exactly one `feature_artifacts_registered` line to `.pipeline/composer-events.jsonl`, naming the slug and each added kind and path" | diff-local |
| criterion | Story 3 happy: Given a plan-review record exists in the worktree, when land runs, then the manifest does not list it. | 5 | covered | "a plan-review record present in the worktree is not listed" | diff-local |
| criterion | Story 3 negative: Given an unchanged worktree landed a second time, when land completes, then no `feature_artifacts_registered` event is emitted. | 6 | covered | "A second `'land'` run on the unchanged worktree appends no `feature_artifacts_registered` line" | diff-local |
| criterion | Story 3 negative: Given the change set deletes an ADR, when land runs, then the manifest has no `decision` entry for it. | 5 | covered | "Re-running `landSpec` after an ADR deletion and after deleting the complexity file commits a manifest with no `decision` entry for that ADR and no complexity entry" | diff-local |
| criterion | Story 3 negative: Given a worktree landed once whose complexity file was then deleted, when land runs again, then the manifest no longer lists the complexity file. | 5 | covered | "Re-running `landSpec` after an ADR deletion and after deleting the complexity file commits a manifest with no `decision` entry for that ADR and no complexity entry" | diff-local |
| criterion | Story 3 negative: Given a manifest already in the worktree that lists a path missing from the tree, fails to parse, or names a different slug, when land runs, then land replaces it with a manifest built from the current change set. | 5 | covered | "A pre-existing worktree manifest that lists a missing path, fails to parse, or names a different slug is replaced by `landSpec` with the manifest built from the current change set, and land does not refuse" | diff-local |
| criterion | Story 4 happy: Given the default branch holds `.docs/f/manifest.json` listing the plan, stories, coherence, complexity, track and intake at today's paths, when discovery runs, then `f` is a candidate and each of those is read from its listed path. | 15 | covered | "`discoverBacklog` returns `f` as an eligible item whose `planPath` and `storiesPath` are the listed paths, and each of those artifacts is read from its listed path" | diff-local |
| criterion | Story 4 happy: Given the default branch holds both `.docs/f/manifest.json` and `.docs/plans/f.md`, when discovery runs, then `f` appears once. | 15 | covered | "`f` appears exactly once across eligible, blocked and gated items" | diff-local |
| criterion | Story 4 happy: Given the default branch holds no manifest, when discovery runs, then its candidates, blocked items and warnings are identical to before this change. | 15 | covered | "With no manifest on the default branch, the eligible, blocked and gated items and the logged warnings equal those of the same tree run through `discoverBacklog` before this change" | diff-local |
| criterion | Story 4 negative: Given the default branch holds a manifest for `f` that fails to parse, when discovery runs, then `f` is blocked with reason `malformed-manifest` and a remedy naming the manifest path, and every other candidate is processed. | 16 | covered | "An unparseable `.docs/f/manifest.json` makes `discoverBacklog` return a blocked item for `f` with reason `malformed-manifest` and a remedy naming `.docs/f/manifest.json`, while another valid candidate in the same tree is returned eligible" | diff-local |
| criterion | Story 4 negative: Given a manifest-backed tier M feature whose manifest lists no `coherence` entry, when discovery runs, then `f` is blocked as `missing-coherence`, as a legacy feature without a coherence file is today. | 17 | covered | "A manifest-backed tier M candidate whose manifest lists no `coherence` entry is blocked with reason `missing-coherence`" | diff-local |
| criterion | Story 4 negative: Given a shipped, processed or parked feature `f` whose manifest remains on the default branch and fails to parse, when discovery runs, then `f` is skipped as today and is not reported as `malformed-manifest`. | 16 | covered | "A shipped, a processed and a parked slug, each with an unparseable manifest, are skipped with no blocked item, and the manifest parse is never attempted for them" | diff-local |
| criterion | Story 4 negative: Given the default branch holds a manifest for `f` whose listed plan is absent from the tree, when discovery runs, then `f` is not a candidate and no blocked item or warning is reported for it. | 17 | covered | "A manifest whose listed plan is absent from the tree yields no eligible, blocked or gated item for that slug and no warning line" | diff-local |

## Judgement Record

- **Coverage (plan §7a).** A fresh subagent judged all 38 criteria against the cited `Done when`
  checks. Round 1 refused the no-manifest parity claim for several routed readers; round 2 refused
  the dashboard's `getArtifactStatus` parity. Both were fixed in tasks 9 and 11 to 14, and round 3
  passed all 38.
- **Achievability (§4g).** Every cited check names its mechanism (`parseFeatureManifest`,
  `renderFeatureManifest`, `buildFeatureManifest`, `landSpec`, `dispatchEngineer`,
  `resolveFeatureArtifact`, `checkStepCompletion`, `getArtifactStatus`, the feature resolvers and
  `discoverBacklog`). The closed blocked-reason set gains `malformed-manifest`, and the absent-plan
  case is represented as no item at all (criterion 38), so every required outcome is expressible.
- **ADR constraints.** Land and pre-land gates are not routed (ADR decision 5), so no criterion
  depends on a manifest-backed land gate. Repository-scope corpora and the review records are
  asserted unchanged (task 9).
- **Outcome 4** is covered for this spec because every routed reader is proven to return the same
  file with and without a manifest (story 2) and land's own gates keep reading the change set
  (story 3). Spec 3 must re-establish it when content changes.
