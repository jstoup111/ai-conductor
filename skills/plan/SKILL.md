---
name: plan
implicit_invocation: required
description: "Use after stories are written and conflict-check has passed clean. Converts user stories into a step-by-step implementation plan with 2-5 minute task granularity."
enforcement: gating
phase: decide
standalone: false
requires: [".docs/stories/ with both paths", ".docs/conflicts/ clean pass or no blocking conflicts", verify-claims]
---

## Purpose

The **technical implementation plan** (`HOW`) that `build` ships from — the bridge between the
behavioral stories (`WHAT`) and shipped code. Stories say *what* the system should do; the plan
decides *how*: the technical approach, which files change, the 2–5 min TDD tasks, and their
dependencies/sequencing. Any agent can execute it with zero additional context.

This is **not** a re-listing of the stories. It adds the engineering layer they don't carry:
architecture/approach, file-level changes, task ordering, and dependencies. Traceability runs
PRD `FR-N` → story → task. Every acceptance criterion maps to at least one task; negative-path
stories become explicit test tasks — not afterthoughts.

**Correctness gate:** a plan encodes technical assumptions (which files change, how a subsystem
behaves, what an API accepts). Apply the `/verify-claims` protocol before finalizing tasks —
prefer one cheap `Read`/`grep` over a guess, attach a grounded confidence % to claims you cannot
cheaply verify, and HARD-BLOCK (operator approval interactive, HALT if autonomous) on any
unconfirmed assumption that changes the technical approach or task breakdown.

Open with a short **Technical Approach** (a paragraph or few bullets: the design decisions,
key modules/files, and sequencing) before the task list, so `build` has the shape of the work
before the steps.

When the approach relies on a local implementation or test pattern, capture only the focused
context an implementer needs: the relevant traits, why they fit this work, allowed variation, and
search hints for finding comparable code or tests. This is semantic author guidance, not a new
header or parser contract. An implementation task affected by that pattern repeats its relevant
subset in its own steps, because isolated implementers do not receive the full plan. Do not anchor
the guidance to line numbers or snapshots. If the local pattern does not fit, or a departure would
change that task's approach, record the verified no-fit result or the authorized departure in that
task before BUILD begins.

Keep this focused pattern context distinct from the exact-copy declaration: use the existing paired
`**Pattern-source:**` and `**Rename-map:**` headers only when the plan replicates a source pattern,
and preserve their existing separate semantics and grammar.

Read the `Scope boundary:` from `.docs/track/<slug>.md` as binding; preserve the confirmed narrow/comprehensive breadth outcome; do not permit a materially broader expansion beyond it unless the operator confirms before it enters the artifact.

### Documentation boundary

Never create plan tasks, subtasks, requirements, verification items, or notes for writing or
updating ordinary project documentation—even when it accompanies functional work. Documentation-only
requests belong to `/explore`'s direct delivery route. Plans cover only functional behavior and its
implementation.

### Amending a sealed plan

The first BUILD entry seals DECIDE artifacts. If an operator approves a plan or architecture
amendment after that boundary, committing the amendment does not update the existing
`.pipeline/protected-artifact-seal.json`; the old baseline is intentionally retained until the
change is reviewed and audited.

Before clearing the resulting seal HALT or re-queueing the feature, review the exact protected
artifact diff and rotate the seal with the engine-owned reseal procedure in the stalled-feature
runbook. Record the approved paths and use an honest operator-review trigger. A pre-rebase seal
refusal is not a git conflict: do not invoke the rebase resolver or run `git rebase --continue`.

## Practices

### 1. Validate Preconditions

**GATE: Refuse to produce a plan without these artifacts:**

- [ ] Stories exist in `.docs/stories/` for the feature being planned
- [ ] Every task carries a `**Dependencies:**` line (use `none` when independent) or the plan
      includes a `## Task Dependency Graph` section — daemon discovery refuses merged specs
      whose plans lack a dependency tree
- [ ] Every story has both happy and negative paths
- [ ] Conflict-check has passed (check `.docs/conflicts/` for recent clean pass, or no blocking conflicts)

If preconditions are not met, state which are missing and suggest the appropriate skill.

### 2. Read All Stories

**Skip redundant exploration:** If exploration was already performed in this session (e.g.,
during explore), use the existing exploration results. Do not re-explore the same scope —
pass the summary to the Plan agent instead of dispatching new Explore agents.

