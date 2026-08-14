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

## Input projection (v1)

Use only the supplied projection version `v1`. Its closed input contains:

- the lap ID and snapshot digest;
- the full changed diff; and
- the approved plan.

Do not infer delivery from a maker transcript, task-status narrative, prior review, or any state not
present in this projection.

## Judgement

Read the approved plan and full changed diff as a whole. Judge holistically whether the diff,
taken together, delivers every approved plan outcome. A plan task may help locate an outcome, but
do not reduce the judgement to individual commits or task records.

Identify each missing deliverable that prevents a plan outcome from being delivered. Keep unrelated
gaps separate so the result preserves every independently actionable omission.

## Result contract (v1)

Return one `judged` result for rubric `completeness` with contract version `v1` and a `findings`
array. Return every independent finding; an empty array means no Completeness concern was found.
Each finding contains:

- an enumerated concern kind;
- typed logical anchors for the approved plan outcome/task and missing deliverable;
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
