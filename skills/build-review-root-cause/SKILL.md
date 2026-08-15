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

## Input projection (v1)

Use only the supplied projection version `v1`. Its closed input contains:

- the lap ID and snapshot digest;
- the changed diff;
- the approved plan, including the stated defect/outcome; and
- repair context.

Do not infer a different problem statement from a maker transcript, task-status narrative, prior
review, or any state not present in this projection.

## Judgement

Compare the stated defect/outcome with the implementation's mechanism. A symptom-only change is a
concern when it masks an observed effect without addressing the mechanism or locus that the supplied
evidence identifies as responsible for the defect. Assess each independent defect and implementation
relation separately; do not merge distinct mechanisms into one finding.

## Result contract (v1)

Return one `judged` result for rubric `rootCause` with contract version `v1` and a `findings` array.
Return every independent finding; an empty array means a PASS for this rubric. Each finding contains:

- an enumerated concern kind;
- typed logical anchors for the stated defect/outcome and implementation mechanism or locus judged
  symptomatic;
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