Load every story for the feature from `.docs/stories/`. For each story, extract:
- All happy path acceptance criteria
- All negative path acceptance criteria
- Any dependencies between stories (shared entities, sequencing)

### 3. Generate Implementation Tasks

Break stories into tasks at **2-5 minute granularity**. Each task follows the TDD cycle:

```markdown
### Task [N]: [Descriptive title]
**Story:** [Reference to story and specific acceptance criterion]
**Type:** happy-path | negative-path | infrastructure | refactor

**Steps:**
1. Write failing test: [Specific test description with expected assertion]
2. Verify test fails (RED)
3. Implement: [Specific implementation description]
4. Verify test passes (GREEN)
5. Commit with message: "[descriptive message]"

**Files likely touched:**
- [file path] — [what changes]

Write file paths **repo-relative** (e.g. `src/engine/foo.ts`, not
`foo.ts`): the build evidence gate corroborates each task's commits against these
paths. Basename/suffix forms are tolerated (matched at `/` boundaries, #425), but
repo-relative paths corroborate precisely and never collide.

**Verify-only:** [yes, or omit — see 3b below]

**Preserves:** [optional behavior or contract whose coverage must not regress — see 3c below]

**Dependencies:** [Task N that must complete first, or "none"]
```

The `**Files:**` line is authoritative for the build evidence gate: each task's
commits are corroborated against exactly these paths (#424). Paths may be
plain text or backticked, `;`/`,` separated, on the line or as bullets under
it. `same` inherits the previous task's set, `same as Task N` inherits task
N's, and `none` means the task's commit trailer alone corroborates. Backticked
file names elsewhere in the task (Steps prose) are only used when no Files
line exists.

When a task is affected by local pattern context from Technical Approach, repeat the applicable
traits, rationale, allowed variation, and search hints in that task's Steps prose. Do not add a
new task header, parser grammar, line-number anchor, or snapshot reference for this context. Where
the task cannot follow the pattern and that changes its approach, its Steps must state either the
verified no-fit result or the authorized departure.

For test-owning tasks, map every covered acceptance criterion to a concrete, lowest-sufficient test
disposition: name the test layer and the assertion or existing coverage that proves it. Several
compatible criteria may be covered together by one focused test; do not prescribe a distinct test
per criterion, or a production-file change merely to create one. The task must still make clear
which criterion each disposition covers, including negative paths.

**Sealed-artifact prohibition:** A task MUST NOT name another feature's artifact under
`.docs/architecture/`, `.docs/plans/`, `.docs/specs/`, or `.docs/stories/` in its `**Files:**`
set (including an inherited `same` set). DECIDE performs any required amendment before this plan is
authored; BUILD must never receive that mutation as a task. A path naming this plan's own feature is
not prohibited.

### 3a. No Terminal Catch-All Validation Task

A plan MUST NOT end with a catch-all validation task whose purpose is to prove, validate, confirm,
or re-run the completed feature as a whole. Do not create a terminal "did everything work?",
"end-to-end proof", "full-flow validation", or similar task after the behavior-owning implementation
tasks. `/writing-system-tests` authors the story-level acceptance specs at BUILD entry, before
implementation; the native
`test-suite` gate, `/manual-test`, `/prd-audit`, and the as-built `/architecture-review` validate the
completed feature afterward.

Keep scoped RED/GREEN tests inside the implementation task that owns the behavior or wiring. A
behavior-specific integration task is valid only when it implements a named production integration
point, not when it merely exercises the already-completed feature or promises to repair unspecified
findings. Aggregate `test-suite` failures and `/manual-test` failures return directly to BUILD for
scoped repair. Blockers from `/prd-audit`, as-built `/architecture-review`, and `/finish` route
through `/remediate` to the appropriate SDLC step or the required human decision. Do not pre-create
a speculative "fix anything uncovered" task.

### 3b. `Verify-only:` Marker

A task block MAY include a `**Verify-only:** yes` line to declare that the task is
expected to prove existing behavior already satisfies its acceptance criteria, rather
than land new code. The match is exact (case-insensitive) on the literal value `yes`;
any other value, or the line's absence, means the task is NOT verify-only.

Use `**Verify-only:** yes` (or `**Type:** verification`) for a task that verifies or
documents behavior that may already exist. This marker is review-load-bearing evidence
for the Tautology and Completeness reviews. Never mark a task that delivers new or
changed behavior: over-marking widens the exemption and is forbidden.

Verify-only tasks preferably complete via an empty commit rather than a code commit:
carry a `Task: <id>` trailer and an `Evidence: skipped <reason>` trailer (see
`skills/tdd/SKILL.md`'s "Commit-less Completions: Evidence Trailers" section for the
exact commit form and the sibling `Evidence: satisfied-by <sha>` form). Do not force a
throwaway code change onto a task just to produce a corroborating commit when the task's
own acceptance criteria are already met.

**Authoring note:** `build_review` also runs a non-blocking, advisory per-task
work-happened floor that flags any plan task with no `Task:`-trailered commit as a "gap"
(warning only, never a HALT). If you're authoring a task you know will legitimately produce
no commit of its own, mark it `**Verify-only:** yes` here so the floor recognizes it and
doesn't flag it.

### 3c. `Preserves:` Marker

A task block MAY include an optional, non-empty `**Preserves:** <behavior>` line to name a
behavior or contract whose coverage must not regress. State the behavior-level boundary, not its
current carrier: never name a test case, file, or `it(...)` title.

For example, `**Preserves:** the TokenMeter wrapper reports its metric transparently` names a
behavior. Reject `confirm the file's existing ungated self-check cases pass unchanged`: it names
file-local test cases rather than a behavior or contract, so it is not a valid preservation
declaration.

An absent or empty `**Preserves:**` value grants no preservation; ordinary holistic judgment
applies unchanged.

### 4. Task Ordering Rules

1. **Infrastructure first** — Database migrations, model definitions, route setup
2. **Happy paths before negative paths** — Build the working flow, then test failure modes
3. **Negative paths are explicit tasks** — Each negative path scenario gets its own task, not a "clean up error handling" catch-all
4. **Integration points identified** — Mark tasks where components connect for the first time
5. **Dependencies declared** — If Task 5 requires Task 3's model, say so

### 5. Plan Format

### `**Stories:**` Reference Forms

The `**Stories:**` line identifies the one stories artifact the plan covers. Use one of
these forms, each optionally followed by a human-readable trailing annotation:

```markdown
**Stories:** .docs/stories/<feature>.md
**Stories:** `.docs/stories/<feature>.md` (accepted stories)
**Stories:** [accepted stories](../stories/<feature>.md) — reviewed
```

The plain and inline-code forms name a repo-relative path. A Markdown link resolves its target
from the plan file; its target must resolve to the selected `.docs/stories/` artifact. Do not use
absolute paths, traversal outside the repository, a prose-only value, or a link to a different
stories file. Land and backlog discovery use the same resolution rule, so an invalid or unrelated
reference is refused before it can become a blocked merged spec.

### `**Pattern-source:**` and `**Rename-map:**` Header Forms

The `**Pattern-source:**` and `**Rename-map:**` lines together declare that this plan replicates
an existing source pattern. Use both lines or neither: a plan with only one line is malformed.
The Pattern-source accepts the same plain, inline-code, and Markdown link reference forms as
`**Stories:**`; the Rename-map accepts one or more ordered, comma-separated `source -> target`
pairs:

```markdown
**Pattern-source:** src/conductor/src/engine/source-pattern.ts
**Pattern-source:** `src/conductor/src/engine/source-pattern.ts` (source pattern)
**Pattern-source:** [source pattern](../../src/conductor/src/engine/source-pattern.ts) — reviewed

**Rename-map:** source-pattern -> plan-pattern-source
**Rename-map:** source-pattern -> plan-pattern-source, SourcePattern -> PlanPatternSource
```

The Pattern-source value must name a repo-relative path. The plain and inline-code forms use that
path directly; for a Markdown link, the link target is the path. Do not use an absolute path,
traversal outside the repository, an empty reference, or a prose-only value. Each Rename-map pair
must have a non-empty source and target around exactly one `->`; declaration order and case are
preserved. A malformed declaration fails closed rather than being treated as an absent pattern.

```markdown
# Implementation Plan: [Feature Name]

**Date:** YYYY-MM-DD
**Design:** [link to .docs/specs/ file]
**Stories:** [link to .docs/stories/ file]
**Conflict check:** Clean as of YYYY-MM-DD

## Summary
[1-2 sentences: what this plan builds and how many tasks]

## Technical Approach
[The HOW, before the steps: key design decisions, the modules/files involved, data shapes,
and the sequencing rationale. A paragraph or a few bullets — enough that `build` understands
the shape of the work before reading individual tasks.]

## Prerequisites
- [Any setup, migrations, or dependencies that must exist before task 1]

## Tasks

### Task 1: [Title]
...

### Task 2: [Title]
...

## Task Dependency Graph
[Simple text diagram showing which tasks block which]

## Integration Points
- After Task [N]: [What can be tested end-to-end at this point]

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
```

### 5b. Task Header Format and ID Grammar

**Task ID Grammar:** Task ids can be:
- **Numeric:** `1`, `18`, `100` (legacy, still supported)
- **Dotted:** `1.2`, `2.1.3` (for subtask notation)
- **Alphanumeric with separators:** `task_1`, `rem-adr-001`, `task-name-02`
- **Characters allowed:** `[A-Za-z0-9._-]` (letters, digits, dots, underscores, hyphens)

Examples:
```markdown
### Task 1: Basic feature
### Task 1.2: Subtask of task 1
### Task rem-adr-001: Remediation for ADR-001
### Task task_setup_1: Project setup
```

**Trailer matching:** Commit trailers use the same id grammar for consistency:
```
Task: 1.2
Task: rem-adr-001
```

The parser and trailer matcher use identical grammar to ensure deterministic round-trip:
parse plan → extract ids → emit trailers → re-parse → identical ids.

### 6. Scope Sanity Check

After generating tasks, check the total count:

| Task Count | Action |
|---|---|
| 1-20 | Normal — proceed |
| 21-40 | Warning — surface to user: "This plan has N tasks (~X hours). Consider splitting into multiple features." |
| 41+ | Hard stop — this is likely multiple features bundled together. Break into separately plannable features and run `/stories` + `/plan` for each. |

If the user explicitly confirms a large plan, proceed — but record the decision in `.memory/decisions/`.

### 7. Coverage Check

**GATE: Every story acceptance criterion (happy AND negative) must map to at least one task.**

After generating the plan, cross-reference:
- For each acceptance criterion in `.docs/stories/`, find the task(s) that cover it
- If any criterion is uncovered, add a task
- Present the coverage mapping to the user

### 8. Save and Suggest

Save the plan to `.docs/plans/YYYY-MM-DD-<feature>.md`

### 8a. Advisory Overlap Scan

Before the plan is committed, run `conduct-ts overlap-scan --files <comma-separated Files set>` over
the union of every task's `**Files:**` paths (add `--source-ref
<issue ref>` when the feature's originating issue/intake ref is known). Surface the
rendered report to the author as-is.

This check is **advisory only — it never blocks plan authoring.** Unmerged overlap
is a heads-up for sequencing/coordination, not a precondition; proceed to save the
plan regardless of what the scan reports.

### 8a2. Blocking Protected-Target Scan

Before committing the plan, run:

```bash
conduct-ts plan-protected-targets .docs/plans/<feature>.md
```

This check is **blocking**. It must report no task/path violations before the plan is saved or
committed. If it reports another feature's sealed artifact, perform the needed amendment in DECIDE
and rewrite the task; do not waive the result or defer the mutation to BUILD.

### 8b. Update Architecture Diagrams

After saving the plan, run `/architecture-diagram` in plan-update mode to update existing
diagrams in place with the planned changes. Diagrams are mutated directly — no separate
proposed-state files are created.

### 8c. Suggest Next Step

`/architecture-review` — the plan must pass architecture review before
any code is written. The full flow from here is:

```
/plan (you are here)
  → /architecture-diagram (generate/update current-state diagrams)
  → /architecture-review (feasibility, alignment, risks — consumes diagrams, may BLOCK)
  → /writing-system-tests (failing acceptance specs from stories)
  → /pipeline or /tdd (implement until all tests pass)
```

## Verification

- [ ] Preconditions validated (stories exist, both paths, conflict-check clean)
- [ ] Every acceptance criterion maps to at least one task
- [ ] Negative paths are explicit tasks (not grouped into catch-alls)
- [ ] The plan has no terminal catch-all task that re-validates the completed feature
- [ ] Tasks are 2-5 minute granularity
- [ ] Each task has specific test and implementation descriptions
- [ ] Dependencies are declared and acyclic
- [ ] `conduct-ts plan-protected-targets .docs/plans/<feature>.md` passes with no task/path
      violations; no task targets another feature's sealed artifact
- [ ] Plan saved to `.docs/plans/`
- [ ] Coverage mapping presented to user
