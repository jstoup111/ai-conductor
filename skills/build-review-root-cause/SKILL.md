---
name: build-review-root-cause
description: "Judge whether the implementation addresses the stated defect rather than only its symptom."
enforcement: gating
phase: build
---

## Purpose

Judge the Root Cause concern for one engine-managed `build_review` rubric branch. This is a
judgement-only contract: the engine owns evidence assembly, result validation, finding identity,
dispositions, and the outer gate verdict.

## Input projection (v2)

Use only the supplied projection version `v2`. Its closed input contains:

- the lap ID, snapshot digest, and top-level `contentDigest`;
- the changed diff by reference (`changedFiles`: per-file path, change kind, and hunk line
  ranges, anchored by `mergeBase` and `headSha`);
- diff-derived removal evidence (`removalContext`), never an exemption;
- the approved plan, including the stated defect/outcome; and
- repair context.

The session runs inside the feature worktree. The diff content is not embedded: read the
referenced files and obtain any per-path diff yourself with `git diff <mergeBase>..HEAD -- <path>`
(or `git show <mergeBase>:<path>` for the pre-change form). Those reads are part of this closed
input. Do not infer a different problem statement from a maker transcript, task-status narrative,
prior review, or any state not present in this projection and its referenced content.

## Judgement

Compare the stated defect/outcome with the implementation's mechanism. A symptom-only change is a
concern when it masks an observed effect without addressing the mechanism or locus that the supplied
evidence identifies as responsible for the defect. Assess each independent defect and implementation
relation separately; do not merge distinct mechanisms into one finding.

## Result contract (v1)

Return exactly one JSON `judged` result for rubric `rootCause`: its top-level `kind` field is
exactly the string `judged` (never `result` or any other field name), carrying contract version `v1`.
It echoes the projection's `lapId` and `snapshotDigest` verbatim, and it has a `findings` array.
Return every independent finding; an empty array means a PASS for this rubric. Each finding contains:

- an enumerated concern kind in a `concernKind` field (never `kind`);
- typed logical anchors for the stated defect/outcome and implementation mechanism or locus judged
  symptomatic, carried in a nested `anchor` object — `{"rubric": "rootCause", "statedDefect":
  "<string>", "locus": "<string>", "relation": "<string>"}` — with plain string values, never
  flattened to the finding's top level and never renamed;
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
