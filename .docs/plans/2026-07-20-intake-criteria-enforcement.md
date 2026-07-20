# Implementation Plan: Intake criteria enforcement + unsized-backlog backfill

**Date:** 2026-07-20
**Issue:** #695 — "Intake doesn't enforce priority + linking + sizing — 100/107 open issues have no size label"
**Stories:** .docs/stories/2026-07-20-intake-criteria-enforcement.md
**Track:** technical (no PRD — acceptance criteria live in the stories)
**ADRs:** none yet — one open design point (linking signal) flagged below for `/architecture-review`
**Conflict check:** pending (run `/conflict-check` before build; no overlapping in-flight spec found for the intake claim path)

## Summary

Make intake **criteria-complete before dispatchable**: an issue must carry a
`priority: …` label, a `size: S|M|L` label, and resolved dependency-linking
before its captured Envelope can be claimed into the idea→spec loop. Enforcement
is deterministic and lives at two seams that already exist — capture
(`github-issues.ts` `poll()`) flags incomplete issues, and claim
(`dependency-claim.ts` `claimUnblocked()`) defers them — plus a one-shot,
human-in-the-loop **backfill** for the ~100 existing unsized issues that
proposes sizes/priorities/links but never auto-labels. Per CLAUDE.md
"deterministic where possible", the machine stamps/blocks mechanically; an LLM is
dispatched only for the sizing judgment in the backfill.

## Why these seams

- **`claimUnblocked()` in `engineer/intake/dependency-claim.ts` is where an
  Envelope becomes dispatchable.** It already (a) reads issue labels via the
  injected `IssueLabelReader`/`resolveClaimBands` for priority banding and (b)
  defers entries on a `BlockerVerdict`, releasing them back to the queue
  statelessly (no ledger write, no attempt increment) and reporting `all-blocked`
  vs `empty`. A criteria gate is the *same shape* of deferral with a new reason —
  it composes cleanly and reuses the label read that banding already performs.
- **`poll()` in `engineer/intake/github-issues.ts` is where issues are captured.**
  It already applies/creates labels via `restAddLabelArgs`/`restRemoveLabelArgs`
  (the `engineer:handled` marker) with FR-37 best-effort semantics. Flagging an
  incomplete capture with `intake:needs-triage` is the same mechanism.
- The `size: S|M|L` and `priority: critical|high|medium|low` labels **already
  exist** in the repo; only the `intake:needs-triage` flag label is new
  (auto-created on first use, like `engineer:handled`).

## Technical Approach

- **Size parsing — extend `src/conductor/src/engine/backlog-priority.ts`:**
  - `parseSizeLabel(labels: string[]): 'S'|'M'|'L'|undefined` — closed vocabulary
    (`/^size: (S|M|L)$/`, one space, case-sensitive), largest-wins on multiples,
    unknown/malformed/near-miss → `undefined`. Mirrors `parsePriorityLabels`
    exactly; defined once, beside it (no duplicate regex elsewhere).
  - A small `IssueCriteria` shape + `evaluateCriteria(labels, blockerVerdict)`
    helper returning the set of missing criteria (`missing-priority` /
    `missing-size` / `missing-linking`). `missing-priority` ⇔
    `parsePriorityLabels === undefined`; `missing-size` ⇔ `parseSizeLabel ===
    undefined`; linking is derived from the blocker verdict (determinate =
    linked; `indeterminate` = outage → NOT a criteria failure, fail-open).
- **Claim gate — `engineer/intake/dependency-claim.ts`:**
  - Add an optional `resolveCriteria`/criteria-reader dep (reuse the existing
    `IssueLabelReader` batched read that `resolveBands` already uses — one fetch,
    both banding and criteria). Absent dep ⇒ byte-identical legacy behavior.
  - In the banded walk, after banding and before/alongside the blocker verdict,
    an entry whose issue is criteria-incomplete is **deferred** (released back,
    stateless) with a `missing-*` reason instead of claimed. Blocker deferral is
    unchanged and composes: reasons are reported distinctly (`blocked` vs
    `missing-*`).
  - New outcome kind `{ kind: 'needs-criteria'; entries: Array<{ envelope;
    missing: MissingCriterion[] }> }`, additive to the existing
    `claim`/`empty`/`all-blocked` union, so operators see a triage stall vs a
    dependency stall. The `finally` release-all guarantee is preserved verbatim.
  - Fail-open: a throwing criteria/label read skips the gate for that invocation
    and logs exactly one warning (parity with the banding fail-open contract);
    partial failures fall back wholesale (never a half-enforced gate). A per-ref
    `not-found` is data → the entry is criteria-incomplete, not an outage.
