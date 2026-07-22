# Implementation Plan: Remove #773 dead evidence-gate residue and fix stale auto-park comment

**Source:** jstoup111/ai-conductor#792
**Track:** Technical • **Tier:** Small
**Stories:** `.docs/stories/remove-773-dead-evidence-gate-residue-filedirmatch.md`

All "dead" claims below are grounded in grep evidence captured during `/explore` (see
`.docs/track/`). This plan is purely subtractive except for one comment edit, one README edit,
and one CHANGELOG entry. Do NOT touch the LIVE symbols listed in the track doc
(`fileMatchesPlanPath`, `translateAfterRebase`, `buildRewriteMap`, `resolveThroughMap`, the
`attribution-lane.ts` memo/dispatch machinery, or any surviving telemetry).

## Task Dependency Graph

```
T1 (remove fileDirMatchesPlanPath) ─┐
T2 (remove validateCitations)       ─┤
T3 (remove loadRewriteMap)  ← needs T2 │
T4 (delete attribution-validate.ts) ← needs T2,T3
T5 (remove runAttributionLane + types) ─┤
T6 (fix conductor.ts comment)       ─┘
        │
        ▼
T7 (delete attribution-validate.test.ts)      ← needs T4
T8 (trim attribution-lane.test.ts)            ← needs T5
T9 (trim attribution-conductor-wiring.test.ts)← needs T2,T5
T10 (trim rebase-translate-acceptance.test.ts)← needs T2
        │
        ▼
T11 (update README + prose comments)          ← needs T2,T4
T12 (CHANGELOG [Unreleased] entry)            ← needs T1–T6
        │
        ▼
T13 (typecheck + full suite green)            ← needs all
T14 (repo integrity suite)                    ← needs T12,T13
```

---

## T1 — Remove the orphaned `fileDirMatchesPlanPath` helper
Delete the `fileDirMatchesPlanPath` function (autoheal.ts:58) and its preceding doc comment.
Confirmed zero callers (prod + tests). Do NOT touch `fileMatchesPlanPath` (line 42) or
`filesOverlappingTaskPaths` (line 65).
- **Files:** `src/conductor/src/engine/autoheal.ts`
- **Dependencies:** none
- **Verify:** `git grep -n 'fileDirMatchesPlanPath' src/conductor` → empty.

## T2 — Remove the dead `validateCitations` validator
Delete the exported `validateCitations` function (attribution-validate.ts:117) and the now-unused
imports it introduced — specifically the `fileMatchesPlanPath` import (line 41) and the
`loadRewriteMap`/`resolveThroughMap` import (line 42). Leave the interface exports for T4 to
handle. `fileMatchesPlanPath` stays alive via its autoheal chain — removing this import edge does
not affect it.
- **Files:** `src/conductor/src/engine/attribution-validate.ts`
- **Dependencies:** none
- **Verify:** `git grep -n 'validateCitations' src/conductor/src` → empty.

## T3 — Remove the now-orphaned `loadRewriteMap` helper
With `validateCitations` gone (T2), `loadRewriteMap` (rebase-translate.ts:237) has no production
consumer. Delete the `loadRewriteMap` function and its doc comment. Do NOT touch
`resolveThroughMap` (line 107 — live internal callers), `buildRewriteMap`, `translateAfterRebase`,
`persistRewriteMap`, or the residue writers.
- **Files:** `src/conductor/src/engine/rebase-translate.ts`
- **Dependencies:** T2
- **Verify:** `git grep -n 'loadRewriteMap' src/conductor/src` → empty; `resolveThroughMap` /
  `translateAfterRebase` still present.

## T4 — Delete the emptied `attribution-validate.ts` module
After T2, the file holds only unused validation interfaces (`VerdictResultForValidation`,
`TaskForValidation`, `CitationValidationResult`) plus private helpers — none imported by any
production module (verified: only prose-comment mentions in `src`). Delete the whole file. If any
interface turns out to be imported elsewhere (re-grep to confirm), relocate it instead of deleting;
grep evidence says none is.
- **Files:** `src/conductor/src/engine/attribution-validate.ts` (delete)
- **Dependencies:** T2, T3
- **Verify:** `git grep -rn "from './attribution-validate" src/conductor/src` and
  `git grep -rn "attribution-validate.js" src/conductor/src` → no live import.

