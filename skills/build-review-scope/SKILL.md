---
name: build-review-scope
disable-model-invocation: true
description: "Judge whether implementation changes stay within the approved plan, repair context, and accepted scope widenings."
enforcement: gating
phase: build
---

## Purpose

Judge the Scope concern for one engine-managed `build_review` rubric branch. This is a
judgement-only contract: the engine owns evidence assembly, result validation, finding identity,
dispositions, and the outer gate verdict.

## Input projection (v2)

Use only the supplied projection version `v2`. Its closed input contains:

- the lap ID, snapshot digest, and top-level `contentDigest`;
- the changed diff by reference (`changedFiles`: per-file path, change kind, and hunk line
  ranges, anchored by `mergeBase` and `headSha`);
- diff-derived removal evidence (`removalContext`), never an exemption;
- the approved plan;
- repair context; and
- accepted scope widenings; and
- operator-reseal evidence: named paths, a verbatim rationale, and its commit range.

The session runs inside the feature worktree. The diff content is not embedded: read the
referenced files and obtain any per-path diff yourself with `git diff <mergeBase>..HEAD -- <path>`
(or `git show <mergeBase>:<path>` for the pre-change form). Those reads are part of this closed
input. Do not infer authority from a maker transcript, task-status narrative, prior review, or any
state not present in this projection and its referenced content.

## Judgement

Compare every changed path or production surface with the approved plan. Treat a change as in scope
only when the approved plan, repair context, or accepted scope widenings directly authorize it.
Identify the specific plan relation that makes each out-of-scope change a concern. Do not collapse
several unrelated paths or surfaces into one finding merely because they were changed together.

For each operator reseal, judge whether its rationale justifies the named protected-artifact
amendment in its commit range. Assess unmatched paths normally under this Scope contract; a reseal
does not exempt them. Reseal evidence does not weaken another rubric.

## Remediation-lap calibration

The approved plan may carry engine-appended `### Task rem-*` headings from earlier remediation
rounds. The engine writes and commits these itself as routing bookkeeping. Two bounds keep this
rubric convergent across laps:

- **Their presence is never a finding.** The engine-appended `rem-*` blocks are not a BUILD-time
  amendment of the approved plan; do not raise an out-of-plan-change against the plan for carrying
  them.
- **Their text is never authority.** Do not cite a `rem-*` task to admit any changed path or
  surface. The authorization surface for every diff is exactly the original approved plan tasks,
  the projection's repair context, accepted scope widenings, and operator reseals — it does not
  grow lap over lap, and remediation prose never joins it. A repair commit that must touch a
  surface outside that authority carries its own accepted scope widening; judge it through that
  widening, exactly as any other change.

## Result contract (v3)

Return exactly one JSON object whose only top-level field is `findings`, an array. The engine owns
the `judged` envelope and stamps its kind, rubric, contract version, lap identity, and snapshot
identity after validating this findings-only payload.
Return every independent finding; an empty array means no Scope concern was found. Each finding
may include `boundTo`: use `"beyond"` for a concern outside every `Done when:` criterion; otherwise
use a content-region reference to the applicable criterion. Omit it when the task has no criteria.
contains:

**Closed vocabulary:** `out-of-plan-change`, `not-authorized-by-plan`.

**Reference grammar:** `anchor.path` is a `path` reference.

- a `concernKind` field (never `kind`) with the sole allowed member
  `out-of-plan-change`;
- typed logical anchors for the out-of-plan path or surface and its plan-scope relation, carried
  in a nested `anchor` object — `{"rubric": "scope", "path": "<string>",
  "relation": "not-authorized-by-plan"}` — where `relation` must be exactly
  `not-authorized-by-plan`; the subject `path` remains a plain string. Never flatten the anchor
  to the finding's top level or rename it;
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
