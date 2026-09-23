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
finding identity, the stamped result envelope, and the outer gate verdict.

## Input projection (v3)

Use only the supplied projection version `v3`. Its closed input contains:

- the lap ID, snapshot digest, and top-level `contentDigest`;
- the in-scope changed tests: only changed tests with a current-feature-owned, resolvable `Covers:`
  binding introduced or updated after the review base, pointing to an approved
  story criterion, an active feature requirement (`FR-N`), or a task `Done when:` check, represented
  as immutable content-region references;
- the changed diff by reference (`changedFiles`: per-file path, change kind, and hunk ranges),
  anchored by `mergeBase` and `headSha`;
- the current code-valid `test_suite` PASS; and
- typed reverted-production preflight evidence, including its source identities, classification,
  scoped-run result, executed selectors, and bounded failure excerpt when applicable.
- any concrete fallback candidates in `testScope`, each with its engine-established candidate ID,
  pinned source region, and allowed Covers obligation references. Unchanged legacy bare markers
  are excluded before projection; their ordinals never gain authority from the active plan.
- `testScope.evidence` records are identity-only references: `source`, `region`, `startLine`,
  `endLine`, and `contentHash`. They are not embedded source content or a replacement for the
  engine's authority.

The session runs inside the feature worktree. The diff content is not embedded: read referenced
files and obtain any per-path diff with `git diff <mergeBase>..HEAD -- <path>` (or the merge-base
form with `git show <mergeBase>:<path>`). Those reads are part of this closed input. Do not infer
facts from a maker transcript, task-status narrative, prior review, or state outside this projection
and its referenced content.

For every `testScope.evidence` region you inspect, re-read the file at the pinned ref for its
`source` side (`mergeBase` for base regions, `headSha` for head regions) and verify `contentHash` as
sha256 of the raw bytes from `byteRegion.start` (inclusive) to `byteRegion.end` (exclusive) of that
output. `byteRegion` is in UTF-8 bytes; `region`, `startLine`, and `endLine` are character positions
for identity and orientation only, and diverge from byte offsets once the file holds a non-ASCII
character. A candidate's evidence record is the one whose `id` equals its `candidateId`. A
hash-mismatched or unreadable region is not judged: return its fallback candidate as `indeterminate`
with a non-empty `missingEvidenceReason`.
Your own read never becomes authoritative. The engine rejects a finding anchored to a `contentHash`
that is absent from the projected evidence and candidates.

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
