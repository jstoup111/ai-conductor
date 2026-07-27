# Implementation Plan: Intake label authority — no contradictory duplicate priority:/size: labels (#889)

**Date:** 2026-07-23
**Design:** .docs/decisions/adr-2026-07-23-intake-label-authority-scoped-replace.md (APPROVED); .docs/decisions/architecture-review-2026-07-23-intake-label-authority.md (APPROVED WITH CONDITIONS 1–4)
**Stories:** .docs/stories/intake-issues-get-contradictory-duplicate-priority.md (Accepted, TR-1..TR-5)
**Conflict check:** Clean as of 2026-07-23 (zero blocking; .docs/conflicts/2026-07-23-intake-label-authority.md)
**Architecture:** .docs/architecture/intake-issues-get-contradictory-duplicate-priority.md
**Source:** jstoup111/ai-conductor#889
**Complexity:** M (.docs/complexity/intake-issues-get-contradictory-duplicate-priority.md)

## Summary

Gives `syncIssueLabels` a label-authority contract (explicit > existing > default) and a
namespace-scoped convergent write, teaches `bin/intake-file` to emit the `### Priority` /
`### Size` shape the workflow's parser already understands, adds a dry-run-by-default
dedupe sweep for the 23 already-affected issues, and corrects the workflow header that
documents behavior the code never implemented. 9 tasks.

## Technical Approach

- **Seam-local change.** All resolution logic lands in
  `src/conductor/src/engine/engineer/intake/label-sync.ts`. The three consumers
  (`scripts/intake-label-sync-apply.mts`, `bin/intake-file`, `bin/intake-backfill`) inherit
  it; none gets its own copy of the rule.
- **New read.** The seam gains one `gh api repos/{o}/{r}/issues/{n}/labels` GET through the
  injected `GhRunner` before it writes. Failure of that read degrades to today's additive
  behavior for the explicit value and issues **no** deletes (never remove on a blind read).
- **Reuse, don't invent.** `ensureLabel` / `addLabel` / `removeLabel` /
  `restRemoveLabelArgs` all already exist in `pr-labels.ts`. No new REST idiom, no new
  export added to `pr-labels.ts`, no signature changed there (keeps `conductor.ts`'s
  existing import untouched — see conflict note 3).
- **Producer-side adaptation.** `extractField`'s regex in `intake-label-sync-apply.mts` is
  **not touched** in this diff. `file-issue.ts` appends the two headings to the body it
  submits, so one parser serves two producers and the issue-form path cannot regress.
- **Not modified:** `parsePriorityLabels` / `parseSizeLabel` in `backlog-priority.ts`
  (highest-rank tolerance stays as defence in depth — conflict note 1).
- **Ordering:** the seam contract (Tasks 1–3) lands before any consumer change, so each
  consumer task is a thin hookup with the semantics already tested.

## Prerequisites

None. No dependency, no config key, no schema change. `gh` CLI behavior unchanged.

## Task Dependency Graph

```
Task 1 (RED: authority + scoped-replace acceptance tests)
  └─▶ Task 2 (resolveLabelAuthority)
        └─▶ Task 3 (scoped-replace apply + read + failure isolation)
              ├─▶ Task 4 (intake-file emits ### Priority / ### Size)
              │     └─▶ Task 5 (convergence/either-order test)
              ├─▶ Task 6 (dedupe sweep in backfill.ts)
              │     └─▶ Task 7 (--dedupe CLI flag, dry-run default)
              └─▶ Task 8 (workflow header + module docs + docs/ + CHANGELOG)
                    └─▶ Task 9 (integrity suite + full-suite green)
```

## Tasks

### Task 1: RED — rewrite the false-green idempotency test and add the authority/scoped-replace cases
**Story:** TR-1, TR-2 (Condition 1)
**Type:** test

**Steps:**
1. In `src/conductor/test/acceptance/intake-form-label-sync.test.ts`, rewrite "re-edit with identical values is idempotent" to the case that actually breaks: the issue already carries `size: S`, the seam is called with **no** parsed size, and the assertion is that the end state holds exactly one `size:` label and it is `size: S`
2. Extend the test's `makeFakeGh` to model issue state: record applied AND removed labels, serve `gh api repos/.../labels` GET from that state, and expose the resulting label set
3. Add cases: explicit beats existing; existing beats default; empty namespace gets the default; out-of-vocab/case-variant input falls through to existing then default; two non-default labels are left untouched and reported unresolved; `engineer:handled` + `blocked_by:#123` survive a sync
4. Verify all new/rewritten cases FAIL against current `main` (RED) — record the failure output; the rewritten idempotency case must be shown failing pre-fix, per Condition 1
5. Commit: "test(label-sync): RED — label authority ladder + namespace-scoped replace"

