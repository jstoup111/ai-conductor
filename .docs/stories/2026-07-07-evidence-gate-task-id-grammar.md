**Status:** Accepted

# Stories: Evidence-Gate Task-Id Grammar Unification (#417)

Technical track — acceptance criteria derive from issue #417, APPROVED
adr-2026-07-07-task-trailer-id-alias, and the architecture review conditions
(architecture-review-2026-07-07-evidence-gate-task-id-grammar).

---

## Story 1: Trailer alias `task-<id>` ≡ `<id>` in evidence derivation

**Requirement:** ADR decision item 3 (extends H5)

As the build engine, I want `deriveCompletion` to accept the legacy `Task: task-<id>`
trailer spelling as evidence for plan id `<id>` — unless the plan itself declares a
literal `task-<id>` id — so that unambiguously-attributed work satisfies the completion
gate without weakening the evidence bar.

### Acceptance Criteria

#### Happy Path
- Given a plan declaring `### Task 7: X` (id `7`) and a non-empty commit whose trailer
  is `Task: task-7` touching a plan-declared path, when `deriveCompletion` runs, then
  task `7` is completed with `evidencedBy` = that commit's SHA and a sidecar stamp of
  the same `{sha, form: 'trailer'}` shape as an exact match.
- Given a plan id `13` and an empty commit carrying `Task: task-13` plus
  `Evidence: satisfied-by <reachable-sha>`, when `deriveCompletion` runs, then task `13`
  is completed with form `evidence:satisfied-by` (alias applies to the Evidence-commit
  predicate too).
- Given a plan id `5` and a commit with trailer `Task: 5` (bare, canonical), when
  `deriveCompletion` runs, then behavior is byte-identical to today (exact match takes
  precedence; no regression).

#### Negative Paths
- Given a plan declaring BOTH `### Task 7:` and `### Task task-7:` (literal `task-7`
  id, valid under the H9 grammar) and a commit with trailer `Task: task-7`, when
  `deriveCompletion` runs, then the trailer evidences ONLY the literal plan id `task-7`
  and task `7` remains incomplete (alias suppressed — no cross-match, no double-credit).
- Given a plan id `9` and an EMPTY commit with trailer `Task: task-9` and no
  `Evidence:` trailer, when `deriveCompletion` runs, then task `9` remains incomplete
  with the existing "empty commit … no Evidence: form" audit entry (alias does not
  loosen the empty-commit rejection).
- Given a plan id `4` and an empty commit `Task: task-4` +
  `Evidence: satisfied-by <unreachable-sha>`, when `deriveCompletion` runs, then task
  `4` remains incomplete with the dangling-SHA audit entry (alias does not bypass SHA
  validation).
- Given a plan id `6` with declared paths and a commit `Task: task-6` touching NONE of
  them, when `deriveCompletion` runs, then task `6` remains incomplete with the
  path-corroboration audit entry (alias inherits path corroboration).
- Given a commit with trailer `Task: task-42` and no plan id `42` (nor `task-42`), when
  `deriveCompletion` runs, then no task is completed (alias never invents ids).

### Done When
- [ ] A single shared normalization/matching helper is used by BOTH trailer predicates
      in `deriveCompletionInternal` (Evidence-commit find and plain-trailer find) —
      verified by code inspection, no duplicated alias logic.
- [ ] New vitest cases cover every scenario above and pass; the full existing autoheal
      test file passes unchanged.
- [ ] Running the gate against a fixture reproducing the parked
      `audit-trail-…` shape (prefixed trailers for 16 of 19 tasks) resolves exactly
      those 16 tasks and leaves 5, 9, 10 unresolved.

---

## Story 2: tdd SKILL.md — one id grammar and COMMIT trailer discipline

**Requirement:** ADR decision items 1–2 (implements H2)

As a TDD subagent, I want the COMMIT contract to state exactly which id goes in the
`Task:` trailer and to fail commits that name a task without attributing it, so that
attribution drift cannot recur at the source.

### Acceptance Criteria

#### Happy Path
- Given skills/tdd/SKILL.md after the change, when an agent reads the COMMIT hard-gate,
  then it states: the trailer id IS the plan header id (`### Task 7:` → `Task: 7`),
  the `task-N` spelling is explicitly forbidden, and the existing `Task: 42` example is
  retained/consistent.
- Given a verification-only task ("no edits expected"), when the agent follows the
  rewritten Evidence section, then it produces
  `git commit --allow-empty` with `Task: <id>` plus `Evidence: satisfied-by <sha>` (or
  `Evidence: skipped <reason>`) — the empty-commit form the engine reads.

#### Negative Paths
- Given a commit whose subject is "Task 5: Implement X" with no `Task: 5` trailer, when
  the COMMIT checklist is applied, then the checklist FAILS the commit (item requires
  subject-referenced task ⇒ matching trailer) and the agent must amend before
  proceeding.
- Given the old "Evidence trailers in the final task report" wording, when the change
  lands, then that wording is GONE — grep of skills/tdd/SKILL.md finds no instruction
  to put `Evidence:` forms in a task report (the engine never reads reports).