- **Capture flag — `engineer/intake/github-issues.ts`:**
  - In `poll()`, when a newly-captured (or re-observed, non-handled) issue is
    criteria-incomplete, apply `intake:needs-triage` (auto-create; best-effort,
    FR-37 non-fatal, swallow + log); when a previously-flagged issue is now
    complete, remove it (best-effort). De-dup so a still-incomplete re-observation
    makes no duplicate label/notify call.
  - Surface incomplete captures through `notify()` distinctly from
    ready-to-dispatch ones (which issues, what's missing).
- **Backfill — new deterministic inventory + assisted triage:**
  - Inventory: a `conduct-ts engineer intake triage --list` (or equivalent
    subcommand) that enumerates open assigned issues, computes each one's
    missing-criteria set via `evaluateCriteria`, stamps `intake:needs-triage` on
    the incomplete ones (idempotent, per-issue isolated), and prints a
    summary + per-issue report. No sizing judgment — detection/flagging only.
  - Assisted triage (judgment): per flagged issue, an engineer-hosted step
    proposes size/priority/links from the issue text and **presents for operator
    confirmation** (interactive), or writes a **HALT with the proposal ledger**
    (autonomous/daemon) — never auto-applies. On confirmation it writes the
    operator-confirmed values via the existing gh label/link helpers and clears
    the flag; a failed clear leaves the issue dispatchable and reconciles on
    re-inventory.
- **Tests:** vitest in `src/conductor` (`rtk proxy npx vitest run`), injected
  fakes only (no live network); one env-gated real-`gh` smoke for the inventory
  per the injected-runner precedent. No new spawn paths beyond short-lived
  `gh` behind injected runners.

## Prerequisites

- `intake:needs-triage` label — auto-created on first write (no manual setup); no
  config-schema change, no migration.
- `/architecture-review` to settle the one open design point below and record the
  ADR before build.

## Open Design Point (for `/architecture-review`)

**How is "linking enforced" made machine-checkable?** Two candidates: (a) treat a
determinate `blocked_by` verdict as "linked" and `indeterminate` as an outage
(fail-open) — no new marker, but "no dependencies" and "not yet triaged for
dependencies" are indistinguishable; or (b) add an explicit `intake:linked` (or
triaged) marker written by the triage pass. The stories are written against (a)
for the deterministic signal (priority + size labels present) with linking
confirmation riding the human triage pass; the ADR should confirm or choose (b).
This is load-bearing for FR-3/FR-6/FR-7 and must be resolved before build.

## Tasks

### Task 1: Size label parsing — happy path
**Story:** FR-2 happy paths
**Type:** happy-path
**Steps:**
1. Write failing tests: `parseSizeLabel(['size: S'])→'S'`; M; L; `['bug','size: L','priority: low']→'L'`; `['size: S','size: L']→'L'` (largest wins); determinism across repeated calls.
2. RED → implement `parseSizeLabel` beside `parsePriorityLabels` in `backlog-priority.ts` → GREEN.
3. Commit: "feat(intake): parse size band from issue labels (largest wins)"
**Files likely touched:** `src/conductor/src/engine/backlog-priority.ts`, `src/conductor/test/backlog-priority.test.ts`
**Dependencies:** none

### Task 2: Size label parsing — adversarial inputs
**Story:** FR-2 negatives
**Type:** negative-path
**Steps:**
1. Failing tests: `['size: XL']→undefined`; `['size:M']` (no space) → undefined; `['Size: S']` (case) → undefined; `['size: small']→undefined`; `[]→undefined`; non-string junk filtered → undefined.
2. RED → tighten matcher to the closed vocabulary → GREEN.
3. Commit: "test(intake): unknown/malformed size labels never count"
**Files likely touched:** same as Task 1
**Dependencies:** Task 1