**Files:**
- src/conductor/test/acceptance/intake-form-label-sync.test.ts — rewrite + extend

---

### Task 2: Add `resolveLabelAuthority` to the seam
**Story:** TR-1
**Type:** feature

**Steps:**
1. Write failing unit test for a pure `resolveLabelAuthority(parsed, currentLabels, vocab, defaultValue)` returning `{ winner, authority: 'explicit'|'existing'|'default' } | { unresolved: true, candidates }`
2. Verify RED
3. Implement in `label-sync.ts`: parsed-and-in-vocab → explicit; else filter `currentLabels` to the namespace and parse members — exactly one → existing; more than one with exactly one non-default → existing (the non-default); two or more non-default → unresolved; none → default. Keep the namespace prefixes (`priority: ` / `size: `) and `PRIORITY_VALUES` / `SIZE_VALUES` as the single vocabulary source
4. Verify GREEN
5. Commit: "feat(label-sync): resolveLabelAuthority — explicit > existing > default"

**Files:**
- src/conductor/src/engine/engineer/intake/label-sync.ts — new exported pure function
- src/conductor/test/unit/label-sync-authority.test.ts — new

---

### Task 3: Wire the seam to read current labels and apply a namespace-scoped replace
**Story:** TR-1, TR-2
**Type:** feature

**Steps:**
1. Confirm Task 1's acceptance cases are still RED
2. Implement: add a `getIssueLabels` read via the injected `gh` runner (`api repos/{repo}/issues/{n}/labels`, JSON-parsed, non-throwing → `undefined` on failure); feed it plus the parsed fields into `resolveLabelAuthority` per namespace; `ensureLabel` + `addLabel` the winner; then `removeLabel` each *other* current label matching `^priority: ` / `^size: `
3. Guard: if the read returned `undefined`, skip ALL deletes and fall back to today's additive apply of the explicit value only (Condition: a read failure never removes a label). If a namespace is `unresolved`, touch neither its add nor its delete
4. Extend `SyncIssueLabelsResult` with `priorityAuthority` / `sizeAuthority` and an `unresolved: string[]`; keep `priorityDefaulted` / `sizeDefaulted` populated and consistent (derive them from the authority) so no caller breaks
5. Keep every gh call inside the existing non-throwing try/catch — the process must still exit 0 on any failure
6. Verify GREEN, including that no code path constructs a `PUT .../labels` call (grep assertion in the test)
7. Commit: "fix(label-sync): namespace-scoped convergent label replace (#889)"

**Files:**
- src/conductor/src/engine/engineer/intake/label-sync.ts — read + scoped replace + result fields
- src/conductor/test/acceptance/intake-form-label-sync.test.ts — now green

---

### Task 4: `bin/intake-file` renders `### Priority` / `### Size` into the issue body
**Story:** TR-3
**Type:** feature

**Steps:**
1. Write failing test: `fileIntakeIssue` with `size: 'S'`, `priority: 'high'` produces a `gh issue create --body` argument whose text, when passed through the apply script's `extractField`, yields `high` and `S`; and the original body content is preserved intact ahead of the appended headings
2. Verify RED
3. Implement in `file-issue.ts`: after size/priority resolution and before `gh issue create`, append `\n\n### Priority\n\n<priority>\n\n### Size\n\n<size>\n` to `opts.body`. Resolution order (given ▸ prompt ▸ infer ▸ default) is unchanged — only the submitted body changes
4. Verify GREEN; confirm `extractField` in `intake-label-sync-apply.mts` shows **no diff**
5. Commit: "feat(intake-file): emit ### Priority / ### Size so the sync parses CLI-filed bodies"

**Files:**
- src/conductor/src/engine/engineer/intake/file-issue.ts — body rendering
- src/conductor/test/unit/file-issue.test.ts (or existing equivalent) — new case

---

### Task 5: Pin the convergence invariant (either write order yields the same labels)
**Story:** TR-3 (Condition 3)
**Type:** test

**Steps:**
1. Write a test that models both writers against one fake issue: (a) CLI apply then workflow apply, (b) workflow apply then CLI apply, both starting from the CLI-rendered body
2. Assert the two final label sets are identical and each namespace holds exactly one label matching the CLI's reported values
3. Add the issue-form regression case: an `edited` run where the form's Priority changed `low` → `critical` ends with `priority: critical` only
4. Verify GREEN; confirm the pre-existing issue-form acceptance tests pass **unmodified**
5. Commit: "test(label-sync): convergence under either write order; form-edit override"

**Files:**
- src/conductor/test/acceptance/intake-form-label-sync.test.ts — convergence cases

---

### Task 6: Dedupe sweep in `backfill.ts`, selecting on namespace cardinality
**Story:** TR-4
**Type:** feature

