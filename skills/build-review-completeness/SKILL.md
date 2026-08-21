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
- diff-derived removal evidence (`removalContext`), which anchors exactly the preservation-
  maintenance exception and is never an exemption for any other Completeness concern; and
- engine-parsed preservation evidence (`preservationContext`), which names preserved behaviors
  declared for plan tasks; and
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

## Remediation-lap calibration

The approved plan may carry engine-appended `### Task rem-*` headings from earlier remediation
rounds. Judge them by the same standard as original tasks — delivered or not — under these bounds,
which exist because repeated laps must converge instead of regenerating scope from their own
repairs:

- **A rem-* task's outcome is its own text, completely.** Do not derive further implied outcomes
  from the diff surface a remediation round added. Test files, fixtures, and assertions introduced
  as a repair are deliverables to verify against their task's text — never a new contract whose
  own qualities generate additional findings.
- **Delivered means it distinguishes the behavior; style is not a gap.** Raise a finding against a
  remediation-authored test only when the deliverable is absent, asserts a different behavior than
  its task names, or cannot fail when the production change it covers is reverted to its merge-base
  form. A test that meets that bar through a structural check, a substring match, or a fixture is
  delivered; preferring an executable assertion, an AST scan, or a production-constructed subject
  is a style improvement and is not a missing deliverable.
- **Documentation lag from later laps consolidates.** When a later remediation round changed a
  design an earlier round documented, raise at most one finding per affected document, and only
  where the document affirmatively contradicts shipped behavior. Phrasing that merely predates the
  latest repair round is not a gap.

- **A rem-* task never enlarges the plan.** Its outcome is bounded by its own text, and it grants
  nothing elsewhere: no other task's outcome grows because a remediation round ran, so the delivery
  surface does not grow lap over lap.

Before emitting any finding anchored to a `rem-*` task, apply this convergence test: would the
finding have been valid against exactly what that task's text asked for? If it demands more, it is
scope expansion — omit it.

Preservation maintenance uses a closed three-condition predicate. A declared behavior plus removal
of its carrier establishes the maintenance case. Apply it only when all of the following hold:

1. `preservationContext` names the preserved behavior for a plan task;
2. the engine-derived removal evidence shows this diff deleted the carrier or, through
   `removedTestAssertions` from retained test files, moved the active assertion that distinguished
   that behavior at merge base; and
3. an equivalent survivor is an active assertion that distinguishes the preserved behavior anywhere
   in the post-diff tree.

When all three hold, suppress the carrier-specific plan gap: the equivalent assertion survives, so
relocation is not incomplete. A weakened, assertion-free, different-behavior, commented-out, or
skipped replacement is not an equivalent survivor. When conditions 1 and 2 hold but no equivalent
assertion survives, emit the preserved-behavior finding; do not grant either anchor half alone.

Evaluate this predicate per preserved-behavior clause, never per diff. Do not use task-history
attribution: judge only from plan text, diff content, and engine-derived removal evidence.

## Result contract (v3)

Return exactly one JSON object whose only top-level field is `findings`, an array. The engine owns
the `judged` envelope and stamps its kind, rubric, contract version, lap identity, and snapshot
identity after validating this findings-only payload. Return every independent finding; an empty
array means no Completeness concern was found.
Each finding contains:

**Closed vocabulary:** `missing-deliverable`.

**Reference grammar:** `anchor.planTask` is a `plan-task` reference; `anchor.missingSurface` is a `path` reference.

- a `concernKind` field (never `kind`) with the sole allowed member `missing-deliverable`;
- typed logical anchors for the approved plan outcome/task and missing deliverable, carried in a
  nested `anchor` object — `{"rubric": "completeness", "planTask": "<projection task reference>",
  "missingSurface": "<task-owned plan surface reference>", "missingOutcome": "<report prose>",
  "missingKind": "missing-deliverable"}` — where `missingKind` is the role-specific
  classification anchor field: it must be exactly `missing-deliverable` and therefore matches
  `concernKind`. `planTask` and `missingSurface` are immutable-projection references;
  `missingOutcome` remains report prose. Never flatten the anchor to the finding's top level or
  rename it (no `planAnchor`/`deliverableAnchor`);
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