### Task 3: evaluateCriteria — missing-criteria set
**Story:** FR-3 (predicate), FR-6 (reporting)
**Type:** happy-path
**Steps:**
1. Failing tests: sized+prioritized+determinate verdict → `[]` (complete); no size → `['missing-size']`; no priority → `['missing-priority']`; `indeterminate` verdict → linking NOT reported missing (outage carve-out); combinations aggregate.
2. RED → implement `evaluateCriteria(labels, verdict)` + `MissingCriterion` type in `backlog-priority.ts` → GREEN.
3. Commit: "feat(intake): evaluate per-issue intake-criteria completeness"
**Files likely touched:** `backlog-priority.ts`, `backlog-priority.test.ts`
**Dependencies:** Task 1

### Task 4: Claim gate defers criteria-incomplete entries
**Story:** FR-3 happy + no-issue/crash negatives
**Type:** happy-path
**Steps:**
1. Failing tests in `dependency-claim` suite: {complete, unsized} → complete claimed, unsized still pending, ledger status/attempts unchanged; relabel-after-capture → claimable on second claim; no-`sourceRef` entry bypasses the gate (`no-issue`); crash-injection → all held released.
2. RED → thread an optional criteria reader (reuse the banding `IssueLabelReader` batch) into `claimUnblocked`; defer incomplete entries statelessly with a `missing-*` reason; preserve the `finally` release-all → GREEN.
3. Commit: "feat(intake): defer criteria-incomplete entries at claim time"
**Files likely touched:** `src/conductor/src/engine/engineer/intake/dependency-claim.ts`, `src/conductor/test/dependency-claim*.test.ts`
**Dependencies:** Task 3

### Task 5: needs-criteria outcome kind
**Story:** FR-3 all-incomplete case
**Type:** happy-path
**Steps:**
1. Failing test: all pending entries incomplete → `{ kind: 'needs-criteria', entries }` enumerating each missing set; distinct from `empty`/`all-blocked`.
2. RED → add the additive `needs-criteria` variant to `ClaimOutcome` and return it when the walk deferred only on criteria → GREEN.
3. Commit: "feat(intake): report needs-criteria distinctly from all-blocked/empty"
**Files likely touched:** `dependency-claim.ts`, its test
**Dependencies:** Task 4

### Task 6: Criteria + banding + blocker composition
**Story:** FR-4 (happy + negatives)
**Type:** negative-path
**Steps:**
1. Failing tests: {critical+sized, high+sized, medium-unsized} → order critical→high, medium deferred `missing-size`; blocked complete critical → deferred as `blocked` (reason distinct from `missing-*`); within-band FIFO preserved for surviving entries.
2. RED → ensure the gate removes only incomplete entries from candidacy without touching banding order or blocker verdict handling → GREEN.
3. Commit: "test(intake): criteria gate composes with banding + blocker deferral"
**Files likely touched:** `dependency-claim.ts`, its test
**Dependencies:** Task 4, Task 5

### Task 7: Fail-open on label/API outage
**Story:** FR-5 (happy + negatives)
**Type:** negative-path
**Steps:**
1. Failing tests: throwing reader → gate skipped, claim succeeds on FIFO fallback, exactly one warning; partial mid-batch failure → wholesale fallback (no half-enforced gate); single 404 → only that entry deferred (`missing-*`), batch not failed-open.
2. RED → wrap the criteria read in the same fail-open pattern as banding; ensure partial failure discards the whole criteria map → GREEN.
3. Commit: "feat(intake): criteria gate fails open to today's FIFO on outage"
**Files likely touched:** `dependency-claim.ts`, its test
**Dependencies:** Task 4

