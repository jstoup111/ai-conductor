# Implementation Plan: rebase-orphans-every-sha-anchored-evidence-citatio

**Source:** jstoup111/ai-conductor#535 · **Track:** technical · **Tier:** L
**Stories:** `.docs/stories/rebase-orphans-every-sha-anchored-evidence-citatio.md`
**ADR:** `.docs/decisions/adr-2026-07-12-rebase-evidence-stamp-translation.md`

## Goal

Insert one deterministic translation step inside `performRebase` that maps sha-anchored evidence
(sidecar, task-status, memo) through the engine's own rebase via patch-id correspondence, resolves
immutable satisfied-by trailer targets at read time, surfaces unmappable citations as loud residue,
and never launders an off-branch/forged citation. All work is TDD (RED before GREEN).

## Anchors (verified in worktree, 2026-07-12)

- Rebase engine + insertion point: `src/conductor/src/engine/rebase.ts` — `GitRunner`/`makeGitRunner`
  (22-59), `performRebase` `git rebase --autostash` (412), pre-rebase `preTree`/`mergeBase` (401-402),
  `ORIG_HEAD` snapshot + `{onto}..ORIG_HEAD` (592-594), `featureCommitsPreserved` guard (531-543),
  `applyRebaseVerdicts`.
- Sites (both funnel through `performRebase`): `conductor.ts` `runRebaseStep` (3789-3908, call 3832);
  `daemon-rekick.ts` `resumeRebaseFirst` (313-416, call 361).
- Sidecar: `src/conductor/src/engine/task-evidence.ts` — `EvidenceStamp{sha,citedShas,verdictAnchor}`
  (16-22), atomic `write()` (123-156), `writeJudgedStamps` (181-225); file `.pipeline/task-evidence.json`.
- Task-status: `src/conductor/src/engine/task-seed.ts` `TaskStatusRecord` (32-43), full sha at
  `commit` (213); short sha at `autoheal.ts:202,822,1313`; reconcile `autoheal.ts:1278-1318`;
  path `.pipeline/task-status.json`.
