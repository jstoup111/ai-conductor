---
name: build-review-tautology
description: "Judge whether changed tests distinguish the changed production behavior from its merge-base form."
enforcement: gating
phase: build
---

## Purpose

Judge the Tautology concern for one engine-managed `build_review` rubric branch. This is a
judgement-only contract: the engine owns evidence assembly, preflight execution, result validation,
finding identity, dispositions, and the outer gate verdict.

## Input projection (v2)

Use only the supplied projection version `v2`. Its closed input contains:

- the lap ID, snapshot digest, and top-level `contentDigest`;
- the changed diff by reference (`changedFiles`: per-file path, change kind, and hunk line
  ranges, anchored by `mergeBase` and `headSha`) and changed-test selectors;
- diff-derived removal evidence (`removalContext`), never an exemption;
- engine-parsed verify-only task evidence (`verifyOnlyContext`: task ID, compact behavior description, and declared paths), never an exemption;
- the current code-valid `test_suite` PASS;
- the reverted-production manifest (`revertedProductionManifest`): per reverted production file,
  its path and merge-base git blob sha. File content is never embedded — recover any file's
  reverted (merge-base) form with `git show <mergeBase>:<path>`; and
- typed preflight evidence, including source identities, its result classification, and the
  scoped-run verdict (exit code, run kind, the selectors actually executed) with a bounded
  head+tail failure excerpt (explicit `[...truncated N bytes...]` marker) when the reverted-tree
  run failed. Raw runner output is never embedded wholesale.
- engine-recorded rebase-repair context, when a changed test repairs stale base-state expectations.

The session runs inside the feature worktree. The diff content is not embedded: read the
referenced files and obtain any per-path diff yourself with `git diff <mergeBase>..HEAD -- <path>`
(or `git show <mergeBase>:<path>` for the pre-change form). Those reads are part of this closed
input. Do not infer facts from a prior review, a maker transcript, task-status narrative, or any
state not present in this projection and its referenced content.

## Judgement

Assess whether every changed test meaningfully distinguishes its exercised production behavior.
Interpret the preflight classification precisely:

- `red` is expected evidence that the changed tests detect the reverted production behavior; it is
  not itself a finding.
- `stayed-green` requires a blocking finding for each independent changed-test/behavior obligation
  that remained insensitive to the reverted production behavior only when none of the four closed
  exceptions qualifies for that obligation.
- `approved-exception` is not a finding when the supplied exception covers the relevant selector.
- `infrastructure-failure` is not a finding. Do not invent evidence, downgrade it to a pass, or
  convert it into content criticism.

The only exceptions are rebase repair, removal maintenance, fixture relocation, and verify-only
maintenance. Apply their diff-derived criteria exactly as supplied by the projection; a selector
outside those criteria is measured normally. A fixture relocation requires both the test-path move
and a production path handling/classification change that makes the former path lose its prior
meaning; a move alone is not an exception. Evaluate verify-only maintenance per changed test, never
per diff: it qualifies only when (1) `verifyOnlyContext` lists a verify-only task; (2) the changed
test's lines reference that task's plan-declared files or the behavior the task verifies; and (3)
the change adds no assertion about behavior this diff introduces. A non-qualifying
pre-diff-passing test, including an unanchored test, is measured normally.

For every changed test evaluated under the fixture-relocation exception, return exactly one
audit-only `relocationAudit` entry on PASS or FAIL:
`[relocation-audit] (EXEMPTED|MEASURED): old path → new path; production hunk(s) (do|do not) force the move`.
`EXEMPTED` proves the complete exception qualified; `MEASURED` proves it did not and the test was
judged normally. This is not a finding: it must name both paths and whether production forces the
move, which distinguishes relocation from deletion or masking. Unevaluated tests and non-Tautology
results must not manufacture relocation-audit evidence.

## Result contract (v1)

Return exactly one JSON `judged` result for rubric `tautology`: its top-level `kind` field is
exactly the string `judged` (never `result` or any other field name), carrying contract version `v1`.
It echoes the projection's `lapId` and `snapshotDigest` verbatim, and it has a `findings` array.
Return every independent finding; an empty array means no Tautology concern was found. Each finding
contains:

- an enumerated concern kind in a `concernKind` field (never `kind`);
- typed logical anchors for the changed test, exercised behavior/assertion, and violation kind,
  carried in a nested `anchor` object — `{"rubric": "tautology", "changedTest": "<string>",
  "exercisedBehavior": "<string>", "violationKind": "<string>"}` — with plain string values, never
  flattened to the finding's top level and never renamed (no `anchors`, no per-field objects);
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
