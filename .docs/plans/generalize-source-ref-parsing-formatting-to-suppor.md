# Implementation Plan: Generalize source-ref parsing/formatting (GitHub + Jira)

**Date:** 2026-07-22
**Design:** .docs/decisions/adr-2026-07-22-canonical-tagged-source-ref.md (APPROVED); .docs/decisions/architecture-review-2026-07-22-generalize-source-ref-parsing.md (APPROVED)
**Stories:** .docs/stories/generalize-source-ref-parsing-formatting-to-suppor.md (Status: Accepted)
**Conflict check:** Clean as of 2026-07-22 (.docs/conflicts/2026-07-22-generalize-source-ref-parsing.md — 3 degrading resolved, 0 blocking)
**Complexity:** Tier M (.docs/complexity/generalize-source-ref-parsing-formatting-to-suppor.md)
**Source:** intake jstoup111/ai-conductor#847 (refs #774)

## Summary

Build one canonical tagged source-ref module (GitHub `owner/repo#N` + Jira
`PROJ-123`), reimplement `parseSourceRef` as a provably-equivalent GitHub shim,
migrate the two Jira-aware marker sites, and retire five duplicate parsers —
14 tasks.

## Technical Approach

- **New module** `src/conductor/src/engine/engineer/source-ref.ts`: `WorkRef`
  discriminated union, `parseWorkRef` (GitHub semantics copied byte-for-byte
  from today's `parseSourceRef`: lenient repo before LAST `#`, strict digits;
  Jira grammar `^[A-Z][A-Z0-9]+-\d+$`), `formatWorkRef` (lossless round-trip),
  plus two helpers consumers need: `strictSlugGithubRef` (label-sync's stricter
  accepted set, `[\w.-]+/[\w.-]+#\d+`) and `splitOwnerRepo` (backlog-priority's
  owner/repo split).
- **Compat shim:** `issue-ref.ts#parseSourceRef` becomes
  `parseWorkRef(...) → kind === 'github' ? {repo, number} : null`. All 7
  existing consumers untouched; a golden equivalence test over an edge-case
  corpus is the High-impact-risk gate (written BEFORE the shim lands, against
  the current implementation, so the corpus captures pre-change truth).
- **Jira-aware sites** (`intake-marker.ts#writeIntakeMarker` validity check,
  `artifacts.ts#parseIntakeSourceRef` read-back) switch to `parseWorkRef` so
  Jira refs round-trip losslessly through intake markers.
- **Delegating sites** (`label-sync.ts`, `issue-dep-migration.ts`,
  `backlog-priority.ts`, `intake/backfill.ts`) delete their local grammars;
  `pr-labels.ts` keeps its URL regex and adopts the shared return shape.
  `intake/ledger.ts` is untouched (opaque key).
- **Sequencing:** module first (tasks 1–3), shim + equivalence proof (4–5),
  Jira-aware sites (6–8), delegations (9–12), sweep + integration (13),
  changelog/docs (14). Tests live under `src/conductor/test/` mirroring engine
  paths (vitest).

## Prerequisites

None — pure TypeScript; no migrations, config, or new dependencies.

## Tasks

### Task 1: Golden corpus test against the CURRENT parseSourceRef
**Story:** Story 3 — golden equivalence (happy path)
**Type:** infrastructure

**Steps:**
1. Write test `parseSourceRef golden corpus` in `src/conductor/test/engine/engineer/issue-ref.test.ts`: fixture table of edge refs — `acme/app#49`, `a#b#4`, `a/b#01`, `#5`, `a/b#`, `a/b#4x`, `å/ü#7`, `PROJ-123`, `""`, `null`, `undefined`, `" PROJ-123 "`, `A/B#1-2` — with expected outputs captured from the CURRENT implementation (run it once, freeze results as literals).
2. Verify the test passes against today's code (this pins pre-change truth; it is the RED trap for task 5).
3. Commit.

**Files likely touched:**
- src/conductor/test/engine/engineer/issue-ref.test.ts — golden fixture table

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 2: source-ref module — GitHub grammar
**Story:** Story 1 — GitHub happy paths + GitHub malformed negatives
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/source-ref.test.ts`: `parseWorkRef('acme/app#49')` → `{kind:'github',repo:'acme/app',number:'49'}`; malformed GitHub refs (`acme/app#`, `#49`, `acme/app#4x`, empty/null/undefined) → null.
2. Verify RED.
3. Implement `src/conductor/src/engine/engineer/source-ref.ts`: `WorkRef` type + `parseWorkRef` with GitHub branch copied from `issue-ref.ts:30`'s semantics (lastIndexOf `#`, digit check).
4. Verify GREEN. Commit.

**Files likely touched:**
- src/conductor/src/engine/engineer/source-ref.ts — new module
- src/conductor/test/engine/engineer/source-ref.test.ts — new test file