### Done When
- [ ] skills/tdd/SKILL.md COMMIT gate contains the id-source rule, the `task-N` ban,
      the subject⇒trailer discipline item, and the empty-commit Evidence rewrite.
- [ ] `test/test_harness_integrity.sh` passes (frontmatter, cross-references intact).

---

## Story 3: pipeline SKILL.md — dispatch injects the plan id, examples agree

**Requirement:** ADR decision item 1 (implements H2); review condition 3

As the pipeline orchestrator, I want the dispatch template and every example in my own
contract to use the plan id grammar, so that I never teach subagents the `task-N`
spelling the gate cannot match.

### Acceptance Criteria

#### Happy Path
- Given skills/pipeline/SKILL.md after the change, when the orchestrator reads step 2
  (DISPATCH) and step 5 (COMMIT), then both state the injected/verified trailer id is
  the PLAN header id (bare), with `task-N` explicitly called out as wrong.
- Given the Progress Log example (§ around line 421), when the change lands, then it
  reads `1 (User model), 2 (registration endpoint)` (or equivalent bare-id form) — no
  `task-1`/`task-2`/`task-3` ids remain anywhere in the file.

#### Negative Paths
- Given a subagent report claiming completion with a `task-N` trailer, when the
  orchestrator applies step 5 (COMMIT verification), then the contract directs it to
  treat the trailer as non-matching and have the subagent amend the commit (bare id)
  BEFORE reporting PASS — not to edit task-status.json.
- Given any remaining `task-<digit>` token in skills/pipeline/SKILL.md after the
  change, when `grep -E 'task-[0-9]' skills/pipeline/SKILL.md` runs, then it returns
  no matches (contract cannot contradict its own grammar).

### Done When
- [ ] Both edits present; `grep -E 'task-[0-9]' skills/pipeline/SKILL.md` is empty.
- [ ] `test/test_harness_integrity.sh` passes.

---

## Story 4: Recovery runbook for the two parked features

**Requirement:** ADR decision item 4 (applies H5; operator-gated)

As the operator, I want a documented, verifiable backfill procedure for
`audit-trail-write-completeness-for-retro-under-fre` and
`fix-400-stale-engine-respawn-in-place-stacks-daemo`, so that I can ship both
green-suite features through the unmodified evidence bar without history rewrite.

### Acceptance Criteria

#### Happy Path
- Given the merged fix, when the operator follows the runbook, then it instructs, per
  feature: (1) rebase/refresh the parked worktree per existing policy, (2) run the gate
  once to list still-unresolved tasks (alias resolves all prefixed-trailer tasks),
  (3) for each remaining task, verify the work exists and identify the real satisfying
  commit SHA, (4) append `git commit --allow-empty` with `Task: <id>` +
  `Evidence: satisfied-by <sha>`, (5) `conduct daemon unpark <feature>`.
- Given the runbook, when it names the expected unresolved sets, then it lists
  audit-trail tasks 5, 9, 10 and fix-400's subject-only + empty verification tasks
  (3, 13, and the unattributed remainder) as the candidates needing backfill.

#### Negative Paths
- Given a task whose work the operator CANNOT verify exists, when following the
  runbook, then the procedure says: do NOT backfill it — leave it unresolved and route
  the gap to a build kickback instead (no guessed attribution; the assumption gate that
  parked these features stays honored).
- Given a backfill commit citing a SHA that is not reachable from the feature branch,
  when the gate re-runs, then the task stays incomplete (dangling-SHA rejection —
  documented in the runbook so the operator cites branch-local SHAs).

### Done When
- [ ] Runbook committed at `docs/runbooks/evidence-backfill-recovery.md` (or the plan's
      chosen docs location) and referenced from the CHANGELOG entry.
- [ ] Runbook contains the two feature names, the expected unresolved-task sets, the
      exact commit commands, and both refusal rules above.

---

## Story 5: Repo release gates satisfied

**Requirement:** CLAUDE.md release/docs rules (harness repo)

As the harness maintainer, I want the change to satisfy this repo's own gates, so that
the release workflow and integrity suite stay green.

### Acceptance Criteria

#### Happy Path
- Given the PR, when CHANGELOG.md is read, then `## [Unreleased]` carries a `Fixed`
  entry for #417 (id grammar + alias + skill discipline) referencing the runbook.
- Given the change set (engine + SKILL.md content edits — no settings.json schema, no
  hook wiring, no symlink target, no bin/conduct CLI change), when the self-host
  release gate classifies it, then no migration block is required; if the path-based
  classifier nevertheless flags a surface, a waiver per
  adr-2026-07-06-migration-gate-waiver is committed in the same diff.

#### Negative Paths
- Given `test/test_harness_integrity.sh`, when it runs after the skill edits, then it
  exits 0 — any frontmatter/cross-reference breakage introduced by the edits fails the
  story.
- Given the full conductor suite (`rtk proxy npx vitest run` in src/conductor), when it
  runs, then it exits green — the alias change may not regress any existing test.

### Done When
- [ ] CHANGELOG `[Unreleased]` entry present.
- [ ] `test/test_harness_integrity.sh` exit 0; conductor vitest suite green.
- [ ] README/docs updated only if behavior surfaces changed (alias is internal; the
      skill contract changes are self-documenting in the SKILL.md files).
