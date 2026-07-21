# Verify-only (prove-closed) task evidence closure (#677)

Status: Accepted

## Context

Observed 2026-07-18T00:45:14Z on the issue #667 build: task 4 of 8 was a prove-closed task
("close **or prove closed** the root-mismatch") whose concern was already covered by task 2's
commit `a2cde88`. It produced no commit by design, so `deriveCompletion` found no evidence,
`autoheal-…00-45-14.json` recorded `skipped:[{taskId:"4", reason:"no derived evidence"}]`, the
row stayed `pending`, retries 4-5 burned `noEvidenceAttempts` to 3, and the build auto-parked —
despite the batch evaluator's APPROVE on all 8 tasks and `summary.json: tasks_completed: 8`.
Design: `.docs/decisions/adr-2026-07-17-verify-only-judged-closure.md` (APPROVED).

## Story 1 — /plan marks prove-closed tasks with a deterministic Verify-only flag

As the plan author (the /plan skill), when a task's GREEN can legitimately produce no code
delta, I mark it so the engine knows the task is commit-less by design.

### Happy Path

- **Given** a feature whose plan includes a task of the form "close or prove closed X",
- **When** `/plan` authors the task block,
- **Then** the block carries a `**Verify-only:** yes` line alongside `**Files likely touched:**`,
- **And** the task instructions state the preferred completion form: an empty commit with
  `Task: <id>` plus `Evidence: satisfied-by <sha>` (or `Evidence: skipped <reason>` when
  nothing satisfies it).

### Negative Paths

- **Given** a task expected to change code,
- **When** `/plan` authors it,
- **Then** it carries no `**Verify-only:**` line and the evidence contract is unchanged
  (commit with Task trailer + path corroboration).

- **Given** a plan file containing a malformed marker (`**Verify-only:** maybe`),
- **When** the engine parses the plan,
- **Then** the task is treated as NOT verify-only (fail-closed: unknown values never widen the
  evidence gate).

## Story 2 — The plan parser exposes the verify-only flag to the engine

As the engine, I can read per-task verify-only status deterministically from the plan.

### Happy Path

- **Given** a plan with task 4 marked `**Verify-only:** yes` and tasks 1-3 unmarked,
- **When** `parsePlanTaskPaths` (autoheal.ts) parses the plan text,
- **Then** its result exposes `verifyOnly: true` for task 4 and `verifyOnly: false` (or absent)
  for tasks 1-3, alongside the existing declared-paths data,
- **And** all existing consumers of the parser see byte-identical behavior for their existing
  fields.

### Negative Path

- **Given** a plan with no verify-only markers anywhere (every existing plan in the corpus),
- **When** the parser runs,
- **Then** no task reports `verifyOnly: true` and every existing parser test still passes
  unchanged.

## Story 3 — Verify-only residue dispatches the judged lane even when the global cutover is dark

As the daemon build loop, when the only thing standing between an APPROVED build and completion
is a commit-less verify-only task, I get a citation-validated semantic stamp or a loud abstain —
not a silent budget burn.

### Happy Path

- **Given** a gate-miss where `deriveCompletion` leaves residue exactly `["4"]`, task 4 is
  marked verify-only, `attribution_judge_cutover` is NOT armed, and the build produced real
  work (not zero-work-product),
- **When** the gate-miss branch (conductor.ts:3030-3105) evaluates,
- **Then** `runAttributionLane` is dispatched for task 4 despite the dark global cutover,
- **And** when the verifier cites an existing commit (e.g. `a2cde88`) that exists and is an
  ancestor of HEAD, the engine writes the `semantic-verified` stamp to
  `.pipeline/task-evidence.json`, the in-loop completion re-check resolves the step, the task
  row flips, and `noEvidenceAttempts` is reset by the progress detection.

### Negative Paths

- **Given** the same residue but task 4 is NOT marked verify-only and the global cutover is
  dark,
- **When** the gate-miss branch evaluates,
- **Then** the lane is NOT dispatched and today's behavior is byte-identical (counter
  increments, retry hint unchanged).

- **Given** a verifier verdict citing a sha that does not exist, is not an ancestor of HEAD, or
  cites a task outside the residue set,
- **When** the lane validates citations,
- **Then** no stamp is written for the invalid citation (forged-citation rejection is
  unchanged), and the task remains unresolved.

- **Given** the verifier abstains ("unsatisfied: no commit substantiates task 4"),
- **When** the lane returns,
- **Then** the abstain reason lands in the BUILD retry hint naming task 4 (#519 loud-abstain),
  no stamp is written, and the existing budget semantics proceed unchanged.

## Story 4 — An APPROVED build stranded only by verify-only tasks does not park generically

As the operator, a park caused by an unsubstantiatable verify-only task tells me exactly that.

### Happy Path

- **Given** a build whose residue after the judged lane is only verify-only task ids and
  `noEvidenceAttempts` reaches the threshold,
- **When** auto-park fires (daemon-auto-park.ts),
- **Then** the park reason includes the verify-only task ids (e.g. "no completion evidence
  after 3 attempts — unresolved verify-only tasks: 4"), so the operator knows this is a
  prove-closed evidence gap, not a build failure.

### Negative Path

- **Given** a build with mixed residue (verify-only and ordinary unresolved tasks),
- **When** auto-park fires,
- **Then** the reason still reports the overall evidence failure (ordinary tasks are the real
  signal) and the verify-only ids are listed distinctly — the verify-only annotation never
  masks a genuine incomplete build.

## Story 5 — The commit-msg hook accepts the Evidence: skipped form autoheal already derives from

As a build session completing a prove-closed task the honest way, my empty evidence commit is
accepted in both trailer forms the deriver understands.

### Happy Path

- **Given** an empty commit whose message carries `Task: 4` and `Evidence: skipped <non-empty
  reason>`,
- **When** the generated commit-msg hook (git-hook-assets.ts) validates it,
- **Then** the commit is accepted, and `deriveCompletion` later derives `status:'skipped'` for
  task 4 exactly as it does today (autoheal.ts:712-718).

### Negative Paths

- **Given** a bare empty commit (Task trailer, no Evidence trailer),
- **When** the hook validates it,
- **Then** it is rejected exactly as today.

- **Given** an empty commit with `Evidence: skipped` but an empty/whitespace reason,
- **When** the hook validates it,
- **Then** it is rejected (a reason is required; parity with the deriver's non-empty-reason
  expectation).

- **Given** an empty commit with `Evidence: satisfied-by <unresolvable sha>`,
- **When** the hook validates it,
- **Then** it is rejected exactly as today (existence check unchanged).

## Story 6 — Skill documentation reflects the contract

As a future plan/build session, the /plan and /tdd skills teach the verify-only contract.

### Happy Path

- **Given** the updated `skills/plan/SKILL.md` and `skills/tdd/SKILL.md`,
- **When** `test/test_harness_integrity.sh` runs,
- **Then** it passes (frontmatter intact, no duplicate section numbers, cross-references
  valid),
- **And** the plan skill documents the `**Verify-only:** yes` marker with the empty-evidence-
  commit instruction, and the tdd skill's Commit-less Completions section cross-references the
  marker and both accepted trailer forms.

### Negative Path

- **Given** an edit that breaks frontmatter or duplicates a section number,
- **When** the integrity suite runs,
- **Then** it fails and the change does not land.
