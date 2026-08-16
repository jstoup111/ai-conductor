---
name: build-review-completeness
description: "Judge whether the full implementation diff delivers the approved plan's outcomes."
enforcement: gating
phase: build
---

## Purpose

Judge the Completeness concern for one engine-managed `build_review` rubric branch. This is a
judgement-only contract: the engine owns evidence assembly, result validation, finding identity,
dispositions, configuration, and the outer gate verdict.

Completeness is default-enabled. The engine owns explicit disablement and reports any resulting
coverage state; this skill judges only when the engine dispatches it.

## Input projection (v2)

Use only the supplied projection version `v2`. Its closed input contains:

- the lap ID, snapshot digest, and top-level `contentDigest`;
- the full changed diff by reference (`changedFiles`: per-file path, change kind, and hunk line
  ranges, anchored by `mergeBase` and `headSha`);
- diff-derived removal evidence (`removalContext`), never an exemption; and
- engine-parsed verify-only evidence (`verifyOnlyContext`): only a plan task listed here
  legitimately contributes no implementation diff; and
- the approved plan.

The session runs inside the feature worktree. The diff content is not embedded: read the
referenced files and obtain any per-path diff yourself with `git diff <mergeBase>..HEAD -- <path>`
(or `git show <mergeBase>:<path>` for the pre-change form). Those reads are part of this closed
input. Do not infer delivery from a maker transcript, task-status narrative, prior review, or any
state not present in this projection and its referenced content.

## Judgement

Read the approved plan and full changed diff as a whole. Judge holistically whether the diff,
taken together, delivers every approved plan outcome. A plan task may help locate an outcome, but
do not reduce the judgement to individual commits or task records.

Identify each missing deliverable that prevents a plan outcome from being delivered. Keep unrelated
gaps separate so the result preserves every independently actionable omission.

## Result contract (v1)

Return exactly one JSON `judged` result for rubric `completeness`: its top-level `kind` field is
exactly the string `judged` (never `result` or any other field name), carrying contract version `v1`.
It echoes the projection's `lapId` and `snapshotDigest` verbatim, and it has a `findings`
array. Return every independent finding; an empty array means no Completeness concern was found.
Each finding contains:

- an enumerated concern kind in a `concernKind` field (never `kind`);
- typed logical anchors for the approved plan outcome/task and missing deliverable, carried in a
  nested `anchor` object — `{"rubric": "completeness", "planTask": "<string>", "missingOutcome":
  "<string>"}` — with plain string values, never flattened to the finding's top level and never
  renamed (no `planAnchor`/`deliverableAnchor`);
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
