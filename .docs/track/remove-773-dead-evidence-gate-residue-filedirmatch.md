# Track: Remove #773 dead evidence-gate residue and fix stale auto-park comment

**Source:** jstoup111/ai-conductor#792 (follow-up to #773 / PR #780)
**Track:** TECHNICAL (code hygiene / dead-code removal — no product requirement, no user-facing behavior change)
**Tier:** Small (see `.docs/complexity/`)

## Problem statement (WHAT)

PR #780 demoted the per-task evidence ledger from a completion **gate** to telemetry
(ADR `adr-2026-07-21-demote-task-stamping-to-telemetry`, APPROVED). A pre-merge review
found the ADR's named-for-deletion residue was only partially removed. Three production
symbols are now reachable-from-nothing dead code, and one comment misdescribes current
behavior. It shipped safely (nothing executes it), but it contradicts the APPROVED ADR
and confuses the just-simplified completion path.

## Desired outcomes (verified acceptance signals)

- `git grep -n 'fileDirMatchesPlanPath\|validateCitations\|runAttributionLane' src/conductor/src`
  returns nothing (production `src/` clean of the removed symbols).
- `git grep -n 'auto-park trigger' src/conductor/src/engine/conductor.ts` no longer references
  the removed no-evidence park trigger.
- `fileMatchesPlanPath` still resolves and the `derive-feedback` path is unaffected.
- Full suite + typecheck pass (nothing live depended on the removed code).

## Discovery — grounded caller analysis (settles "is it dead")

All grep evidence gathered against `main` (PR #780 merged 2026-07-22).

### Confirmed DEAD (remove) — zero production callers

1. **`fileDirMatchesPlanPath`** — `src/conductor/src/engine/autoheal.ts:58`. `git grep`
   across `src/conductor` (prod + tests) returns ONLY the definition line. Sibling
   `corroborationMatch` already gone. ADR line 65 named it for deletion.

2. **`validateCitations`** — `src/conductor/src/engine/attribution-validate.ts:117`.
   Production references = only the definition. All other refs live in `test/` and in
   two prose comments (`attribution-lane.ts:407`, `rebase-translate.ts:233`). ADR line 68
   named the per-task citation gate for removal.

3. **`runAttributionLane`** — `src/conductor/src/engine/attribution-lane.ts:423`. Its own
   doc comment declares it "retained only as a thin, inert dispatch stub … never gates and
   never stamps"; every return path yields an empty stamped list. Production refs = the
   definition + one prose comment (`rebase-translate.ts:396`). ADR line 68 named
   `attribution-lane.ts`'s gate for removal.

### Knock-on DEAD (remove with the above) — orphaned only after the deletions land

4. **`loadRewriteMap`** — `src/conductor/src/engine/rebase-translate.ts:237`. Its ONLY
   production consumer is `validateCitations` (attribution-validate.ts:141). Deleting
   `validateCitations` orphans it. Its only test caller is inside
   `attribution-validate.test.ts` (itself deleted). SAFE to remove.

5. **`RunAttributionLaneOptions` / `AttributionLaneResult`** —
   `attribution-lane.ts:391 / :376`. Used only by `runAttributionLane` (+ a test comment).
   Orphaned once the stub is gone.

6. **`attribution-validate.ts` whole file** — after removing `validateCitations`, the
   remaining exports are only the validation interfaces (`VerdictResultForValidation`,
   `TaskForValidation`, `CitationValidationResult`) plus private helpers. No production
   module imports `attribution-validate` (verified: the only `src` mentions are prose
   comments). File becomes deletable.

### Confirmed LIVE — MUST KEEP (do not touch)

- **`fileMatchesPlanPath`** (autoheal.ts:42). Live chain, independent of the removed gate:
  `src/index.ts:472` → `dispatchDeriveFeedback` (derive-feedback-cli.ts:69) →
  `checkCommitEvidence` (autoheal.ts:504) → `filesOverlappingTaskPaths` (autoheal.ts:532) →
  `fileMatchesPlanPath` (autoheal.ts:68). ADR line 65 mistakenly grouped it for deletion;
  PR #780 correctly kept it.
- **`translateAfterRebase` / `buildRewriteMap`** — the rewrite-map WRITE + in-place
  sidecar/status-stamp rewrite (#535). Wired into `performRebase` via conductor.ts:5581 and
  daemon-rekick.ts:385. FULLY LIVE. #535's telemetry-preservation is unaffected.
- **`resolveThroughMap`** (rebase-translate.ts:107) — live internal callers
  (rebase-translate.ts:190/193/196/216/293). KEEP.
- **`attribution-lane.ts` memo/rebase machinery** — `computeMemoKey`, `readMemo`,
  `writeMemo`, `rekeyMemoAfterRebase`, `dispatchAttributionVerifier`. Live. KEEP.
- Surviving **telemetry** (per ADR): git `Task:` trailer stamping, `task-evidence.json`
  sidecar as a record, progress counts, attribution spot-audit, retro Part C. NOT touched.

## Load-bearing decision surfaced by discovery

`validateCitations` is the **sole** production consumer that resolves citations through the
#535 rebase rewrite map (`loadRewriteMap` → `resolveThroughMap`). Deleting it:
- does **NOT** regress #535 — the write path and the in-place sidecar-stamp rewrite during
  rebase stay live; only the gate's read-back-at-validation path (already dead post-#773) goes.
- **breaks #535's own Story 5/6 acceptance tests** in `rebase-translate-acceptance.test.ts`
  (they use `validateCitations` as "the real read-time consumer"). There is **no** surviving
  production read-time consumer to re-home them onto (autoheal does NOT resolve through the
  map). Decision: **remove those two `it(...)` blocks** — the read path they assert is dead
  post-#773. This is a conscious, documented coverage removal, not a silent #535 regression.

## Approaches considered

- **A (CHOSEN): Delete the confirmed-dead symbols + their now-orphaned knock-ons
  (`loadRewriteMap`, orphaned types, empty `attribution-validate.ts`), fix the comment, and
  surgically remove the tests that asserted the deleted gate.** Matches the ADR's stated
  scope and the repo Design Principle ("removal, not another guard"); leaves no new residue.
- **B: Delete only the three named symbols; leave `loadRewriteMap` orphaned.** Rejected —
  leaving a newly-orphaned helper recreates exactly the "dead residue" this issue exists to
  remove, and the issue's own hypothesis calls for removing "now-orphaned imports/types."
- **C: Keep `validateCitations`, hide the residue behind a flag.** Rejected — directly
  contradicts the ADR (Option A: structural removal) and the Design Principle.

## Out of scope (flagged for a possible separate issue)

The broader question of whether the #535 rebase-rewrite-map machinery should itself be
retired now that its only read-back consumer is gone is **out of scope** — the write/rewrite
path is still live and still preserves telemetry across rebases, so it is not dead. This spec
does not touch `translateAfterRebase`/`buildRewriteMap`/`resolveThroughMap`.