- Memo (#520): `src/conductor/src/engine/attribution-lane.ts` — `computeMemoKey` (85-88),
  `readMemo`/`writeMemo` (112-142), `verdictAnchor:headSha` (480); file `.pipeline/attribution-memo.json`.
- Read-time consumers: `attribution-validate.ts` `validateCitations` (116-191; ancestry 143-147);
  autoheal satisfied-by consume + `isReachable` (`autoheal.ts:602-645`).

Test homes: `src/conductor/test/engine/` (`rebase.test.ts`, `rebase-loop.test.ts`,
`task-evidence.test.ts`, `attribution-lane.test.ts`, `attribution-validate.test.ts`, `autoheal.test.ts`);
new `test/engine/rebase-translate.test.ts`. Run from `src/conductor` with
`rtk proxy npx vitest run <file>` (repo memory: vitest cwd MUST be `src/conductor`).

---

## Task Dependency Graph

```
T1(pin assumptions: patch-id + --empty) ─▶ T2(RED map) ─▶ T3(GREEN buildRewriteMap+persist) ─┐
                                                                                             ├─▶ T14(RED insertion+sites+no-op)
T3 ─▶ T4(RED file-store xlate) ─▶ T5(GREEN applyMapToStores) ───────────────────────────────┤        │
T3 ─▶ T6(RED memo re-key) ─▶ T7(GREEN memo re-key) ─────────────────────────────────────────┤        ▼
T3 ─▶ T8(RED read-time resolve) ─▶ T9(GREEN validateCitations+autoheal resolve) ────────────┤   T15(GREEN wire performRebase)
T3 ─▶ T10(RED residue) ─▶ T11(GREEN residue writer+event) ──────────────────────────────────┤        │
T9 ─▶ T12(RED no-laundering) ─▶ T13(assert no-laundering) ──────────────────────────────────┘        ▼
                                                                          T15 ─▶ T16(docs) ─▶ T17(full suite + integrity + waiver)
```

---

### Task 1 — Pin the two load-bearing assumptions (ADR risks 1 & 2)
**Dependencies:** none
**Files:** `test/engine/rebase-translate.test.ts` (scratch-repo helper)
Author a test that builds a real scratch git repo, rebases a small feature branch onto a moved base,
and asserts: (a) `git patch-id --stable` matches for each unconflicted replayed commit; (b) the
actual `--empty` behavior of `git rebase --autostash` for an already-empty satisfied-by commit
(dropped vs kept). Record the observed `--empty` behavior in the test as the contract. If empties are
dropped, Task 15 adds `--empty=keep` to `performRebase` (verify against `featureCommitsPreserved`).

### Task 2 — RED: `buildRewriteMap` (Story 1)
**Dependencies:** T1
**Files:** `test/engine/rebase-translate.test.ts`
Failing test: given a fake `GitRunner` returning `rev-list {onto}..ORIG_HEAD`, `rev-list {onto}..HEAD`,
and per-sha patch-ids, `buildRewriteMap` returns `{map, residue}` pairing old→new by patch-id, indexes
full + 7-char forms, and lists patch-id-unmatched pre-image shas as residue.

### Task 3 — GREEN: `buildRewriteMap` + transitive persist (Story 1)
**Dependencies:** T2
**Files:** `src/conductor/src/engine/rebase-translate.ts` (new)
Implement `buildRewriteMap(git, onto, origHead, head)` and `persistRewriteMap(projectRoot, map)`
writing `.pipeline/rebase-rewrites.json` with transitive closure (a later `new→newer` repoints prior
values). Add `resolveThroughMap(sha, map)` (transitive; unknown → unchanged). All git via injected
`GitRunner`. Atomic temp+rename.

### Task 4 — RED: file-store translation (Stories 2, 3)
**Dependencies:** T3
**Files:** `test/engine/rebase-translate.test.ts`
Failing tests: `applyMapToStores` rewrites `task-evidence.json` (`sha`, `citedShas[]`, `verdictAnchor`)
and `task-status.json` `commit` (full **and** short forms) via the map; before/after diff shows every
mapped sha updated; unmapped fields untouched.

### Task 5 — GREEN: `applyMapToStores` for sidecar + task-status (Stories 2, 3)
**Dependencies:** T4
**Files:** `rebase-translate.ts`; read/write via `task-evidence.ts` + task-status helpers
Implement in-place rewrite reusing `TaskEvidence.write()` atomic discipline and the task-status
path/short-sha conventions (`task-seed.ts`, `autoheal.ts` slice(0,7)).

### Task 6 — RED: memo re-key (Story 4)
**Dependencies:** T3
**Files:** `test/engine/attribution-lane.test.ts`
Failing test: after an unconflicted rebase (map old→new HEAD, all judged commits matched), the memo
key is recomputed onto the new HEAD and `verdictAnchor` translated, so `readMemo` HITS for the new
HEAD instead of missing.

### Task 7 — GREEN: memo re-key (Story 4)
**Dependencies:** T6
**Files:** `attribution-lane.ts` (or a small hook in `rebase-translate.ts` importing memo helpers)
Translate `verdictAnchor` and recompute the key via `computeMemoKey(newHead, residueIds)`; leave the
key format owned by #520 untouched. If any judged commit is in residue, do NOT re-key (let it miss →
re-judge).

### Task 8 — RED: read-time resolution (Story 5)
**Dependencies:** T3
**Files:** `test/engine/attribution-validate.test.ts`, `test/engine/autoheal.test.ts`
Failing tests: a satisfied-by citation whose target was rewritten resolves through the persisted map
before the `merge-base --is-ancestor` check in `validateCitations`, and the autoheal satisfied-by
consumer resolves likewise; the trailer text is never mutated.

### Task 9 — GREEN: wire `resolveThroughMap` into read-time consumers (Story 5)
**Dependencies:** T8
**Files:** `attribution-validate.ts` (before 136-147), `autoheal.ts:602-645`
Load the persisted map and resolve each cited sha before existence/ancestry; upgrade the autoheal
`isReachable` softer check so a resolved sha is ancestry-checked (no existence-only pass).

