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

## Remediation-lap calibration

The stated defect/outcome this rubric judges against comes from the approved plan and the
projection — never from remediation prose. Engine-appended `### Task rem-*` blocks in the plan are
routing bookkeeping: their text does not restate, replace, or add a stated defect, and citing one
never certifies a mechanism as the root cause. Judge a remediation repair exactly as any other
change — does the implementation address the originally stated defect rather than its symptom. The
set of stated defects does not grow lap over lap.

## Result contract (v3)

Return exactly one JSON object whose only top-level field is `findings`, an array. The engine owns
the `judged` envelope and stamps its kind, rubric, contract version, lap identity, and snapshot
identity after validating this findings-only payload.
Return every independent finding; an empty array means a PASS for this rubric. Each finding contains:

**Closed vocabulary:** `root-cause-unaddressed`, `symptom-only-fix`,
`provenance-sensitive-cache-identity`.

**Reference grammar:** `anchor.locus` is a `content-region` reference.

- a `concernKind` field (never `kind`) with one of: `root-cause-unaddressed`,
  `symptom-only-fix`, or `provenance-sensitive-cache-identity`;
- typed logical anchors for the stated defect/outcome and implementation mechanism or locus judged
  symptomatic, carried in a nested `anchor` object — `{"rubric": "rootCause", "statedDefect":
  "<string>", "locus": {"path": "<repository-relative path>",
  "contentHash": "sha256:<normalized-hunk-content>", "display": "<human-readable non-coordinate label>"}, "relation": "<member>"}` — where `relation` must be one
  of `root-cause-unaddressed`, `symptom-only-fix`, or `provenance-sensitive-cache-identity`, and
  must match `concernKind` after canonical normalization.
  `locus` is a content-region reference from the immutable projection; `statedDefect` remains report prose. When the same
  normalized hunk content appears more than once in one path, add `"occurrence": <0-based ordinal
  in projection order>` to the region (omit it for the first or only occurrence) — never a line
  number or any other coordinate. Never flatten the anchor to the finding's top level or
  rename it;
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