## T5 — Remove the inert `runAttributionLane` stub and orphaned types
Delete `runAttributionLane` (attribution-lane.ts:423) and the types it solely used —
`RunAttributionLaneOptions` (391) and `AttributionLaneResult` (376). Remove any imports that
become unused as a result. KEEP `computeMemoKey`, `readMemo`, `writeMemo`,
`rekeyMemoAfterRebase`, `dispatchAttributionVerifier` and the rest of the file. Update the file's
own header/doc prose if it still describes the removed stub.
- **Files:** `src/conductor/src/engine/attribution-lane.ts`
- **Dependencies:** none
- **Verify:** `git grep -n 'runAttributionLane\|RunAttributionLaneOptions\|AttributionLaneResult' src/conductor/src`
  → empty; the five memo/dispatch exports still present.

## T6 — Correct the stale auto-park comment
Rewrite the comment block at `conductor.ts:~1583-1585`. Current text claims the sidecar "feeds the
auto-park trigger (Task 23)"; #773 removed that path. New text: the sidecar is a durable telemetry
record of consecutive gate-miss counts that persists across engine restarts; it no longer feeds
any auto-park trigger. Code around the comment is unchanged.
- **Files:** `src/conductor/src/engine/conductor.ts`
- **Dependencies:** none
- **Verify:** `git grep -n 'auto-park trigger' src/conductor/src/engine/conductor.ts` → no longer
  references a removed no-evidence park trigger.

## T7 — Delete `attribution-validate.test.ts`
The file exercises only `validateCitations` (and imports `loadRewriteMap` solely to assert it).
With both removed, delete the whole test file.
- **Files:** `src/conductor/test/engine/attribution-validate.test.ts` (delete)
- **Dependencies:** T4
- **Verify:** file gone; no remaining test imports `attribution-validate`.

## T8 — Trim `runAttributionLane` blocks from `attribution-lane.test.ts`
Remove the `runAttributionLane` import and every `describe(...)`/`it(...)` block that drives
`runAttributionLane`. KEEP all blocks exercising surviving machinery (`computeMemoKey`,
`readMemo`, `writeMemo`, `rekeyMemoAfterRebase`, `dispatchAttributionVerifier`) — the file has ~50
references to those survivors. Do not delete the file.
- **Files:** `src/conductor/test/engine/attribution-lane.test.ts`
- **Dependencies:** T5
- **Verify:** `git grep -n 'runAttributionLane' src/conductor/test/engine/attribution-lane.test.ts`
  → empty; surviving-machinery describe blocks intact.

## T9 — Trim gate-behavior blocks from `attribution-conductor-wiring.test.ts`
Remove the `runAttributionLane` import and the blocks that assert removed gate behavior (e.g. the
"satisfied verdict whose citations fail validateCitations → refused → no advance" block and the
end-to-end `runAttributionLane` blocks). KEEP tests of surviving wiring guards
(`checkAttributionMachineryIntact`, `seedAndCheckAttributionMachinery`) if they no longer depend
on the removed gate; if a kept test still references a removed symbol, adjust it to the surviving
behavior. Do not delete the file unless every block proves gate-only (re-check after trimming).
- **Files:** `src/conductor/test/engine/attribution-conductor-wiring.test.ts`
- **Dependencies:** T2, T5
- **Verify:** `git grep -n 'runAttributionLane\|validateCitations' src/conductor/test/engine/attribution-conductor-wiring.test.ts`
  → empty; surviving guard tests still present and green.

