---
name: build-review-wiring
description: "Judge static reachability from changed production surfaces to configured production entry points."
enforcement: gating
phase: build
---

## Purpose

Judge the Wiring concern for one engine-managed `build_review` rubric branch. This is a
judgement-only contract: the engine owns evidence assembly, prerequisite classification, result
validation, finding identity, dispositions, and the outer gate verdict.

## Input projection (v1)

Use only the supplied projection version `v1`. Its closed input contains:

- the lap ID and snapshot digest;
- the changed diff;
- configured production entry points;
- removal evidence and relocation evidence; and
- approved-plan Steps that explicitly declare scaffolding for a later task or feature.

The engine classifies absent or empty entry points as the `missing-entry-points` skip before this
skill is dispatched. Do not infer an entry point from any other source.

## Judgement

Judge static reachability in the code as written. For every new or changed production surface,
identify whether a source-level path reaches a configured production entry point. This is not a
runtime-behavior judgement.

Use removal evidence and relocation evidence to avoid treating a deleted or relocated surface as a
new unreachable production surface. Honor a non-wiring exception only when the approved-plan Steps
explicitly declare that the surface is scaffolding for a later task or feature; silence is not an
exception.

## Result contract (v1)

Return one `judged` result for rubric `wiring` with contract version `v1` and a `findings` array.
Return every independent finding; an empty array means no Wiring concern was found. Each finding
contains:

- an enumerated concern kind;
- typed logical anchors for the production surface, expected entry point, and missing reachability relation;
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not manufacture or return a skip or pass. This skill does not read, write, apply, or decide a disposition.