**Wired-into:** src/conductor/src/engine/engineer/issue-ref.ts#parseWorkRef
**Dependencies:** none

> Contract note (as-built, 2026-07-23): originally declared `none (inert until
> issue-ref.ts)` for the sequencing window before Task 5's shim landed. The
> feature is now fully built and `parseWorkRef` (plus the sibling helpers
> `strictSlugGithubRef`/`splitOwnerRepo`/`formatWorkRef` this module exports)
> is reachable from production — `issue-ref.ts#parseSourceRef`,
> `artifacts.ts#parseIntakeSourceRef`, `intake-marker.ts#writeIntakeMarker`,
> `intake/label-sync.ts`, and `backlog-priority.ts`. The declaration is
> reconciled to a real call site.

### Task 3: source-ref module — Jira grammar + disjointness
**Story:** Story 1 — Jira happy paths + Jira negatives + `#`/`/` disjointness
**Type:** happy-path

**Steps:**
1. Write failing tests: `PROJ-123` → `{kind:'jira',key:'PROJ-123'}`; `AB2C-7` → jira; `proj-123`, `P-1`, `PROJ-`, `PROJ-12a` → null; `A/B#1-2` and any ref containing `#` or `/` never yields `kind:'jira'`.
2. Verify RED.
3. Implement: Jira branch with exported grammar constant `^[A-Z][A-Z0-9]+-\d+$`, checked only when the ref contains no `#`.
4. Verify GREEN. Commit.

**Files likely touched:**
- src/conductor/src/engine/engineer/source-ref.ts — Jira branch + constant
- src/conductor/test/engine/engineer/source-ref.test.ts — Jira cases

**Wired-into:** same as Task 2
**Dependencies:** Task 2

### Task 4: formatWorkRef — lossless round-trip
**Story:** Story 2 — round-trip identity + no-trimming negative + malformed-WorkRef guard
**Type:** happy-path

**Steps:**
1. Write failing tests: parse→format identity over a corpus of valid GitHub refs and Jira keys; `" PROJ-123 "` → parseWorkRef null (no trimming); `formatWorkRef({kind:'github',repo:'',number:''})` throws.
2. Verify RED.
3. Implement `formatWorkRef` (github → `${repo}#${number}`, jira → key) with an emit-guard: throw if the output would not re-parse.
4. Verify GREEN. Commit.

**Files likely touched:**
- src/conductor/src/engine/engineer/source-ref.ts — formatWorkRef
- src/conductor/test/engine/engineer/source-ref.test.ts — round-trip property

**Wired-into:** same as Task 2
**Dependencies:** Task 3

### Task 5: parseSourceRef compat shim
**Story:** Story 3 — shim equivalence + Jira → null
**Type:** refactor

**Steps:**
1. Add failing case to `issue-ref.test.ts`: `parseSourceRef('PROJ-123')` → null (already true today — keep as pin), plus assert shim delegates (spy or structural: `issue-ref.ts` no longer contains `lastIndexOf('#')`).
2. Reimplement `parseSourceRef` in `src/conductor/src/engine/engineer/issue-ref.ts` as `const r = parseWorkRef(ref); return r?.kind === 'github' ? {repo:r.repo, number:r.number} : null`.
3. Verify the Task-1 golden corpus still passes byte-identically (GREEN), plus the full suite (`npx vitest run test/engine/engineer`).
4. Commit.

**Files likely touched:**
- src/conductor/src/engine/engineer/issue-ref.ts — shim reimplementation
- src/conductor/test/engine/engineer/issue-ref.test.ts — delegation pin

**Wired-into:** src/conductor/src/engine/engineer/issue-ref.ts#parseSourceRef (reaches all 7 existing consumers: artifacts.ts, gate-writeback.ts, intake-marker.ts, blocker-resolver.ts, intake/file-issue.ts, intake/github-issues.ts, daemon-cli.ts via closeIssueOnImplementationMerge)
**Dependencies:** Task 1, Task 4

### Task 6: Ledger dedup pins for Jira refs
**Story:** Story 3 negatives + Story 5 dedup/idempotency analysis
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/engineer/intake/` ledger test file: same `(source,'PROJ-123')` recorded twice → duplicate recognized; `acme/app#49` vs `PROJ-49` same source → distinct entries; existing GitHub dedup unchanged.
2. Verify they pass with NO change to `intake/ledger.ts` (verify-only for the production side — key is already opaque). If any fails, that is a design-invalidating finding: stop and re-open architecture.
3. Commit (test-only).

**Files likely touched:**
- src/conductor/test/engine/engineer/intake/ledger.test.ts — Jira dedup pins

**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** Task 3