## T10 — Remove #535 read-side Story 5/6 blocks from `rebase-translate-acceptance.test.ts`
Remove the `validateCitations` import (line 47) and the two `it(...)` blocks that use it as the
"real read-time consumer" (Story 5, ~286–315; and the forged-citation block, ~316–370). KEEP the
rebase-write/rewrite acceptance blocks (Stories that assert `rebase-rewrites.json` /
`rebase-residue.json` and sidecar rewriting via the real `performRebase` path) — those cover the
LIVE #535 machinery. Update the file header comment that references `validateCitations` as the RED
consumer.
- **Files:** `src/conductor/test/engine/rebase-translate-acceptance.test.ts`
- **Dependencies:** T2
- **Verify:** `git grep -n 'validateCitations\|attribution-validate' src/conductor/test/engine/rebase-translate-acceptance.test.ts`
  → empty; write/rewrite acceptance blocks still present and green.

## T11 — Update README + surviving prose comments
Update `src/conductor/README.md:534` so it no longer names `validateCitations` as a live evidence
consumer (reframe as removed per the #773 demotion). Also fix the prose comments that reference the
removed module/functions: `attribution-lane.ts:407` (`validated citations (attribution-validate.ts)`)
and `rebase-translate.ts:233 / :396` (mentions of `attribution-validate` / `runAttributionLane`) so
they describe current reality.
- **Files:** `src/conductor/README.md`, `src/conductor/src/engine/attribution-lane.ts`,
  `src/conductor/src/engine/rebase-translate.ts`
- **Dependencies:** T2, T4
- **Verify:** `git grep -n 'validateCitations\|runAttributionLane\|attribution-validate' src/conductor/README.md src/conductor/src`
  → no stale live references (only intentional historical notes, if any).

## T12 — Add CHANGELOG `[Unreleased]` entry
Under the existing `## [Unreleased]` (CHANGELOG.md line 11), add a **Removed** bullet: removed the
dead #773 evidence-gate residue — `fileDirMatchesPlanPath`, `validateCitations` (and the emptied
`attribution-validate.ts` + orphaned `loadRewriteMap`), and the inert `runAttributionLane` stub —
plus a **Fixed** bullet for the corrected stale auto-park comment. No `## Migration` block is
required: no `bin/conduct` CLI, hook wiring, `settings.json` schema, or skill-symlink surface
changes (internal engine-only deletions). If the release gate's path classifier flags a breaking
surface, add a `.docs/release-waivers/<plan-stem>.md` waiver in the same diff per CLAUDE.md
(rationale: internal-only dead-code removal, no consumer-visible behavior change). Do NOT bump
`VERSION` (repo memory: version locked until v1).
- **Files:** `CHANGELOG.md` (+ possibly `.docs/release-waivers/remove-773-dead-evidence-gate-residue-filedirmatch.md`)
- **Dependencies:** T1–T6
- **Verify:** `## [Unreleased]` has the new entries.

## T13 — Typecheck + full test suite green
Run the conductor typecheck and the full test suite; fix any residual import/type errors from the
deletions (expected: none beyond the trimmed tests).
- **Files:** (validation only — `src/conductor/**`)
- **Dependencies:** T1–T12
- **Verify:** typecheck passes; `npm test` (conductor suite) passes.

## T14 — Repo integrity suite
Run `test/test_harness_integrity.sh` (validates bash syntax, CHANGELOG structure, VERSION semver,
skill/agent references). Must pass.
- **Files:** (validation only)
- **Dependencies:** T12, T13
- **Verify:** `test/test_harness_integrity.sh` exits 0.

---

## Notes for the builder

- Every deletion is grounded in the track doc's grep evidence; if any `git grep` for a
  "dead" symbol returns a NEW live caller not listed there, STOP and re-confirm before deleting.
- The single behavioral guarantee: the LIVE symbols (`fileMatchesPlanPath`, `resolveThroughMap`,
  `buildRewriteMap`, `translateAfterRebase`, the `attribution-lane.ts` memo/dispatch machinery)
  and all surviving telemetry remain byte-compatible. #535's rebase citation-survival WRITE path
  is unaffected — only its already-dead read-back path is removed.
