# Conflict Check: post-plan DECIDE amendments reconcile with the plan (#1700)

**Date:** 2026-09-23
**Stories checked:** `.docs/stories/post-plan-decide-amendments-never-reconcile-with-t.md` (Stories 1–4)
**ADR corpus:** `repo_wide` — 317 ADR files examined; 8 fully superseded excluded; 42 narrowed in by
subject overlap (coverage_binding, seal/reseal, gate verdicts/resume, repair obligations, DECIDE
amendments, coherence/land criterion layer, ADR decision parsing, events, refused status, DECIDE
entry, conduct-state mutation); 267 narrowed out.
**Stories corpus:** ~480 files; ~26 narrowed in by keyword.
**Result:** PASS — zero blocking conflicts remain; one story conflict resolved by companion PR #2691.

## Resolved conflicts

| # | Parties | Type | Severity | Resolution (operator-approved 2026-09-23) |
|---|---|---|---|---|
| 1 | `adr-2026-08-23-criterion-layer-is-structural-at-land`, `adr-2026-07-26-daemon-decide-preseed-ownership` D4, `adr-2026-07-22-coherence-waiver-and-duplicate-claim`, `a-coverage-claim-can-name-a-task-whose-done-when-d` Story 7 × former Story 3 (BUILD-time criterion layer) | contradiction | blocking | Criterion layer dropped from scope; criterion validation stays at land |
| 2 | `adr-2026-09-11-selective-post-rebase-verification` decision 4, `file-changing-rebase-rewinds-past-test-suite-and-r` Story 3 × Story 4 | contradiction + sequencing | blocking | Reopen only after a reseal void (D19); rebase refresh never reopens |
| 3 | `adr-2026-08-31-coverage-binding-judge-step` D7 (disabled envelope has no digests) × Story 4 | oscillating | blocking | Digests recorded on every run; a digest-less prior envelope is a baseline |
| 4 | `a-coverage-claim-can-name-a-task-whose-done-when-d` Stories 5/8, `coverage-binding-serializes-judgments-and-loses-pa` Story 2 × Story 3 | contradiction | degrading | Amendment claims are a separate claim kind with their own schema and `coverage_binding_amendment_judged` event |
| 5 | `adr-2026-09-06-reopened-task-resolution` decisions 2/8/9, `remediation-halts-when-the-owning-plan-task-is-alr` Story 1 × Story 4 | overlap | degrading | 09-06 amended with decision 10: `coverage_binding` repair authority, `gates.coverage_binding` ledger key, default lap cap, governing review = next `build_review` |
| 6 | `adr-2026-09-02-adr-decision-citability-contract` decision 4 × Story 2 | contradiction | degrading | Uncitable ADR and tier S are `not-applicable` |
| 7 | `a-coverage-claim-can-name-a-task-whose-done-when-d` Story 4 × Story 2 (judge-disabled refusal) | contradiction | blocking | Companion main-based PR #2691 narrows Story 4 to judged criterion claims (land stem gate rejects the foreign-stem edit here) |
| 8 | `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` decision 2, #1047 advisory story × a self-amendment void (introduced during resolution) | contradiction | blocking | Self-amendment void removed; only an operator reseal voids |
| 9 | `adr-2026-08-31-coverage-binding-judge-step` D14 terminal statuses × `invalidated` | state gap | degrading | D16 declares `invalidated` non-terminal and non-completing, like `partial` |
| 10 | D18 schema × D19 `contradictsCompleted` | internal gap | degrading | D18 declares the optional field |

## Accepted residuals

- A coherence-only edit is not sealed and cannot trigger a reseal void; coherence edits accompany a
  sealed plan edit, and the land gate still validates coherence.
- A seal-reported self-amendment without a reseal does not re-arm the step; `build_review` judges it
  per `adr-2026-07-27`.