### Task 7: Jira-aware intake marker write
**Story:** Story 4 — marker write happy path + empty-sourceRef no-op + owner-stamp compat
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/intake-marker.test.ts`: `writeIntakeMarker` with `sourceRef:'PROJ-123'` emits `Source-Ref: PROJ-123` verbatim; empty/whitespace sourceRef → no `Source-Ref:` line; run existing stamp-when-owned/omit-when-blank/no-op suite unmodified.
2. Verify RED (Jira case only).
3. Implement: `intake-marker.ts` validity check (line ~51) switches `parseSourceRef` → `parseWorkRef`.
4. Verify GREEN including the untouched owner-stamp assertions. Commit.

**Files likely touched:**
- src/conductor/src/engine/engineer/intake-marker.ts — parseWorkRef at validity check
- src/conductor/test/engine/engineer/intake-marker.test.ts — Jira write cases

**Wired-into:** src/conductor/src/engine/engineer/intake-marker.ts#writeIntakeMarker
**Dependencies:** Task 5

### Task 8: Jira-aware marker read-back
**Story:** Story 4 — read-back happy path + malformed-ref negative
**Type:** happy-path

**Steps:**
1. Write failing tests for `parseIntakeSourceRef` (artifacts tests): content with `Source-Ref: PROJ-123` → `'PROJ-123'`; `Source-Ref: proj_123!` → undefined; GitHub cases unchanged.
2. Verify RED.
3. Implement: `artifacts.ts#parseIntakeSourceRef` validates via `parseWorkRef` instead of `parseSourceRef`; update its docblock (no longer GitHub-only).
4. Verify GREEN. Commit.

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — parseIntakeSourceRef validation
- src/conductor/test/engine/artifacts-intake-marker.test.ts — read-back cases (or the existing artifacts test file covering parseIntakeSourceRef)

**Wired-into:** src/conductor/src/engine/artifacts.ts#parseIntakeSourceRef
**Dependencies:** Task 5

### Task 9: label-sync delegation with unchanged accepted set
**Story:** Story 5 — label-sync delegation + strict-set negative + Jira Depends-on skip
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/acceptance/intake-form-label-sync.test.ts` (or the unit file covering label-sync): Jira ref in Depends-on list → skipped non-fatally, no gh call; a ref the strict regex rejected but lenient grammar accepts (e.g. `a b/c#1`) → still rejected.
2. Verify RED where applicable.
3. Implement: add `strictSlugGithubRef` helper to `source-ref.ts` (regex `^[\w.-]+\/[\w.-]+#\d+$` returning the github WorkRef or null); `label-sync.ts` deletes `SLUG_REF_RE`/`parseSlugRef` and calls the helper.
4. Verify GREEN + existing label-sync suite unchanged. Commit.

**Files likely touched:**
- src/conductor/src/engine/engineer/source-ref.ts — strictSlugGithubRef helper
- src/conductor/src/engine/engineer/intake/label-sync.ts — delegation
- src/conductor/test/acceptance/intake-form-label-sync.test.ts — Jira skip + strict-set pin

**Wired-into:** src/conductor/src/engine/engineer/intake/label-sync.ts#syncIssueLabels
**Dependencies:** Task 5

### Task 10: issue-dep-migration delegation
**Story:** Story 5 — parseRef deletion + Jira skip
**Type:** refactor

**Steps:**
1. Write failing test: Jira ref as dependency edge source/target → skipped non-fatally, no gh API call.
2. Verify RED.
3. Implement: delete local `parseRef` (issue-dep-migration.ts:207); call the shim `parseSourceRef` (GitHub-only site).
4. Verify GREEN + existing suite. Commit.

**Files likely touched:**
- src/conductor/src/engine/engineer/issue-dep-migration.ts — delegation
- src/conductor/test/engine/engineer/issue-dep-migration.test.ts — Jira skip case

**Wired-into:** none (no new production surface)
**Dependencies:** Task 5

### Task 11: backlog-priority delegation + splitOwnerRepo helper
**Story:** Story 5 — parseIssueRef deletion + Jira skip
**Type:** refactor

**Steps:**
1. Write failing tests: `splitOwnerRepo('acme/app')` → `{owner:'acme',repo:'app'}`, invalid slugs → null; backlog-priority label reader with Jira ref → 'not-found'/skip without gh call.
2. Verify RED.
3. Implement: add `splitOwnerRepo` to `source-ref.ts`; `backlog-priority.ts` deletes local `parseIssueRef`, uses shim + helper.
4. Verify GREEN + existing backlog-priority suites. Commit.

**Files likely touched:**
- src/conductor/src/engine/engineer/source-ref.ts — splitOwnerRepo helper
- src/conductor/src/engine/backlog-priority.ts — delegation
- src/conductor/test/backlog-priority.test.ts — Jira skip + split cases

