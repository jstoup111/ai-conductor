# Stories: satisfied-by-forged-citation-validation

**Source:** jstoup111/ai-conductor#533 · **Track:** technical · **Tier:** M
**Governing ADR:** `.docs/decisions/adr-2026-07-11-semantic-attribution-verification-lane.md`
(the provenance rule this feature extends to the mechanical `satisfied-by` lane)

All scenarios exercise `deriveCompletion` /`deriveCompletionInternal`
(`src/conductor/src/engine/autoheal.ts`), the `Evidence: satisfied-by <sha>` branch.
"Stamp" = `result[taskId].completed === true` and an evidence stamp written to the
sidecar. "Refuse" = `completed !== true`, no stamp written, and an audit/log line names
the citing commit, the cited sha, and the reason.

---

## Story 1 — Happy path: genuine on-branch implementing citation stamps

As the evidence gate, I complete a task whose `satisfied-by` citation points at a real,
on-branch commit that implements the task, so genuine work ships.

- **Given** a plan with `### Task 7` declaring `**Files:** src/engine/foo.ts`
- **And** an on-branch commit W that modifies `src/engine/foo.ts` (non-empty, ancestor of HEAD)
- **And** an empty no-op commit carrying `Task: 7` + `Evidence: satisfied-by <W>`
- **When** `deriveCompletion` runs
- **Then** task 7 is `completed`, `evidencedBy === W`, and a `satisfied-by` stamp is
  written to `task-evidence.json`.

## Story 2 — Happy path: legitimate operator backfill still stamps (outcome #3)

As an operator, I backfill a completed task with an empty commit that cites the real
work commit, and it stamps exactly as today.

- **Given** a plan with `### Task 3` declaring `**Files:** src/engine/bar.ts`
- **And** an on-branch, non-empty, ancestor commit W2 touching `src/engine/bar.ts`
  authored earlier in the branch
- **And** a **separately authored** empty backfill commit carrying `Task: 3` +
  `Evidence: satisfied-by <W2>`
- **When** `deriveCompletion` runs
- **Then** task 3 is `completed` and `evidencedBy === W2` — no regression from today's
  behavior for honest backfills.

## Story 3 — Happy path: task with no declared Files stamps on ancestry+non-empty alone

As the evidence gate, when a task declares no `**Files:**`, I stamp a `satisfied-by`
citation that is an on-branch, non-empty commit without requiring path overlap (mirrors
the `Task:`-trailer rule at `autoheal.ts:697-704`).

- **Given** a plan with `### Task 5` and **no** `**Files:**` line
- **And** an on-branch, non-empty, ancestor commit W3
- **And** an empty commit `Task: 5` + `Evidence: satisfied-by <W3>`
- **When** `deriveCompletion` runs
- **Then** task 5 is `completed`, `evidencedBy === W3` (existing test
  `marks task completed with Evidence: satisfied-by <valid sha>` continues to pass).

---

## Story 4 (NEGATIVE) — Forged citation to a dangling, non-ancestor object is refused

Reproduces the exact #533 forgery: an empty commit whose cited sha is reachable in the
odb (kept alive by a reflog) but is **not an ancestor of HEAD**.

- **Given** a plan with `### Task 24`
- **And** a commit F authored on a side branch (or before a reset) — reachable via
  `git rev-parse --verify <F>^{commit}` (exit 0) but **not** an ancestor of HEAD
- **And** an empty commit `Task: 24` + `Evidence: satisfied-by <F>` on the build branch
- **When** `deriveCompletion` runs
- **Then** task 24 is **not** `completed`, **no** stamp is written, and an audit/log
  line names commit F's sha with reason *non-ancestor*.
- **And** the old object-existence pass (`rev-parse --verify` alone) does **not** stamp it.

## Story 5 (NEGATIVE) — Replayed / cross-feature citation to another branch's commit is refused

Citing a real implementing commit that belongs to a *different* feature branch (not an
ancestor of this HEAD) must be refused — a forger cannot replay any historical sha.

- **Given** a plan with `### Task 8` declaring `**Files:** src/engine/foo.ts`
- **And** a non-empty commit X that lives only on another branch (reachable object,
  **not** an ancestor of this HEAD), even one that touches `src/engine/foo.ts`
- **And** an empty commit `Task: 8` + `Evidence: satisfied-by <X>`
- **When** `deriveCompletion` runs
- **Then** task 8 is **not** `completed`, no stamp, audit reason *non-ancestor* —
  ancestry is checked **before** overlap, so an off-branch commit is refused regardless
  of what files it touched.

## Story 6 (NEGATIVE) — Citation to a non-implementing (empty) commit is refused

An on-branch, ancestor commit that is **empty** (zero file changes) is not evidence of
work and must be refused — this covers a forged self-citation to another empty no-op.

- **Given** a plan with `### Task 12`
- **And** an on-branch, ancestor, **empty** commit E (`--allow-empty`, zero diff)
- **And** an empty commit `Task: 12` + `Evidence: satisfied-by <E>`
- **When** `deriveCompletion` runs
- **Then** task 12 is **not** `completed`, no stamp, audit reason *empty (no file changes)*.

## Story 7 (NEGATIVE) — Citation to an on-branch commit whose diff does not overlap the task's Files is refused

An ancestor, non-empty commit that touches unrelated files does not corroborate a task
that declares specific Files.

- **Given** a plan with `### Task 15` declaring `**Files:** src/engine/target.ts`
- **And** an on-branch, non-empty, ancestor commit Y that touches only
  `src/engine/unrelated.ts` (no overlap with `target.ts`; segment-anchored match, so
  `trail.ts` never matches `audit-trail.ts`)
- **And** an empty commit `Task: 15` + `Evidence: satisfied-by <Y>`
- **When** `deriveCompletion` runs
- **Then** task 15 is **not** `completed`, no stamp, audit reason *no file overlap*,
  naming Y's touched files and the task's expected paths.

## Story 8 (NEGATIVE) — Genuinely non-existent (unreachable) sha still refused

Regression guard: the pre-existing dangling-sha refusal (`autoheal.ts:635-641`) for a
sha that does not exist in the odb at all must remain.

- **Given** a plan with `### Task 9`
- **And** an empty commit `Task: 9` + `Evidence: satisfied-by deadbeef...` (no such object)
- **When** `deriveCompletion` runs
- **Then** task 9 is **not** `completed`, no stamp, audit reason *unreachable*
  (existing test `does NOT complete task with dangling satisfied-by sha` still passes).
