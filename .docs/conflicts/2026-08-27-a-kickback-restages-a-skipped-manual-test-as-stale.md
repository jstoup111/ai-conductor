# Conflict Check: a-kickback-restages-a-skipped-manual-test-as-stale (#1987)

**Date:** 2026-08-27
**Corpus:** all `.docs/stories/` (336 files) + change-set ADRs (adr-2026-07-06,
adr-2026-07-10 — both amended 2026-08-27 — adr-2026-08-01, adr-2026-08-16,
adr-2026-08-19, adr-2026-08-24)
**Result:** 0 blocking. 1 medium conflict RESOLVED in stories; 1 low supersession noted.

## Conflict: --diagnose AC named `retro`, which an approved unshipped spec removes

**Stories involved:** Story 3 (--diagnose reports skipped as skipped) vs
`remove-retrospectives-full-and-micro-from-feature-` Story ("state recording a retro step
status fails by name")
**Files:** .docs/stories/a-kickback-restages-a-skipped-manual-test-as-stale.md vs
.docs/stories/remove-retrospectives-full-and-micro-from-feature-.md
**Type:** contradiction (land-order) | **Severity:** degrading (would become blocking after
the retro removal lands)

**Description:** Story 3's first happy-path AC listed `retro` among the skipped steps a
consistent report ignores; the approved retro-removal spec (adr-2026-08-26) requires the
engine to fail by name on any state recording a retro status, and edits the same
`SHIP_GATING_STEPS` list in `complete-verifier.ts`. Both cannot hold once the removal lands.

**Resolution applied (option 1, least disruptive):** the AC now names only surviving steps
(`manual_test`, `finish`). The new work's substance is unaffected; no dependency between the
two specs is introduced.

## Noted: literal supersession of one AC in `add-a-judgement-gate-at-the-build-manual-test-seam`

That accepted story's AC (":128") says a FAIL-verdict kickback marks `build_review` and
`manual_test` stale unconditionally — the literal text this fix narrows (a skipped
`manual_test` now keeps its status; `build_review` is still staled and a skipped
`manual_test` is never selectable, so the story's purpose survives). Severity low: this is
the defect being fixed, and the governing ADRs (adr-2026-07-06 D2, adr-2026-07-10 D1) carry
2026-08-27 amendment notes. The story file itself is not edited in this spec — the engineer
land stem gate rejects foreign-stem story edits; if the operator wants the one-line
replacement for symmetry it ships as a companion main-based PR.

## Clean pass

Every other candidate pair examined in both directions was compatible; notable confirmations:
skipped members already non-dispatching in the validation fan-out stories, the finish fence
already excludes validly-skipped validators (shipped `stale-manual-test-discovered-at-finish`
story), `markDownstreamStale` cascade stories unaffected (function unchanged), kickback
ledger/budget stories preserved by Story 1's explicit no-perturbation negative path, sink
registry stories satisfied by Story 2's per-sink declaration, `stepSatisfied` pinned
unchanged per adr-2026-08-24 D2. No oscillations found.
