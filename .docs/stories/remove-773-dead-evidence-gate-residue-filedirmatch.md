# Stories: Remove #773 dead evidence-gate residue and fix stale auto-park comment

**Source:** jstoup111/ai-conductor#792
**Track:** Technical • **Tier:** Small
**Status: Accepted**

Because this is a headless engine change with no runtime behavior change (all removed code is
dead), the acceptance signals are grep/typecheck/test-suite outcomes rather than HTTP/UI flows.

---

## Story 1 — Remove the orphaned corroboration helper `fileDirMatchesPlanPath`

As a harness maintainer, I want the fully-orphaned `fileDirMatchesPlanPath` helper removed so
the just-simplified completion path carries no dead corroboration code.

**Acceptance criteria**

- **Happy path**
  - **Given** `fileDirMatchesPlanPath` in `src/conductor/src/engine/autoheal.ts` has zero
    callers anywhere in `src/conductor` (prod + tests),
  - **When** the helper (and its doc comment) is deleted,
  - **Then** `git grep -n 'fileDirMatchesPlanPath' src/conductor` returns nothing, and
    typecheck + full suite pass.
- **Negative / guard path**
  - **Given** the sibling `fileMatchesPlanPath` is live via the `derive-feedback` →
    `checkCommitEvidence` → `filesOverlappingTaskPaths` chain,
  - **When** the deletion is made,
  - **Then** `fileMatchesPlanPath` still resolves and is untouched
    (`git grep -n 'export function fileMatchesPlanPath' src/conductor/src/engine/autoheal.ts`
    still matches), and the `derive-feedback` code path is unaffected.

---

## Story 2 — Remove the dead per-task citation validator `validateCitations` (and empty its module)

As a harness maintainer, I want the dead `validateCitations` gate function removed, along with
the helper it was the sole consumer of (`loadRewriteMap`) and the module that becomes empty of
live code, so no evidence-gate residue remains.

**Acceptance criteria**

- **Happy path**
  - **Given** `validateCitations` has no production caller (only test + prose-comment refs),
    and `attribution-validate.ts` is imported by no production module,
  - **When** `validateCitations` is removed and — because the file then holds only unused
    validation interfaces + private helpers — the whole `attribution-validate.ts` file is
    deleted,
  - **Then** `git grep -n 'validateCitations' src/conductor/src` returns nothing, and
    `git grep -rn "attribution-validate" src/conductor/src` shows no live import (prose
    comments referencing it are updated or removed).
- **Knock-on cleanup path**
  - **Given** `loadRewriteMap` (rebase-translate.ts) had `validateCitations` as its ONLY
    production consumer,
  - **When** `validateCitations` is removed,
  - **Then** `loadRewriteMap` is also removed, and
    `git grep -n 'loadRewriteMap' src/conductor/src` returns nothing.
- **Negative / must-not-regress path**
  - **Given** `resolveThroughMap`, `buildRewriteMap`, and `translateAfterRebase` are live
    #535 rebase machinery,
  - **When** `validateCitations` and `loadRewriteMap` are removed,
  - **Then** those three symbols are untouched and still wired into `performRebase`
    (`git grep -n 'translateAfterRebase' src/conductor/src/engine/conductor.ts` still
    matches), and the rebase step still writes/rewrites the sidecar as before.

---

## Story 3 — Remove the inert `runAttributionLane` stub and its orphaned types

As a harness maintainer, I want the inert `runAttributionLane` dispatch stub and its
now-orphaned option/result types removed, while the surviving memo/rebase machinery in the same
file is preserved.

**Acceptance criteria**

- **Happy path**
  - **Given** `runAttributionLane` never gates and never stamps (empty stamped list on every
    path) and has no production caller,
  - **When** `runAttributionLane` and its orphaned types `RunAttributionLaneOptions` /
    `AttributionLaneResult` are removed,
  - **Then** `git grep -n 'runAttributionLane' src/conductor/src` returns nothing.
