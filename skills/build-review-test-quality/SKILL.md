---
name: build-review-test-quality
disable-model-invocation: true
description: "Judge whether criterion-bound changed tests can pass without the behavior they claim to cover."
enforcement: gating
phase: build
---

## Purpose

Judge the Test Quality concern for one engine-managed `build_review` rubric branch. This is a
judgement-only contract: the engine owns scope selection, evidence assembly, result validation,
finding identity, dispositions, and the outer gate verdict.

## Input projection (v3)

Use only the supplied projection version `v3`. Its closed input contains:

- the lap ID, snapshot digest, and top-level `contentDigest`;
- the in-scope changed tests: only changed tests with a resolvable `Covers:` binding to an approved
  story criterion or task `Done when:` check, represented as immutable content-region references;
- the changed diff by reference (`changedFiles`: per-file path, change kind, and hunk ranges),
  anchored by `mergeBase` and `headSha`;
- the current code-valid `test_suite` PASS; and
- typed reverted-production preflight evidence, including its source identities, classification,
  scoped-run result, executed selectors, and bounded failure excerpt when applicable.
- any concrete fallback candidates in `testScope`, each with its engine-established candidate ID,
  pinned source region, and allowed Covers obligation references.

The session runs inside the feature worktree. The diff content is not embedded: read referenced
files and obtain any per-path diff with `git diff <mergeBase>..HEAD -- <path>` (or the merge-base
form with `git show <mergeBase>:<path>`). Those reads are part of this closed input. Do not infer
facts from a maker transcript, task-status narrative, prior review, or state outside this projection
and its referenced content.

## Judgement

For each in-scope changed test, judge whether its assertion actually distinguishes the behavior its
`Covers:` binding names. Raise `test-insensitive` only when the test has a concrete,
stub-passable assertion: it could pass while the changed behavior is absent or replaced with a
stub. Keep independent tests or behaviors as separate findings.

The reverted-production preflight is evidence, never a finding by itself. Report its optional
`counterfactualSensitivity` judgement using this closed vocabulary:

- `supports` means either an executed in-scope example fails on the reverted tree, or the reverted
  production causes the intended tests to fail during collection or load.
- `indeterminate` means an environment failure prevents the intended tests from bearing on behavior
  before that can be determined — for example, the #1915 database-auth or boot failures.
  It is neither sensitivity support nor a finding.
- `not-applicable` means the counterfactual evidence does not apply to a sensitivity judgement.

A `stayed-green` result is not automatically a concern: read the test and cite the concrete
stub-passable assertion before finding it insensitive. An infrastructure failure is not a finding;
do not invent evidence, downgrade it to a pass, or turn it into content criticism. Tests outside the
supplied in-scope set are not this rubric's concern.

## Result contract (v3)

Return exactly one JSON object with a required `findings` array and an optional
`counterfactualSensitivity` field, plus a required `scopeResolutions` array. `scopeResolutions` has exactly one disposition for every supplied
fallback candidate; it is `[]` when none are supplied. The engine owns the `judged` envelope and stamps its kind,
rubric, contract version, lap identity, and snapshot identity after validating this
findings-plus-optional-field payload. Return every independent finding; an empty array means no Test
Quality concern was found. Each finding contains:

```json
{
  "findings": [
    {
      "concernKind": "test-insensitive",
      "summary": "string",
      "evidenceLocations": ["path:line"],
      "anchor": {
        "rubric": "testQuality",
        "locus": { "path": "string", "contentHash": "string", "display": "string" }
      }
    }
  ],
  "scopeResolutions": [
    {
      "candidateId": "string from the supplied candidate",
      "status": "resolved | out-of-scope | indeterminate",
      "sourceRegion": { "path": "string", "startLine": 1, "endLine": 1, "contentHash": "sha256:string", "display": "string" },
      "obligationReferences": ["string from the supplied candidate"],
      "associationReason": "non-empty source-grounded reasoning"
    }
  ],
  "counterfactualSensitivity": "supports | indeterminate | not-applicable"
}
```

Omit `counterfactualSensitivity` when no judgement is reported; when present, it must use exactly
one of those three values. `indeterminate` never supports a finding, and a `test-insensitive`
finding still requires its own concrete stub-passable assertion.

For each fallback candidate return exactly one of these complete forms:

The only disposition statuses are `resolved`, `out-of-scope`, or `indeterminate`.

- `resolved`: candidateId, its exact pinned sourceRegion, one or more applicable supplied
  obligationReferences, and a non-empty associationReason. A finding may anchor this resolved region.
- `out-of-scope`: candidateId and a non-empty exclusionReason. Do not invent a finding for it.
- `indeterminate`: candidateId and a non-empty missingEvidenceReason. Do not use a sibling source
  region, a foreign Covers reference, or free-text similarity as authority.

**Closed vocabulary:** `test-insensitive`.

**Reference grammar:** `anchor.locus` is a `content-region` reference.

- a `concernKind` field (never `kind`) carrying the concern kind, with the sole allowed member `test-insensitive`;
- a nested logical anchor — `{"rubric": "testQuality", "locus": {"path": "<repository-relative path>",
  "contentHash": "sha256:<normalized-test-title>", "display": "<human-readable non-coordinate label>",
  "occurrence": <0-based ordinal among equal-content regions in this path; omit when unique>}}`.
  `locus` is the immutable in-scope content-region reference. The anchor is never flattened to the
  finding's top level or rename it;
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.

## Verification

- [ ] Every finding uses only `test-insensitive` and a nested `testQuality` content-region anchor.
- [ ] Every finding cites a concrete stub-passable assertion, not preflight classification alone.
- [ ] `counterfactualSensitivity`, when returned, is exactly `supports`, `indeterminate`, or
      `not-applicable`; `indeterminate` is neither sensitivity support nor a finding.
- [ ] `scopeResolutions` covers every supplied fallback candidate exactly once using `resolved`,
`out-of-scope`, or `indeterminate`; its allowed statuses are exactly `resolved`, `out-of-scope`, or
`indeterminate`; resolved entries repeat only pinned source and obligation evidence.
- [ ] `supports` is used only for an executed-example failure on reverted production or a
      reverted-production collection/load failure.
- [ ] Findings omit tests outside the supplied in-scope projection and omit dispositions.
