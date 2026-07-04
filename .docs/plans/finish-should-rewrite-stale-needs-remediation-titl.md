# Implementation Plan: finish-time rehabilitation of reused needs-remediation halt PRs

**Date:** 2026-07-03
**Design:** `.docs/decisions/adr-2026-07-03-halt-pr-rehabilitation-at-finish.md` (APPROVED)
**Stories:** `.docs/stories/finish-should-rewrite-stale-needs-remediation-titl.md` (Accepted)
**Conflict check:** Clean as of 2026-07-03 (`.docs/conflicts/2026-07-03-halt-pr-rehabilitation.md`)
**Issue:** jstoup111/ai-conductor#271

## Summary

16 tasks: a new engine module `rehabilitateHaltPr` (ready-flip + label clear,
composing existing `pr-labels.ts` primitives), a fail-open presentation check
added to the finish completion predicate, skill-contract wording in
`/finish`+`/pr`, and unit + acceptance coverage for every negative path.

## Technical Approach

- **Detection (stateless):** a halt signal is a title prefixed
  `needs-remediation:` OR the `needs-remediation` label — never draft status
  alone (early-draft PR-timing PRs, #199, must not match) and never config or
  local-marker state. One `gh pr view --json title,isDraft,labels` read feeds
  both detection and the "is a ready-flip still needed" facet.
- **New engine module** `src/conductor/src/engine/halt-pr-rehabilitation.ts`:
  `rehabilitateHaltPr({ gh, prUrl, cwd, log })` → discriminated outcome
  `'not-halt-pr' | 'rehabilitated' | 'partial' | 'gh-unavailable'`. Composes
  `setReady` + `removeLabel` from `pr-labels.ts` with injected runners.
  Warn-only: each mutation failure logs and continues; never throws.
  `Closes` injection stays with the EXISTING `closeIssueOnImplementationMerge`
  call in the daemon tail (`daemon-cli.ts:335`) — `injectIssueRef` is
  idempotent, so "exactly once" holds without moving it.
- **Gate:** the `finish` predicate in `artifacts.ts` (choice=`pr` branch,
  after the `pr_url` check) reads the PR title via an injectable gh runner on
  `CompletionContext` (production default). FAIL only when a successful read
  shows a `needs-remediation:` title prefix; any read failure (non-zero exit,
  malformed JSON) logs a warning and PASSES (fail-open, per review Condition
  1). Non-`pr` choices never invoke gh.
- **Skills:** `/finish` Option 2 and `/pr` gain an explicit rehabilitation
  instruction: existing PR with `needs-remediation:` title → full
  `gh pr edit --title --body` regeneration; comment thread untouched.
- **Sequencing:** engine module first (pure, injected-runner TDD), then the
  gate seam, then wiring, then skill wording + acceptance + docs.

## Prerequisites

- None — all primitives (`setReady`, `removeLabel`, `injectIssueRef`) exist
  on main; no migrations, no config keys, no new packages.

## Tasks

### Task 1: Halt-signal detection helper
**Story:** Story 4 (stateless detection); Story 3 no-op negative
**Type:** happy-path
**Steps:**
1. Write failing tests for `readHaltPrState(gh, prUrl, cwd)` in new
   `test/engine/halt-pr-rehabilitation.test.ts`: (a) stale title + label +
   draft → `{halt: true, isDraft: true, hasLabel: true}`; (b) label only,
   clean title → `halt: true`; (c) clean title, no label, **draft: true**
   (early-draft case) → `halt: false`; (d) clean everything → `halt: false`.
2. RED → implement in `src/conductor/src/engine/halt-pr-rehabilitation.ts`
   using one `gh pr view --json title,isDraft,labels` call → GREEN → commit.
**Files:** `src/conductor/src/engine/halt-pr-rehabilitation.ts`,
`src/conductor/test/engine/halt-pr-rehabilitation.test.ts`
**Dependencies:** none

### Task 2: gh read failure → 'gh-unavailable'
**Story:** Story 3 negative (deleted/closed PR, gh outage)
**Type:** negative-path
**Steps:** failing test: gh view rejects / returns unparseable JSON →
`rehabilitateHaltPr` returns `'gh-unavailable'`, zero mutation calls, one
warn log. RED → implement → GREEN → commit.
**Files:** same as Task 1
**Dependencies:** Task 1

### Task 3: rehabilitation happy path (ready-flip + label clear)
**Story:** Story 3 happy
**Type:** happy-path
**Steps:** failing test with injected gh spies: halt signal + draft + label →
`setReady` called once, `removeLabel('needs-remediation')` called once,
outcome `'rehabilitated'`. RED → implement composition → GREEN → commit.
**Files:** same as Task 1
**Dependencies:** Task 1

### Task 4: no halt signal → no-op
**Story:** Story 3 negative (never-halted PR; early-draft PR)
**Type:** negative-path
**Steps:** failing test: clean title + no label (draft and non-draft
variants) → outcome `'not-halt-pr'`, ZERO gh mutations (spies assert no
calls). RED → implement → GREEN → commit.
**Files:** same as Task 1
**Dependencies:** Task 3

### Task 5: setReady failure → warn, continue, 'partial'
**Story:** Story 3 negative (gh pr ready 403)
**Type:** negative-path
**Steps:** failing test: `setReady` rejects → `removeLabel` STILL called,
outcome `'partial'`, warn logged, no throw. RED → implement per-mutation
try/catch → GREEN → commit.
**Files:** same as Task 1
**Dependencies:** Task 3

### Task 6: removeLabel failure → warn, continue, 'partial'
**Story:** Story 3 negative (REST label failure)
**Type:** negative-path
**Steps:** failing test: `removeLabel` rejects → outcome `'partial'`, ready
flip unaffected, warn logged, no throw. RED → implement → GREEN → commit.
**Files:** same as Task 1
**Dependencies:** Task 5

### Task 7: idempotent re-run
**Story:** Story 3 negative (re-kick / repeated finish)
**Type:** negative-path
**Steps:** failing test: halt LABEL present but PR already ready →
`setReady` NOT called (isDraft=false), label removed; second run with label
gone + clean state → `'not-halt-pr'`, zero mutations. RED → implement
facet-conditional mutations → GREEN → commit.
**Files:** same as Task 1
**Dependencies:** Task 3

### Task 8: wire the daemon post-run tail
**Story:** Story 3 Done When (call site)
**Type:** infrastructure
**Steps:** failing test (daemon-cli wiring level, mirroring
`daemon-cli-priority-wiring.test.ts` patterns): after `conductor.run()` with
a recorded `pr_url`, `rehabilitateHaltPr` is invoked with that URL beside
`closeIssueOnImplementationMerge`; no `pr_url` → not invoked. RED → add the
call in `daemon-cli.ts` (~line 335 block) → GREEN → commit.
**Files:** `src/conductor/src/daemon-cli.ts`,
`src/conductor/test/engine/daemon-cli-priority-wiring.test.ts` (or a new
sibling wiring test)
**Dependencies:** Tasks 3–7

### Task 9: missing sourceRef leaves Closes path untouched
**Story:** Story 3 negative (no sourceRef)
**Type:** negative-path
**Steps:** failing test at the tail level: item without `sourceRef` →
`closeIssueOnImplementationMerge` returns `'no-source-ref'` (existing
behavior, regression-pinned) while rehabilitation still runs ready/label.
RED → assert (no production change expected — pin behavior) → GREEN → commit.
**Files:** wiring test from Task 8
**Dependencies:** Task 8

### Task 10: CompletionContext gh seam
**Story:** Story 2 Done When (injectable gate reads)
**Type:** infrastructure
**Steps:** failing test: `finish` predicate with choice=`merge-local` /
`keep` / `discard` never touches the injected gh spy. RED → add optional
`gh` to `CompletionContext` (production default wired in conductor) →
GREEN → commit.
**Files:** `src/conductor/src/engine/artifacts.ts`,
`src/conductor/src/engine/conductor.ts` (context construction),
`src/conductor/test/engine/artifacts.test.ts`
**Dependencies:** none (parallel to Tasks 1–9)

### Task 11: gate fails on stale title
**Story:** Story 2 happy (stale title → step FAILS naming the title)
**Type:** happy-path
**Steps:** failing test: choice=`pr` + `pr_url` + gh returns
`needs-remediation:` title → `{done: false}` with reason containing the
stale title; clean title → `{done: true}`. RED → implement title check after
the existing `pr_url` check → GREEN → commit.
**Files:** `artifacts.ts`, `artifacts.test.ts`
**Dependencies:** Task 10

### Task 12: gate fail-open on read errors
**Story:** Story 2 negatives (gh exits non-zero; unparseable JSON)
**Type:** negative-path
**Steps:** failing tests: gh rejects → `{done: true}` + warn; malformed JSON
→ `{done: true}` + warn; never throws. RED → implement → GREEN → commit.
**Files:** `artifacts.ts`, `artifacts.test.ts`
**Dependencies:** Task 11

### Task 13: retry-exhaustion HALT reason (regression pin)
**Story:** Story 2 negative (bounded burn)
**Type:** negative-path
**Steps:** failing test at conductor level: finish step failing the
completion check 3× surfaces the stale-presentation reason in the HALT (uses
existing retry-cap machinery — no new production code expected; pin the
reason text flows through). GREEN → commit.
**Files:** existing conductor completion-check test file
**Dependencies:** Task 11

### Task 14: skill contract wording
**Story:** Story 1 (all criteria)
**Type:** infrastructure
**Steps:** add the rehabilitation step to `skills/finish/SKILL.md` Option 2
and `skills/pr/SKILL.md` ("If PR already exists" section): detect
`needs-remediation:` title prefix → regenerate title+body via
`gh pr edit` exactly as for a fresh PR; never edit comments; body must not
retain halt boilerplate. Run `test/test_harness_integrity.sh`. Commit.
**Files:** `skills/finish/SKILL.md`, `skills/pr/SKILL.md`
**Dependencies:** none

### Task 15: acceptance test — halt → finish → indistinguishable PR
**Story:** Stories 1–4 end-to-end; ADR acceptance sketch
**Type:** happy-path
**Steps:** failing acceptance test
`test/acceptance/halt-pr-rehabilitation.acceptance.test.ts` with injected
runners simulating a halt-born PR (stale title/label/draft): drive the finish
completion check + post-run tail; assert final PR state = clean title
accepted by gate, ready, label removed, `Closes` present exactly once (via
existing tail call), and the early-draft variant unmodified. RED → GREEN
(wiring already built) → commit.
**Files:** `src/conductor/test/acceptance/halt-pr-rehabilitation.acceptance.test.ts`
**Dependencies:** Tasks 8, 11, 12
**Integration point:** full feature verifiable here.

### Task 16: docs + changelog
**Story:** repo Documentation Upkeep rule
**Type:** infrastructure
**Steps:** document the rehabilitation behavior in `src/conductor/README.md`
(daemon finish tail) + root `README.md` (halt/remediation lifecycle); add
`CHANGELOG.md` `[Unreleased]` → Fixed entry citing #271. Run
`test/test_harness_integrity.sh` + full vitest (`rtk proxy npx vitest run`
in `src/conductor`). Commit.
**Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** Tasks 1–15

## Task Dependency Graph

```
T1 ─▶ T2
T1 ─▶ T3 ─▶ T4
      T3 ─▶ T5 ─▶ T6
      T3 ─▶ T7
T3..T7 ─▶ T8 ─▶ T9
T10 ─▶ T11 ─▶ T12
       T11 ─▶ T13
T14 (independent)
T8 + T11 + T12 ─▶ T15 ─▶ T16
```

## Integration Points

- After Task 8: engine tail behavior testable end-to-end with injected runners.
- After Task 12: gate behavior complete (strict-on-read, fail-open-on-error).
- After Task 15: whole feature demonstrable (the ADR acceptance sketch).

## Coverage

| Story criterion | Task(s) |
|---|---|
| S1 title/body rewrite + boilerplate gone | T14 (skill), T15 (assert) |
| S1 comment thread untouched | T14, T15 |
| S1 never-halted PR → normal /pr path | T14, T4 |
| S1 no duplicate Closes after body regen | T15 (injectIssueRef idempotency) |
| S2 clean title passes / stale title fails naming title | T11 |
| S2 gh error → warn+pass; malformed JSON → warn+pass | T12 |
| S2 non-pr choices make no gh call | T10 |
| S2 bounded retries → HALT with stale reason | T13 |
| S3 ready+label+Closes happy | T3, T8, T15 |
| S3 mergeable-sweep FR-12 un-starved | T15 (label-absent final state) |
| S3 no-op on no halt signal (incl. early-draft) | T4 |
| S3 setReady / removeLabel failure → 'partial', warn-only | T5, T6 |
| S3 no sourceRef → no Closes attempt | T9 |
| S3 idempotent re-run | T7 |
| S3 deleted/closed PR → 'gh-unavailable' | T2 |
| S4 stateless, observable-state-only detection | T1, T4 (asserted via injected state alone) |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by explicit tasks (T2, T4–T7, T9, T12, T13)
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