- **Negative / must-not-regress path**
  - **Given** `attribution-lane.ts` also holds live rebase-memo machinery
    (`computeMemoKey`, `readMemo`, `writeMemo`, `rekeyMemoAfterRebase`,
    `dispatchAttributionVerifier`),
  - **When** the stub is removed,
  - **Then** the file is NOT deleted and those five symbols remain exported and unchanged
    (`git grep -n 'export.*\(computeMemoKey\|dispatchAttributionVerifier\)' src/conductor/src/engine/attribution-lane.ts`
    still matches).

---

## Story 4 — Correct the stale auto-park comment in `conductor.ts`

As a harness maintainer, I want the comment at `conductor.ts:~1583` corrected so it no longer
claims the evidence sidecar feeds an auto-park trigger that #773 removed.

**Acceptance criteria**

- **Happy path**
  - **Given** #773 removed the no-evidence auto-park path,
  - **When** the comment is rewritten to describe current behavior (the sidecar is a durable
    telemetry record of consecutive gate-miss counts; it no longer feeds any auto-park
    trigger),
  - **Then** `git grep -n 'auto-park trigger' src/conductor/src/engine/conductor.ts` no longer
    references a removed no-evidence park trigger, and the surrounding code is unchanged.

---

## Story 5 — Keep the test suite and typecheck green after the deletions

As a harness maintainer, I want the tests that asserted the deleted evidence gate removed or
trimmed so the suite compiles and passes, without dropping coverage of surviving machinery.

**Acceptance criteria**

- **Happy path (whole-file removals)**
  - **Given** `attribution-validate.test.ts` exercises only the removed `validateCitations`
    (and imports `loadRewriteMap` only to assert it),
  - **When** that test file is deleted,
  - **Then** no remaining test imports `validateCitations` or `attribution-validate`.
- **Surgical-removal path**
  - **Given** `attribution-lane.test.ts` and `attribution-conductor-wiring.test.ts` mix
    doomed `runAttributionLane`/`validateCitations` blocks with tests of SURVIVING machinery
    (memo/dispatch; `checkAttributionMachineryIntact` / `seedAndCheckAttributionMachinery`),
  - **When** only the `it(...)`/`describe(...)` blocks and imports that exercise the removed
    symbols are removed,
  - **Then** the surviving-machinery tests remain and still pass, and
    `git grep -n 'runAttributionLane\|validateCitations' src/conductor/test` shows no remaining
    live references to the removed production symbols.
- **#535 coverage-removal path**
  - **Given** `rebase-translate-acceptance.test.ts` Story 5/6 (`it(...)` blocks, ~lines
    286–370) use `validateCitations` as the read-time consumer, and no surviving production
    consumer resolves through the rewrite map,
  - **When** those two `it(...)` blocks and the `validateCitations` import are removed,
  - **Then** the remaining `#535` rebase-write/rewrite acceptance blocks still pass, and the
    file no longer imports `attribution-validate`.
- **Negative / green-suite gate**
  - **Given** all deletions above are applied,
  - **When** the full test suite and typecheck run,
  - **Then** both pass with no module-resolution or type errors.

---

## Story 6 — Update documentation and CHANGELOG

As a harness maintainer, I want the docs and CHANGELOG updated in the same PR so they don't
reference removed symbols (per the repo's "Docs track features" rule).

**Acceptance criteria**

- **Happy path**
  - **Given** `src/conductor/README.md:534` names `validateCitations` as an evidence consumer,
  - **When** that reference is updated to reflect the demotion (validator removed; citations
    no longer re-validated as a gate),
  - **Then** `git grep -n 'validateCitations' src/conductor/README.md` returns nothing (or a
    corrected historical note), and a `## [Unreleased]` **Removed** entry is added to
    `CHANGELOG.md` naming the deleted dead evidence-gate residue.
- **Negative path**
  - **Given** the repo integrity suite validates CHANGELOG structure,
  - **When** the CHANGELOG entry is added under the existing `## [Unreleased]` (line 11),
  - **Then** `test/test_harness_integrity.sh` still passes.
