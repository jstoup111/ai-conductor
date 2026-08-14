---
name: build-review-scope
description: "Judge whether implementation changes stay within the approved plan, repair context, and accepted scope widenings."
enforcement: gating
phase: build
---

## Purpose

Judge the Scope concern for one engine-managed `build_review` rubric branch. This is a
judgement-only contract: the engine owns evidence assembly, result validation, finding identity,
dispositions, and the outer gate verdict.

## Input projection (v1)

Use only the supplied projection version `v1`. Its closed input contains:

- the lap ID and snapshot digest;
- the changed diff;
- the approved plan;
- repair context; and
- accepted scope widenings.

Do not infer authority from a maker transcript, task-status narrative, prior review, or any state
not present in this projection.

## Judgement

Compare every changed path or production surface with the approved plan. Treat a change as in scope
only when the approved plan, repair context, or accepted scope widenings directly authorize it.
Identify the specific plan relation that makes each out-of-scope change a concern. Do not collapse
several unrelated paths or surfaces into one finding merely because they were changed together.

## Result contract (v1)

Return one `judged` result for rubric `scope` with contract version `v1` and a `findings` array.
Return every independent finding; an empty array means no Scope concern was found. Each finding
contains:

- an enumerated concern kind;
- typed logical anchors for the out-of-plan path or surface and its plan-scope relation;
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
