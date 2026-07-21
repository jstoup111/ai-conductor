# Implementation Plan: Intake-only criteria enforcement (priority + size + linking)

**Date:** 2026-07-21
**Issue:** #695 — "Intake doesn't enforce priority + linking + sizing — 100/107 open issues have no size label"
**Stem:** `intake-only-enforcement`
**Stories:** `.docs/stories/intake-only-enforcement.md`
**Complexity:** `.docs/complexity/intake-only-enforcement.md` (Tier: M)
**ADR:** `.docs/decisions/adr-2026-07-21-intake-only-enforcement.md` (APPROVED)
**Conflict check:** `.docs/conflicts/intake-only-enforcement.md`
**Architecture:** `.docs/architecture/intake-only-enforcement.md`
**Track:** technical (no PRD)
**Supersedes:** PR #696 (`intake-criteria-enforcement`)

## Operator directive (binding)

**"No failures — enforce requirements at intake ONLY."** Priority + size + linking
are stamped at capture/file time so every issue is born complete. **Zero new
downstream failure modes** — no pipeline gate, HALT, build/dispatch rejection, or CI
failure for missing priority/size/links. Sensible defaults where inference fails.

## Summary

Stamp `priority:` + `size:` + a linking decision at **every intake capture surface**
so issues are born complete, and complete the ~100-issue backlog in one pass — with
**no** downstream re-check. Enforcement is deterministic on the dominant (issue-form)
path via a labels-only Action; the claim path stays byte-identical to `main`.

## Technical approach

- **Closed-vocab size parser** — add `parseSizeLabel(labels: string[]): 'S'|'M'|'L'|undefined`
  beside `parsePriorityLabels` in `backlog-priority.ts` (exact `^size: (S|M|L)$`,
  largest-wins, junk-safe). Single source of truth; **not** wired into the claim path.
- **Issue form** — `intake.yml` gains a required Priority select, a required Size
  select, and a `Depends on` field (additive to existing fields).
- **Label-sync Action** — new `.github/workflows/intake-label-sync.yml`, triggered on
  `issues.opened`/`edited`, parses the form fields → applies `priority:`/`size:`
  labels (auto-creating them) + records `blocked_by`; defaults on unparsable input;
  labels-only, isolated from `ci.yml`, never fails a build.
- **Filing helper** — new `bin/intake-file`: create + label + link atomically;
  prompt ▸ infer ▸ default for missing size/priority; success-with-warning on a
  failed label apply. `/intake` §7/§8 route through it.
- **Backfill** — new `bin/intake-backfill`: stamp `size:`/`priority:` on incomplete
  open assigned issues (infer ▸ default), emit an operator report, idempotent,
  per-issue failure isolation, **no HALT**.
- **No-gate guarantee** — `dependency-claim.ts` and `github-issues.ts poll()` are
  left unchanged re: criteria; a test proves the claim path and `ClaimOutcome` union
  are byte-identical to `main`.

## Tasks

### Task 1: Closed-vocabulary `parseSizeLabel`
**Story:** FR-5
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: valid S/M/L; ignores unrelated labels; largest-wins on multiples; `size: XL`/`size:M`/`Size: S`/`size: small`/`[]`→`undefined`; non-string junk filtered; determinism across calls.
2. RED → implement `parseSizeLabel` beside `parsePriorityLabels` → GREEN.
3. Commit: "feat(intake): closed-vocabulary size-label parser (largest wins)"
**Files likely touched:** `src/conductor/src/engine/backlog-priority.ts`, `src/conductor/test/backlog-priority.test.ts`
**Dependencies:** none

### Task 2: Intake form — required Priority + Size + Depends-on
**Story:** FR-1, FR-4
**Type:** happy-path
**Steps:**
1. Add a required `dropdown` Priority (critical/high/medium/low), a required `dropdown` Size (S/M/L), and an `input`/`textarea` `Depends on` to `intake.yml` — additive to Observed/Impact/Desired-outcome/Hypotheses.
2. Re-run `test/test_harness_integrity.sh` check #11 (YAML validity + blank-issues guard) → green.
3. Commit: "feat(intake): require priority + size + linking on the intake form"
**Files likely touched:** `.github/ISSUE_TEMPLATE/intake.yml`, `test/test_harness_integrity.sh` (only if the check needs the new fields whitelisted)
**Dependencies:** none

### Task 3: `intake-label-sync` Action — stamp labels + linking at open
**Story:** FR-1, FR-4
**Type:** happy-path + negative-path
**Steps:**
1. Failing test/fixture: parsed form → correct `priority:`/`size:` labels + `blocked_by`; label auto-created if absent; unparsable field → default (`size: M`/`priority: medium`); re-edit idempotent; label-apply failure → workflow still succeeds (labels-only, no CI/build impact).
2. RED → implement `.github/workflows/intake-label-sync.yml` (triggers `issues: [opened, edited]`, `GITHUB_TOKEN` labels scope; reuse the closed-vocab from Task 1 where it runs JS, else inline the same regex) → GREEN.
3. Commit: "feat(intake): label-sync Action makes form-filed issues born-complete"
**Files likely touched:** `.github/workflows/intake-label-sync.yml` (new), a workflow fixture/test under `src/conductor/test/`
**Dependencies:** Task 1, Task 2

