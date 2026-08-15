---
name: build-review-tautology
description: "Judge whether changed tests distinguish the changed production behavior from its merge-base form."
enforcement: gating
phase: build
---

## Purpose

Judge the Tautology concern for one engine-managed `build_review` rubric branch. This is a
judgement-only contract: the engine owns evidence assembly, preflight execution, result validation,
finding identity, dispositions, and the outer gate verdict.

## Input projection (v1)

Use only the supplied projection version `v1`. Its closed input contains:

- the lap ID and snapshot digest;
- the changed diff and changed-test selectors;
- the current code-valid `test_suite` PASS;
- the reverted-production patch; and
- typed preflight evidence, including source identities, the scoped command, bounded output, and
  its result classification.
- engine-recorded rebase-repair context, when a changed test repairs stale base-state expectations.

Do not infer facts from a prior review, a maker transcript, task-status narrative, or any state not
present in this projection.

## Judgement

Assess whether every changed test meaningfully distinguishes its exercised production behavior.
Interpret the preflight classification precisely:

- `red` is expected evidence that the changed tests detect the reverted production behavior; it is
  not itself a finding.
- `stayed-green` requires a blocking finding for each independent changed-test/behavior obligation
  that remained insensitive to the reverted production behavior.
- `approved-exception` is not a finding when the supplied exception covers the relevant selector.
- `infrastructure-failure` is not a finding. Do not invent evidence, downgrade it to a pass, or
  convert it into content criticism.

The only exceptions are rebase repair, removal maintenance, and fixture relocation. Apply their
diff-derived criteria exactly as supplied by the projection; a selector outside those criteria is
measured normally. A fixture relocation requires both the test-path move and a production path
handling/classification change that makes the former path lose its prior meaning; a move alone is
not an exception.

For every changed test evaluated under the fixture-relocation exception, return exactly one
audit-only `relocationAudit` entry on PASS or FAIL:
`[relocation-audit] (EXEMPTED|MEASURED): old path → new path; production hunk(s) (do|do not) force the move`.
`EXEMPTED` proves the complete exception qualified; `MEASURED` proves it did not and the test was
judged normally. This is not a finding: it must name both paths and whether production forces the
move, which distinguishes relocation from deletion or masking. Unevaluated tests and non-Tautology
results must not manufacture relocation-audit evidence.

## Result contract (v1)

Return one `judged` result for rubric `tautology` with contract version `v1` and a `findings` array.
Return every independent finding; an empty array means no Tautology concern was found. Each finding
contains:

- an enumerated concern kind;
- typed logical anchors for the changed test, exercised behavior/assertion, and violation kind;
- an actionable summary; and
- concrete evidence locations from the supplied projection.

The engine validates anchors, canonicalizes identities, and decides the branch and outer verdict.
This skill does not read, write, apply, or decide a disposition.