### Task 10 — RED: residue surfacing (Story 7)
**Dependencies:** T3
**Files:** `test/engine/rebase-translate.test.ts`
Failing test: a dropped/patch-changed pre-image commit and its citing task ids are written to
`.pipeline/rebase-residue.json` with a reason and a `rebase_citation_residue` structured event is
emitted; nothing is silently repointed.

### Task 11 — GREEN: residue writer + event (Story 7)
**Dependencies:** T10
**Files:** `rebase-translate.ts`
Implement `writeResidue` + event emission (mirror the `rebase_gate_reverified` event pattern).

### Task 12 — RED: no-laundering negative (Story 8)
**Dependencies:** T9
**Files:** `test/engine/attribution-validate.test.ts`
Failing test: a citation sha never in any pre-image set (unrelated/forged) is NOT a map key,
`resolveThroughMap` returns it unchanged, and `validateCitations` still refuses it via ancestry.

### Task 13 — Assert no-laundering holds (Story 8)
**Dependencies:** T12
**Files:** (assertion; likely no product change — the map-key gate already enforces it)
Confirm the invariant is structural; if a hole exists, close it in `resolveThroughMap` (never map a
non-key sha). Add the assertion to the module contract test.

### Task 14 — RED: insertion point, both sites, no-op guard (Stories 6, 9)
**Dependencies:** T3
**Files:** `test/engine/rebase.test.ts`, `test/engine/rebase-loop.test.ts`
Failing tests: on a `changed` outcome `performRebase` invokes translation; on `unchanged`/`noop` or
with the capability absent it does NOT; both `runRebaseStep` and `resumeRebaseFirst` paths exercise it.

### Task 15 — GREEN: wire `translateAfterRebase` into `performRebase` (Stories 6, 9)
**Dependencies:** T5, T7, T9, T11, T13, T14
**Files:** `rebase.ts` (after 412, `changed` branch; uses existing `ORIG_HEAD` + new HEAD)
Call `translateAfterRebase(git, projectRoot, onto, origHead, head)` → build map → apply stores →
memo re-key → write residue → persist map, BEFORE `applyRebaseVerdicts`. Guard on `changed` +
injected capability (absent → no-op, byte-identical to today). If Task 1 found empties are dropped,
add `--empty=keep` to the rebase invocation here.

### Task 16 — Docs (README + src README + CHANGELOG)
**Dependencies:** T15
**Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md` (`[Unreleased] > Added/Fixed`)
Document the post-rebase evidence translation, the `.pipeline/rebase-rewrites.json` /
`rebase-residue.json` artifacts, and the residue signal. Add the `[Unreleased]` entry (CI-enforced).

### Task 17 — Full suite + harness integrity + migration-gate check
**Dependencies:** T16
**Files:** —
`rtk proxy npx vitest run` (from `src/conductor`); `test/test_harness_integrity.sh`. Confirm the diff
touches no `bin/conduct CLI`/`settings.json schema`/`skill symlink targets`/`hook wiring`; if the
release-gate classifier flags a surface, commit an internal-only waiver per
adr-2026-07-06-migration-gate-waiver (patch-id path adds no hook, so a real migration block should not
be needed).

---

## Verification (end-to-end)

- **Unit/integration:** all new tests green from `src/conductor` (`rtk proxy npx vitest run`).
- **Real rebase E2E (Task 1 harness, extended):** in a scratch repo, seed `task-evidence.json`,
  `task-status.json`, `attribution-memo.json`, and a satisfied-by empty commit; move the base; run the
  real `performRebase`; assert (a) sidecar/status/memo shas all repointed (diff before/after),
  (b) the satisfied-by citation validates against the new HEAD, (c) a deliberately dropped commit lands
  in `rebase-residue.json`, (d) a forged sha is still refused.
- **Both sites:** exercise `runRebaseStep` and `resumeRebaseFirst` in `rebase-loop.test.ts` and assert
  identical post-rebase translation.
- **Regression:** `unchanged`/capability-absent paths byte-identical; `test/test_harness_integrity.sh`
  passes.
