# Conflict Check: unify-build-completion-evidence-derivation-fix-der
**Date:** 2026-07-10
**New stories:** `.docs/stories/unify-build-completion-evidence-derivation-fix-der.md`
**Scanned against:** all `.docs/stories/` (16 files matching the evidence/derivation seam
inspected pairwise; the rest share no entity, endpoint, or state with this feature)
**Result:** 1 blocking conflict found and RESOLVED (supersession); 1 degrading sequencing note
accepted. Re-check clean.

## Conflict: Grandfather retirement vs shipped H8 migration story

**Stories involved:** "First seed never grandfathers terminal rows" + "The gate resolves tasks by
evidence stamps only" (new) vs "In-flight features migrate via the grandfather stamp; completed
rows never demote" (`prd-audit-kickback-preserves-task-status.md`, ADR H8)
**Type:** contradiction
**Severity:** blocking (resolved)

**Description:** The shipped #302 story mandates first-seed grandfather stamping and that
grandfathered rows are "never demoted … even though no trailer evidence exists"; the new stories
remove the stamp and make legacy grandfather entries inert at the gate. Both cannot hold.
Confidence this is a true contradiction: 95% (verified — contradicting text quoted from both
files). Root cause is the H8 *design decision*, not story phrasing, so the resolution is an
architectural supersession, not a story edit.

**Resolution applied (option 3 — mediating supersession, recommended):**
- `adr-2026-07-10-retire-migration-grandfather` records `Supersedes: H8 (grandfather portion) of
  adr-2026-07-05-engine-owned-task-status`.
- The old ADR's H8 bullet carries a partial-supersession note (append-only; H1–H7/H9 untouched).
- The old story carries a SUPERSEDED banner pointing at the new ADR + stories.
- Boundary preserved: never-demote for **evidence-stamped** rows is explicitly retained; only
  evidence-less grandfather-backed rows lose standing (this is exactly #463's demand).

## Consistency note (not a conflict)

The shipped story "Evidence range is plan-anchored and fails closed on merge-base failure"
(same file, ADR H5) already required: merge-base failure → EMPTY commit list, "never the
unbounded `HEAD -n 100` scan", and foreign/stale commits never evidence the current plan. The
current implementation does not fully honor it (genesis fallback, `-n 100` residual path —
verified in `autoheal.ts`). The new anchor stories COMPLETE that shipped intent; they do not
contradict it. New coverage beyond H5: the fork-point→plain-merge-base rung and derived default
branch.

## Degrading note: sequencing with in-flight evidence-seam specs

`deterministic-evidence-attribution.md` (#433, spec merged, build queued) and the setup-wedge
spec (#446) touch adjacent code (commit stamping hooks; setup step). No behavioral contradiction
— #433 changes how trailers are STAMPED, this feature changes which commits are IN RANGE and
what counts as evidence; they compose. Residual risk is textual merge conflicts in
`autoheal.ts`/`artifacts.ts` if built concurrently — sequencing/resource contention at the git
level, severity degrading, accepted (daemon's finish-time rebase + /rebase skill handle it).

## Re-check

After the supersession edits, re-scanned the pair set: zero blocking conflicts remain.
