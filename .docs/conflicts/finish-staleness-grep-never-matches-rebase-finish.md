# Conflict Check: finish/pr staleness-proof grep never matches git's actual "rebase (finish)" reflog wording

**Date:** 2026-07-12 · Tier S · intake jstoup111/ai-conductor#587
**New stories:** `.docs/stories/finish-staleness-grep-never-matches-rebase-finish.md` (2 stories)
**Result:** PASSED — 0 blocking conflicts, 0 degrading contradictions.

## Scope of the change

Two literal-string corrections inside existing prose (`skills/finish/SKILL.md` §1b,
`skills/pr/SKILL.md`'s equivalent section) — the fallback reflog grep pattern changes from the
never-matching `"rebase: finish"` to git's actual wording (`rebase (finish):`). No new marker, no
new state, no new CLI surface, no schema change. The staleness-proof *contract* (fast path
merge-base, fallback reflog, STOP on unproven staleness, STOP on lease failure) is unchanged — only
the fallback's matching literal is corrected.

## Pairs examined and judged clean

- **`finish-step-completion-becomes-engine-machinery-re.md` (#499, PR #575, merged):** that
  feature made `.pipeline/finish-choice` / `pr_url` *recording* engine-owned
  (`finish-record-cli.ts`) and added the in-step repair / isDraft / surgical-retry machinery. It
  did **not** touch the §1b staleness-proof derivation (the merge-base/reflog check that decides
  *whether* a force-with-lease push is authorized) — that remains prompt-level in both skills,
  upstream of anything `finish-record-cli.ts` verifies. Disjoint surfaces: this fix corrects the
  proof's grep; #499's machinery consumes the proof's *outcome* (a push having already landed) via
  `push-evidence.ts`, unaffected by which literal the grep matches.
- **`post-rebase-build-invalidation-dispatches-a-full-b.md` (#420, shipped):** governs whether a
  post-rebase gate re-verify happens; orthogonal to the push-direction staleness proof, which runs
  at finish-time, not at rebase-invalidation time. No shared state, no ordering dependency.
- **`daemon-false-ship-guard.md` (push-evidence.ts / `headPushedToUpstream`, shipped):** verifies
  HEAD was pushed *after* the push already happened; this fix is upstream of that (it governs
  whether the push is attempted at all). No contention — sequential, not concurrent, and this fix
  changes neither `push-evidence.ts` nor its call sites.
- **Unmerged/pending spec branches touching `finish`/`pr` skills or engine machinery** (searched via
  `.docs/specs/*finish*`, `.docs/track/*finish*`): none found in-flight beyond the already-merged
  #499/#575. No file-proximity or behavioral-overlap risk identified.

## Non-conflicts by construction

- The fix is strictly **corrective** (a literal string that never matched real git output, made to
  match), not a behavior change to the gate's decision rules — so nothing that previously relied on
  the (broken) fallback ever observed it firing; there is no shipped behavior to contradict.
- Both touched files (`skills/finish/SKILL.md`, `skills/pr/SKILL.md`) are edited together in this
  same feature, closing the exact symmetric-drift risk the original PR #265 introduced (fixing one
  and not the other would immediately reopen a variant of #587 in `/pr`).

## Coverage note

None routed to `/plan` — the fix is fully scoped by the plan's two grep corrections plus prose/
checklist updates in both files; no additional design surface remains.