**Steps:**
1. Write failing test over a fixture reproducing all 23 observed combinations (e.g. `P[high|medium] S[M]`, `P[medium|low] S[S|M]`, `P[medium] S[M|L]`, `P[medium|critical] S[M|L]`): after the sweep each issue holds exactly one `priority:` and one `size:` label and the non-default value is retained in every case, with zero `unresolved` entries
2. Verify RED — and specifically assert the current `backfill.ts` skip predicate would have skipped all of them (it treats a parsed value as "already labelled"), documenting F4
3. Implement `dedupeIssueLabels` in `backfill.ts`: select issues where a namespace's label count > 1 (NOT the existing has-a-parsed-value predicate); resolve each via `resolveLabelAuthority` with no parsed field; remove the losers via `removeLabel`; skip and record any `unresolved` namespace; preserve the existing per-issue failure isolation and the "never HALT" contract
4. Add negative cases: two non-default labels → untouched + listed unresolved; one issue's delete failure does not stop the sweep; a clean issue is skipped with zero gh calls; a second run is a no-op
5. Verify GREEN
6. Commit: "feat(backfill): dedupe duplicated priority:/size: namespaces"

**Files:**
- src/conductor/src/engine/engineer/intake/backfill.ts — new sweep + report fields
- src/conductor/test/acceptance/intake-backfill.test.ts (or existing equivalent) — fixture + cases

---

### Task 7: `--dedupe` CLI flag, dry-run by default
**Story:** TR-4 (Condition 4)
**Type:** feature

**Steps:**
1. Write failing test: `intake-backfill --repo o/r --dedupe` prints the per-issue before/after plan and the unresolved list, and issues **zero** mutating gh calls; `--dedupe --apply` performs the writes
2. Verify RED
3. Implement in `intake-backfill-cli.ts`: parse `--dedupe` and `--apply`, thread a `dryRun` flag into the sweep, render the report; update the usage string
4. Verify GREEN
5. Commit: "feat(intake-backfill): --dedupe with dry-run default and --apply"

**Files:**
- src/conductor/src/intake-backfill-cli.ts — flags + report rendering
- bin/intake-backfill — usage comment

---

### Task 8: Correct the workflow header and all downstream docs
**Story:** TR-5
**Type:** documentation

**Steps:**
1. Replace the "Idempotency" paragraph in `.github/workflows/intake-label-sync.yml` — describe the namespace-scoped replace (add winner, delete other `priority:`/`size:` labels, never a set-labels `PUT`, other labels preserved) and the explicit > existing > default ladder
2. Amend its defaults sentence: defaults apply only to an **empty** namespace and never override an existing or explicit value
3. Update the module docs on `label-sync.ts` (which currently describes step 2 as "applies it") and `backfill.ts`'s header (which mirrors the old defaults wording)
4. Update `docs/` (the intake/daemon guide covering intake labelling per the repo's Documentation Upkeep rule) and `src/conductor/README.md` with the authority ladder and the `--dedupe` / `--apply` flags
5. Add a `CHANGELOG.md` `## [Unreleased]` → `### Fixed` entry for #889. Do **not** touch `VERSION` (frozen pre-v1)
6. No migration block required: no `settings.json` schema, hook wiring, skill symlink, or `bin/conduct` CLI change. If the release gate's path classifier flags a breaking surface, add `.docs/release-waivers/intake-issues-get-contradictory-duplicate-priority.md` naming the exact canonical surface(s) in the same diff
7. Commit: "docs(intake-label-sync): document the real convergence contract (#889)"

**Files:**
- .github/workflows/intake-label-sync.yml — header
- src/conductor/src/engine/engineer/intake/label-sync.ts — module doc
- src/conductor/src/engine/engineer/intake/backfill.ts — module doc
- docs/*.md, src/conductor/README.md — behavior + flags
- CHANGELOG.md — [Unreleased] / Fixed

---

### Task 9: Full verification
**Story:** TR-5
**Type:** test

**Steps:**
1. Run `test/test_harness_integrity.sh` — must pass
2. Run the conductor test suite (`npm test` in `src/conductor`) — must be green, with the pre-existing issue-form acceptance tests passing unmodified
3. Grep-verify the invariants: `extractField`'s regex is unchanged in the diff; no `PUT`/set-labels call exists; `backlog-priority.ts` is not in the diff; `pr-labels.ts` exports are unchanged
4. Confirm the RED evidence from Tasks 1 and 6 is recorded (Condition 1 / F4)
5. Commit: "chore: verification pass for #889"

**Files:**
- (verification only — no source changes expected)

## Post-merge operational step (not a build task)

Once merged, an operator runs `bin/intake-backfill --repo jstoup111/ai-conductor --dedupe`
to review the plan for the 23 affected issues, then re-runs with `--apply`. This is
deliberately **not** automated in CI: it is a one-time write against live issue state and
should be eyeballed once before it executes.
