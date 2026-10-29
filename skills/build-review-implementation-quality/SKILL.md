---
name: build-review-implementation-quality
disable-model-invocation: true
description: "Judge whether a feature diff introduces concrete code-quality or domain-modelling defects in a closed vocabulary."
enforcement: gating
phase: build
---

## Purpose

Judge one engine-managed `build_review` implementation-quality rubric branch. This is a
judgement-only contract: the engine owns scope, input assembly, validation, identity, and verdict.

## Input projection (v3)

Use only the supplied v3 projection. It identifies the frozen feature diff by reference. Read a
referenced file or `git diff <mergeBase>..HEAD -- <path>` when needed; do not use plan, story,
ADR, transcript, or prior-review content.

Judge only the `reviewScope` delta hunks. Treat `changedFiles` as context only. If that review
identifies a finding outside the delta, set `causeHunk` to the delta hunk that causes it.

## Judgement

Report one finding per independent concrete defect. Anchor it to the changed hunk that introduces
the defect; name related unchanged code only in `evidenceLocations`.

A `duplication` or `excess-complexity` finding must be complete, because its repair consolidates in
one pass. Its summary names every repeated behavior or tangled flow the delta introduces for that
defect, and `evidenceLocations` lists every site that shares it. Do not report the most visible
instance and leave the remainder for a later lap.

- `duplication` — newly repeated behavior creates divergent maintenance paths. **Non-finding:** a
  declared exact pattern replication or incidental short syntax repetition.
- `excess-complexity` — a changed control/data flow is unnecessarily difficult to follow, including
  four or more levels of nesting that can be flattened without changing correctness. **Non-finding:**
  ordinary conditional logic with clear bounded cases.
- `obscured-intent` — changed structure hides the domain operation it performs. **Non-finding:** a
  local implementation detail with an unambiguous name and boundary.
- `primitive-obsession` — changed primitive values encode a domain concept that needs invariants.
  **Non-finding:** a primitive whose valid range and meaning are already locally enforced.
- `representable-invalid-state` — changed state shape permits an invalid domain combination.
  **Non-finding:** states constrained at construction so invalid combinations cannot arise.
- `non-exhaustive-domain-match` — a changed domain branch silently drops a meaningful case.
  **Non-finding:** an explicit exhaustive default that preserves all remaining cases.
- `non-semantic-name` — a changed public or domain name obscures its semantic role. **Non-finding:**
  a short conventional iterator or a private implementation-local temporary.

Do not report style preferences, acceptance-criteria compliance (owned by `prd_audit`), plan
conformance, ADR conformance (owned by the as-built architecture review), or hypothetical risks.

## Result

Return only `{ "findings": [...] }`. Each finding has `concernKind`, `summary`,
`evidenceLocations`, an `anchor` with this rubric and a changed content-region locus, and optional
integer `confidence`, and required `severity`. Return an empty findings array when there is no
concrete defect.