### Task 8: Capture-time flag on incomplete issues
**Story:** FR-1 (happy + negatives)
**Type:** happy-path
**Steps:**
1. Failing tests in the github-issues adapter suite: complete issue → no flag call, normal enqueue; unsized issue → `intake:needs-triage` applied AND Envelope enqueued; failing label-apply swallowed (enqueue proceeds, one log line); re-observed still-incomplete → no duplicate label/notify.
2. RED → in `poll()`, evaluate criteria on capture; apply/create `intake:needs-triage` best-effort (FR-37 swallow+log) when incomplete; de-dup like the write-back markers → GREEN.
3. Commit: "feat(intake): flag criteria-incomplete captures with intake:needs-triage"
**Files likely touched:** `src/conductor/src/engine/engineer/intake/github-issues.ts`, its test
**Dependencies:** Task 3

### Task 9: Clear the flag when an issue becomes complete
**Story:** FR-1 (clear-on-complete), FR-8 negatives
**Type:** negative-path
**Steps:**
1. Failing tests: previously-flagged issue now complete → flag removed best-effort; failed removal → issue still treated as dispatchable, flag reconciled on next observation.
2. RED → in `poll()`/inventory, remove `intake:needs-triage` (best-effort) when criteria now satisfied → GREEN.
3. Commit: "feat(intake): clear intake:needs-triage once criteria are satisfied"
**Files likely touched:** `github-issues.ts`, its test
**Dependencies:** Task 8

### Task 10: notify() surfaces incomplete captures distinctly
**Story:** FR-1 (notify)
**Type:** happy-path
**Steps:**
1. Failing test: a batch with mixed complete/incomplete captures → notification distinguishes ready-to-dispatch from needs-triage, naming which issues and what's missing.
2. RED → thread the criteria result into the notify payload → GREEN.
3. Commit: "feat(intake): surface needs-triage captures in operator notification"
**Files likely touched:** `intake-loop.ts`/`notifier.ts`, `github-issues.ts`, tests
**Dependencies:** Task 8

### Task 11: Backfill inventory — enumerate + flag
**Story:** FR-6 (happy + negatives)
**Type:** happy-path
**Steps:**
1. Failing tests: inventory over a fixture backlog → per-issue missing sets + summary count; `intake:needs-triage` applied only to incomplete issues; idempotent on re-run; single-issue `gh` failure isolated, sweep completes.
2. RED → implement the inventory routine (reuse `evaluateCriteria`; per-issue isolation) and its CLI entrypoint → GREEN.
3. Commit: "feat(intake): backfill inventory flags the unsized backlog (no judgment)"
**Files likely touched:** new inventory module + `engineer` CLI wiring under `src/conductor/src/engine/engineer/`, tests
**Dependencies:** Task 3

### Task 12: Backfill assisted triage — propose, never auto-apply
**Story:** FR-7, FR-8 (happy + negatives)
**Type:** negative-path
**Steps:**
1. Failing tests: interactive path presents a proposal and applies only after explicit confirmation; autonomous path writes a HALT with the proposal ledger and applies nothing; operator-edited values (not the model proposal) are what get written; on confirm the flag is cleared and the issue is dispatchable next claim.
2. RED → implement the assisted-triage step (proposal generation seam + confirmation/HALT gate + confirmed-write path reusing gh label/link helpers) → GREEN.
3. Commit: "feat(intake): assisted backfill triage proposes size/priority/links for confirmation"
**Files likely touched:** triage module + `engineer` CLI wiring, tests
**Dependencies:** Task 11, Task 9

### Task 13: Docs + CHANGELOG
**Story:** all (docs-track-features)
**Type:** happy-path
**Steps:**
1. Update `README.md` / `src/conductor/README.md` for the new intake-criteria enforcement, the `intake:needs-triage` label, the `needs-criteria` claim outcome, and the backfill/triage command; confirm the `[Unreleased]` CHANGELOG entry (added by the spec PR) is reflected.
2. Commit: "docs(intake): document criteria enforcement + backfill"
**Files likely touched:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** Task 8, Task 11, Task 12

## Out of scope

- Hand-labeling any existing issue (sizing is human judgment — FR-7 keeps the
  operator in the loop; the spec provides the tooling, not the labels).
- Changing the `createFileQueue` atomic-claim primitive (`queue.ts` stays
  byte-identical to main).
- Changing the `claim` JSON contract for existing outcome kinds (`needs-criteria`
  is additive only).
