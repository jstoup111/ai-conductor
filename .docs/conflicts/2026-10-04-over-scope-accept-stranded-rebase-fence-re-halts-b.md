# Conflict Check: over-scope-accept-stranded-rebase-fence-re-halts-b

**Date:** 2026-10-04
**Stories:** `.docs/stories/over-scope-accept-stranded-rebase-fence-re-halts-b.md` (Stories 1–7)
**ADR corpus:** `change_set` — `adr-2026-10-04-resume-completes-interrupted-rebase-operation`
**Result:** PASS after resolution (0 blocking, 0 degrading remaining)

## Existing stories examined

Corpus: 544 story files, narrowed by subject (rebase operation record, publication fence, resume,
over-scope decisions, prd_audit verdict reason). Pairs reasoned in both directions:

| Existing story | Shared subject | Result |
|---|---|---|
| `finish-fence-rejects-a-fresh-pass-for-a-gate-the-l.md` | finish fence, `appliedAt`, stamped preservation | Compatible — Story 2 keeps every finish blocker string; its "applying and malformed blockers unchanged" Done-When still holds at finish |
| `gate-step-completion-validates-against-code-state-.md` | no silent preservation of an un-stamped verdict on resume | Compatible — Stories 4–5 never keep an unproven pass |
| `over-scope-halt-accepts-one-criterion-per-clear-so.md` | `HALT.cleared` harvest by the next prd_audit lap | Compatible — Story 1 relies on that harvest; untouched-block re-fire matches Story 1's no-decision negative |
| `unpark-resumes-a-halted-feature-on-stable-main.md` | `HALT.cleared` bytes unchanged | Compatible — Story 6 also preserves `HALT.cleared` |
| `ship-tail-parallel-validation-serial-publication-922.md` | resume after a changed rebase returns through affected validation | Compatible — Story 1 is an instance of it |
| `rekick-resume-runs-finish-while-the-build-gate-ver.md`, `re-kick-resume-gate-invalidation-regression-covera.md` | verdict-aware resume | Compatible — no rebase-fence criteria |

## Conflict (resolved): changed preserved verdict during completion

**Stories involved:** Story 4 (negative 1) vs Story 1 (negatives on unstamped / pre-`appliedAt` preserved verdicts)
**Type:** contradiction (internal) · **Severity:** blocking · **Root:** design (ADR D2)

**Description:** Story 4 left a preserved gate whose verdict no longer matched its recorded digest
unstamped and still named in `transition.preserved`, and said resume "routes by that verdict". With
`appliedAt` set at completion time, that verdict predates `appliedAt` and is unstamped, which Story 1
requires to halt `needs-human`. Both could not hold.

**Resolution (operator-selected):** reuse the existing post-rebase rerun-or-reuse logic. The gate is
removed from the preserved set and classified by `applyRebaseVerdicts`' rules — reverified when its
completion check mechanically attests the current tree (verified: `test_suite` declares
`treeAttestingCompletion`), otherwise invalidated for rerun. ADR D2 and Story 4 revised in place
(neither is on main yet). Re-check: Story 1's integrity halts no longer apply because a completed
operation never names a preserved gate it did not stamp.
