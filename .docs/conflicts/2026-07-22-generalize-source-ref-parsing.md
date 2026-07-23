# Conflict Report: generalize-source-ref-parsing (GitHub + Jira tagged refs)

**Date:** 2026-07-22
**New stories:** `.docs/stories/generalize-source-ref-parsing-formatting-to-suppor.md`
**Scope scanned:** all 183 story files; 27 mentioning source refs read in full
(fan-out sweep) against the new feature's 6 behavioral commitments.
**Result:** 0 blocking, 3 degrading — all resolved (operator-approved 2026-07-22).

## Conflict 1: Autoclose story asserts non-GitHub Source-Refs are dropped

**Stories involved:** "Spec carries its issue origin" / "Daemon resolves the issue origin" (intake-issue-pr-link-autoclose.md) vs "Jira-aware intake markers" (new)
**Type:** contradiction · **Severity:** degrading (confidence ~95% — quoted negatives assert the exact write-drop/read-undefined behavior the new feature inverts for Jira keys)

**Description:** The autoclose negatives defined "malformed" as "does not match
`owner/repo#<digits>`" — under the new feature a valid Jira key is NOT malformed
and must round-trip losslessly.

**Resolution applied (option 1, least disruptive):** narrowed the autoclose
fixtures to truly-malformed refs (`proj_123!`, `not-a-ref`) and added a
2026-07-22 scope note marking the Jira boundary superseded. GitHub happy paths
untouched.

## Conflict 2: Un-enumerated 6th parser + pending spec with its own parse

**Stories involved:** intake-claim-closed-issue-guard-and-brain-sweep.md (TR-5 shared parse; landed, unbuilt) + `intake/backfill.ts:111` local `parseRef` (verified by read) vs "Duplicate parsers retired" (new)
**Type:** overlap / sequencing · **Severity:** degrading

**Description:** The new stories' invariant ("only the pr-labels URL parser
remains") would fail against backfill.ts's regex parser, and the pending
closed-issue-guard build could introduce a 7th parser whichever lands second.

**Resolution applied:** backfill.ts added to the ADR's per-consumer disposition
table (delete copy; GitHub-only shim; Jira ref stays a per-issue failure) and to
story 5's happy path + Done-When grep. A sequencing Done-When added: the
closed-issue-guard build satisfies its TR-5 by delegating to the canonical
module, never a new local grammar. (ADR edit is an in-flight amendment to this
feature's own unmerged ADR, not a supersession of a merged one.)

## Conflict 3: Shared mutation point at intake-marker.ts:51

**Stories involved:** owner-stamped-at-authoring.md vs "Jira-aware intake markers" (new)
**Type:** resource-contention / state-conflict · **Severity:** degrading

**Description:** Both features shape the marker write-validity decision at
`intake-marker.ts:51` and share `intake-marker.test.ts`. No logical
contradiction — a Jira ref reclassifies invalid→valid; owner-stamp
no-op/omit semantics are orthogonal.

**Resolution applied:** explicit Done-When added to new story 4: the existing
stamp-when-owned / omit-when-blank / no-op assertions must still pass.

## Consistent-overlap findings (no action)

gate-writeback skip-notice stories (2026-07-08 dedup, 2026-07-22 other-owner
suppression), dashboard gated-spec surfacing, blocker-resolver reuse, the
Closes/Refs injection stories, ledger idempotency stories (9.3/9.3b), and
priority-banded claim all route Jira refs through their existing
malformed/absent skip paths — behavior agrees with the compat-shim contract.
Five files interact only via story-metadata `Source-Ref:` lines (clean).

## Re-check

After applying the three resolutions: the autoclose narrowing only restricts
fixtures (no new pair interactions); backfill delegation matches the already-
consistent skip contract; story-4's added Done-When is additive. **Clean pass —
zero blocking conflicts; the three degrading conflicts are resolved, none
accepted-as-compromise.**
