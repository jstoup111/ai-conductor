# Conflict Check: Daemon auto-resolve gitignored build-artifact rebase conflicts

**Date:** 2026-07-05
**Stories checked:** `.docs/stories/daemon-auto-resolve-gitignored-rebase-conflicts.md`
(TR-1…TR-6) against the existing engine-native rebase stories (FR-4 satisfied-iff-current,
FR-5 code/test-path invalidation, FR-7 CHANGELOG-sole auto-resolution, FR-8 HALT, FR-9
preexisting-conflict guard) and the daemon dispatch/dedup stories (`isProcessed`/ledger
shipped-dedup, operator-park re-arm, `.pipeline/REKICK` re-kick).
**Result:** **No blocking conflicts.** Two overlaps resolved in place; two design constraints
recorded.

---

## Overlap (RESOLVED): TR-1 `artifact_resolved` × FR-5 code/test-path invalidation

**Stories:** "Auto-resolve a base-ignored build-artifact delete/modify conflict" (TR-1) /
"`artifact_resolved` outcome classified satisfied" (TR-3) vs the existing FR-5 rule that a
file-changing rebase invalidates downstream gates.
**Type:** overlap · **Severity:** degrading (not incorrect).

**Description:** Taking the base's deletion changes the tree. A naive FR-5 reading ("any changed
path → invalidate build/manual_test") would force a full re-verify for a change to a **gitignored
artifact that is never built or tested** — wasteful.

**Resolution applied:** TR-3 defines `artifact_resolved` as **verdict-equivalent to
`changelog_resolved`** — artifact/docs-only, `rebase` gate SATISFIED, `kickedBack: []`. This reuses
the exact FR-5×FR-7 resolution already in the code (`isCodeOrTestPath` excludes docs; a gitignored
artifact is likewise never a build input). Recorded in TR-1/TR-3 Done-When.

---

## Overlap (RESOLVED): TR-5/TR-6 re-dispatch × `isProcessed`/ledger shipped-dedup

**Stories:** "Re-dispatch a processed feature whose only open PR is needs-remediation" (TR-5) /
"Bound re-dispatch to one attempt per remediation PR" (TR-6) vs the existing shipped-dedup that
makes the daemon SKIP any `.daemon/processed/<slug>` slug.
**Type:** contradiction (surface) · **Severity:** would-be-blocking, resolved.

**Description:** The shipped-dedup exists precisely to stop re-dispatch of processed slugs (the
backfill, slug-rename, and same-slug duplicate-dispatch incidents). A route that re-dispatches a
processed slug appears to contradict it.

**Resolution applied:** TR-5/TR-6 do **not** relax `isProcessed` or the ledger. They add a
**separate, additive** re-arm gated on (processed AND open needs-remediation label AND no
merged/healthy PR) and bounded by a one-shot `(slug, PR-number)` anchor. The dedup invariant that
protected against the three historical incidents is untouched: a restart/rename/backfill re-reads
the same marker and no-ops. Recorded in adr-2026-07-05-needs-remediation-redispatch.

---

## Design constraint recorded (NOT a conflict): TR-4 recovery × FR-9 preexisting-conflict guard

TR-4 splits FR-9's guard rather than replacing it. FR-9's protection (a genuinely in-progress
rebase must re-park, never be reset) is **strengthened**, not weakened: the reset branch is gated on
`rebaseStateActive() === false`. The two are complementary — FR-9 keeps its exact behavior for an
active rebase; TR-4 only adds the inactive-but-unmerged recovery. No change to FR-9's active-rebase
path.

---

## Design constraint recorded (NOT a conflict): TR-1 composes with — does not replace — FR-7 CHANGELOG-sole

The existing FR-7 branch handles `CHANGELOG.md` as the SOLE conflict and stays as-is. TR-1's new
resolver handles the broader set {CHANGELOG} ∪ {base-ignored DU artifacts}, reusing FR-7's
`buildResolvedChangelog` for the CHANGELOG member. The two are ordered (FR-7 sole-check first, then
TR-1's composite), so a pure-CHANGELOG conflict still takes the FR-7 path unchanged, and a
{CHANGELOG + dist} conflict (the #268/#269 case) falls to TR-1 and resolves both together. No
double-resolution: the branches are mutually exclusive by conflict-set membership.

## Design constraint recorded (NOT a conflict): TR-1 unconditional vs the cap-gated `/rebase` loop

TR-1's resolution lives in `performRebase` proper (like FR-7 CHANGELOG), NOT the cap-gated
`runGatedRebaseResolution` `/rebase` loop. This is deliberate: the re-kick call site passes
`cap: 0`, so anything in the gated loop would never run on re-kick — the exact path #319's stranded
PRs travel. No conflict with the resolution-cap config (FR of the rebase-resolution-skill); the cap
still governs the Claude `/rebase` dispatch only.