**Wired-into:** src/conductor/src/engine/backlog-priority.ts#ghIssueLabelReader
**Dependencies:** Task 5

### Task 12: backfill + pr-labels alignment
**Story:** Story 5 — backfill parseRef deletion (conflict-resolution addition) + pr-labels return-shape adoption + URL negative
**Type:** refactor

**Steps:**
1. Write failing tests: backfill sweep with a Jira ref → per-issue failure (never HALT), no gh call; `pr-labels.parseIssueRef('https://github.com/PROJ-123/x/pull/9')` parses by URL grammar only.
2. Verify RED where applicable.
3. Implement: `intake/backfill.ts` deletes local `parseRef` (line ~111), calls shim; `pr-labels.ts` types its return as the shared `{repo, number}` shape (import type only — URL regex untouched).
4. Verify GREEN + existing suites. Commit.

**Files likely touched:**
- src/conductor/src/engine/engineer/intake/backfill.ts — delegation
- src/conductor/src/engine/pr-labels.ts — shared return type import
- src/conductor/test/engine/engineer/intake/backfill.test.ts — Jira per-issue failure

**Wired-into:** src/conductor/src/daemon-cli.ts#parseIssueRef
**Dependencies:** Task 5

> Contract note (as-built, 2026-07-23): `pr-labels.ts#parseIssueRef` is an
> existing export whose signature changed (return type now the shared
> `ParsedIssueRef`); the line-diff surfaces the re-added `export` line as a
> "new" surface. It is not new — it is consumed in production by
> `daemon-cli.ts`. Declared at its real consumer site rather than
> `none (no new production surface)`.

### Task 13: Land-with-Jira-ref integration + grammar sweep
**Story:** Story 4 — land integration (marker committed + ledger advanced + writeback skipped); Story 1/5 Done-When greps
**Type:** happy-path

**Steps:**
1. Write failing integration test in `src/conductor/test/engine/engineer/land-spec.test.ts`: `landSpec` with `--source-ref PROJ-123` equivalent → land succeeds, `.docs/intake/<slug>.md` contains `Source-Ref: PROJ-123`, ledger advanced, GitHub comment writeback skipped non-fatally.
2. Verify RED (marker currently drops Jira ref) — if tasks 7–8 already turned it green, keep as pin.
3. Add a sweep test (or CI grep script step) asserting no competing grammar: grep for `lastIndexOf('#')` and `#(\d+)$`-style ref regexes outside `source-ref.ts` finds only `pr-labels.ts`'s URL parser.
4. Verify GREEN. Commit.

**Files likely touched:**
- src/conductor/test/engine/engineer/land-spec.test.ts — Jira land integration
- src/conductor/test/engine/engineer/source-ref.test.ts — grammar-sweep guard

**Wired-into:** none (no new production surface)
**Dependencies:** Task 7, Task 8

### Task 14: CHANGELOG + docs
**Story:** repo release gate (CHANGELOG [Unreleased] required on every PR) + Docs-track-features
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `## [Unreleased]` → Changed: canonical tagged source-ref module; Jira keys (`PROJ-123`) now round-trip through intake markers/ledger; five duplicate parsers retired (no behavior change for GitHub refs). No Migration block (internal-only: no CLI/hook/schema surface change).
2. Update `src/conductor/README.md` engine-module notes if a parser module list exists; note Jira-ref acceptance in `docs/configuration.md` ONLY if it documents Source-Ref grammar (check; skip if absent).
3. Run `test/test_harness_integrity.sh`. Commit.

**Files likely touched:**
- CHANGELOG.md — Unreleased entry
- src/conductor/README.md — module note (if applicable)

**Wired-into:** none (no new production surface)
**Dependencies:** Task 13

## Task Dependency Graph

```
Task 1 ─────────────┐
Task 2 → Task 3 → Task 4 ─→ Task 5 → {Task 7, Task 8, Task 9, Task 10, Task 11, Task 12}
             └→ Task 6                Task 7 ┐
                                      Task 8 ┴→ Task 13 → Task 14
```

(Tasks 9–12 are parallel-safe after Task 5; Task 6 is verify-only after Task 3.)

## Integration Points

- After Task 5: entire existing suite must be green with zero test edits outside the golden corpus — first end-to-end proof of the no-regression contract.
- After Task 8: a Jira ref round-trips claim→marker→read-back in unit scope.
- After Task 13: full land-with-Jira-ref flow proven, grammar sweep locked.

## Verification

- [ ] All happy path criteria covered by at least one task (Stories 1–5 → Tasks 2–4, 7–13)
- [ ] All negative path criteria covered by explicit tasks (Tasks 2–4, 6, 7–13)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every new-surface task carries Wired-into (Tasks 2–4 inert-until shim; Task 5 names all 7 consumers)