### Task 4: `bin/intake-file` — deterministic completeness step
**Story:** FR-2, FR-4
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests (injected `gh` runner): create + apply `priority:`/`size:` + record `blocked_by` in one filing; prompt when interactive / infer from body / default when neither; `--depends-on` recorded, omitted → explicit "no dependencies"; label-apply failure after create → issue URL + warning, exit success.
2. RED → implement `bin/intake-file` (reuse `parseSizeLabel`/`parsePriorityLabels` and the `restAddLabelArgs` REST idiom) → GREEN.
3. Commit: "feat(intake): bin/intake-file files criteria-complete issues"
**Files likely touched:** `bin/intake-file` (new), test under `src/conductor/test/`
**Dependencies:** Task 1

### Task 5: `/intake` skill routes filing through the completeness step
**Story:** FR-2
**Type:** happy-path
**Steps:**
1. Rewrite `skills/intake/SKILL.md` §7 GATE + §8 File so filing goes through `bin/intake-file` (deterministic) instead of prose "remember the label"; keep the WHAT/OUTCOMES guidance intact.
2. Run `test/test_harness_integrity.sh` (frontmatter, cross-skill/template refs, section numbering) → green.
3. Commit: "docs(intake): route /intake filing through bin/intake-file"
**Files likely touched:** `skills/intake/SKILL.md`
**Dependencies:** Task 4

### Task 6: `bin/intake-backfill` — complete the backlog, no HALT
**Story:** FR-3
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests over a fixture backlog (injected `gh`): incomplete issues labelled (infer ▸ default); report of defaulted vs inferred; idempotent re-run skips complete issues; single-issue failure isolated, sweep completes; **no** HALT / confirmation prompt.
2. RED → implement `bin/intake-backfill` (enumerate open assigned issues, `parseSizeLabel`/`parsePriorityLabels` to detect gaps, REST label apply, emit report) → GREEN.
3. Commit: "feat(intake): one-shot backfill stamps the unsized backlog (default-and-report)"
**Files likely touched:** `bin/intake-backfill` (new), test under `src/conductor/test/`
**Dependencies:** Task 1

### Task 7: Prove the pipeline does NOT gate on criteria
**Story:** FR-6
**Type:** negative-path
**Verify-only:** yes
**Steps:**
1. Assert `src/conductor/src/engine/engineer/intake/dependency-claim.ts` is byte-identical to `main` (e.g. `git diff origin/main -- <path>` empty) and its `ClaimOutcome` union has exactly `claim | empty | all-blocked` (no `needs-criteria`).
2. Assert `github-issues.ts poll()` enqueues a criteria-incomplete issue with no blocking flag and no withheld enqueue.
3. Assert no daemon/pipeline gate and `.github/workflows/ci.yml` reference `size:`/`priority:`/linking as a pass/fail condition (grep/config check).
4. Commit: "test(intake): assert no downstream criteria gate (intake-only)"
**Files likely touched:** new assertion test under `src/conductor/test/`; reads (does not modify) `src/conductor/src/engine/engineer/intake/dependency-claim.ts`, `src/conductor/src/engine/engineer/intake/github-issues.ts`, `.github/workflows/ci.yml`
**Dependencies:** Task 1, Task 3, Task 4, Task 6

### Task 8: Docs + CHANGELOG
**Story:** all (docs-track-features)
**Type:** happy-path
**Steps:**
1. Document the intake-time enforcement, the `intake-label-sync` Action, `bin/intake-file`, and `bin/intake-backfill` in `README.md` + `src/conductor/README.md`; confirm the `[Unreleased]` CHANGELOG entry (added by the spec PR) is reflected.
2. Commit: "docs(intake): document intake-only criteria enforcement"
**Files likely touched:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** Task 3, Task 4, Task 6

## Task dependency graph

```
Task 1 ─┬─ Task 3 ─┐
        ├─ Task 4 ─┼─ Task 7
        └─ Task 6 ─┘
Task 2 ── Task 3
Task 4 ── Task 5
Tasks 3,4,6 ── Task 8
```

## Out of scope

- Any change to `dependency-claim.ts` / `ClaimOutcome` / the daemon dispatch/build
  gates / `ci.yml` behaviour (the directive forbids a downstream check; Task 7 guards it).
- Hand-choosing a "correct" size for legacy issues — the backfill defaults and
  reports; the operator re-bands at leisure (a label edit, no pipeline effect).
- Any `settings.json` schema / hook wiring / `bin/conduct` CLI change → no migration
  block needed (labels + additive form fields + a new isolated Action).
