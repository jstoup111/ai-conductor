# Architecture Review: park-reconciliation refusal observability (#1114)

Date: 2026-08-01
Tier: M (lightweight review)
Verdict: **APPROVED to proceed to stories**
ADR produced: `adr-2026-08-01-multi-proof-park-deletion-authority` (APPROVED)

## What was reviewed

The residual half of #1114 after #1185: replace the overloaded `not-ancestor` refusal with a
cause-naming taxonomy, count refusals in the sweep summary, and correct
`adr-2026-07-27-ancestry-proven-park-reconciliation` §3.

## Premise corrections carried into the design

Two claims in the intake issue did not survive verification, and the design must not inherit them.

| Intake claim | Finding | Basis |
|---|---|---|
| The cleanup arm is structurally unreachable for squash-merged work | **False as of #1185.** Head-identity proof clears 144 of 186 non-ancestor branches; the cited branch is already reconciled and unparked | verified — `gh pr list --head <ref> --json headRefOid` returns the branch tip exactly; slug absent from `.daemon/parked/` |
| `git cherry origin/main <branch>` marks squash-merged commits `-` | **False.** All 12 commits mark `+`; squash produces one combined patch-id matching no individual commit | verified — run against the cited branch |
| `git diff origin/main...<branch>` is empty for merged work | **False.** Returns 6 files / 435 insertions; the three-dot form diffs *from the merge base*, so it returns the branch's own changes by construction | verified — run against the cited branch |
| ADR §3d governs raced-branch re-verification | **No such subsection.** The ADR's Decision has 8 flat items. "§3d" in tests refers to the `/writing-system-tests` skill | verified — ADR read in full |

The working patch-equivalence formulation (synthetic `commit-tree` onto the merge base, then
`git cherry`) was verified functional and correctly fail-closed, then **rejected on cost/benefit**:
+3 branches over the shipped proof. Recorded in the ADR so it is not re-litigated.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Refusal split silently weakens the deletion gate | Data loss | Low | **High** | ADR §5 fixes the invariant: no branch becomes newly deletable. Story S5 is a characterization test asserting the delete/refuse *partition* is byte-identical before and after, independent of reason strings |
| Tests asserting the literal `not-ancestor` string break or are loosened into vacuity | Correctness | **High** | Medium | Six known assertion sites enumerated in the plan. The acceptance raced-branch test matches `/ancestor/i` on operator output and must be re-pinned to the specific new reason, not relaxed to a wildcard |
| `refused` counter added but log de-dup suppresses the change | Observability | Medium | High | ADR §4 makes inclusion in `sweepSummarySignatures` mandatory; story S4 has an explicit negative test that a refusal-mix change re-logs |
| `branch-behind-merged-head` mistaken for a licence to delete | Data loss | Low | High | ADR §5 + explicit story negative path: it refuses and deletes nothing |
| Naming unmerged commits requires an unbounded `git log` | Performance | Low | Low | Range is `headRefOid..<ref>`; bounded with a cap and an explicit "and N more" suffix |
| Divergent branch where `headRefOid` is unresolvable locally | Correctness | Medium | Medium | `git cat-file -e` guard; unresolvable ⇒ `ancestry-check-failed`, fail-closed, never a delete |

## Alignment

- Honors the repo Design Principle: this is deterministic engine machinery, no LLM judgement.
- Both deletion call sites keep funnelling through the single guarded helper — no second delete path.
- The single-writer park-marker invariant test is untouched.
- Docs already describe two proofs, so `docs/` edits here are refusal-table updates, not rewrites.
