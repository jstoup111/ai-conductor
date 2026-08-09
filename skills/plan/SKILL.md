---
name: plan
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

**Wired-into:** [where the new production surface is called from, or an inheritance/waiver form — see below]

**Verify-only:** [yes, or omit — see 5d below]

**Dependencies:** [Task N that must complete first, or "none"]
```

The `**Files:**` line is authoritative for the build evidence gate: each task's
commits are corroborated against exactly these paths (#424). Paths may be
plain text or backticked, `;`/`,` separated, on the line or as bullets under
it. `same` inherits the previous task's set, `same as Task N` inherits task
N's, and `none` means the task's commit trailer alone corroborates. Backticked
file names elsewhere in the task (Steps prose) are only used when no Files
line exists.

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

### 5c. `Wired-into:` Grammar and Derivation

Every task that introduces a new production surface (exported function/module, hook
script, config key, emitted event, scheduled job, CLI subcommand, etc.) carries a
`**Wired-into:**` line. This is the plan-level contract that the §12 As-Built
Compliance Gate later checks against real `file:line` callers after implementation.

**The four forms:**

1. **Declared call site(s):** `path#symbol` — repo-relative path plus the calling
   symbol, comma-separated for multiple call sites:
   `src/engine/loop.ts#dispatchStep, bin/harness#commandTable`
2. **Inheritance:** `same as Task N` — this task's surface is wired in by the same
   call site(s) declared for Task N (e.g. a follow-up task adding a branch to
   already-wired dispatch logic).
3. **No new surface:** `none (no new production surface)` — the task only touches
   tests, docs, or refactors existing wired code without adding a new call target.
4. **Deferred/waived:** `none (inert until <ref>)` — the surface is intentionally
   not yet reachable, where `<ref>` is either a repo-relative path (path-form,
   e.g. `none (inert until src/engine/loop.ts)`) or a tracked issue
   (issue-form, e.g. `none (inert until #431)`) naming where/when it will be wired.

**Inline code is accepted:** a declared `path#symbol` site or a deferred `<ref>` may be
wrapped in Markdown inline code (`` `src/engine/loop.ts` ``); the delimiters are treated
as formatting and stripped before the path or issue ref is resolved.

**Repo-relative paths only:** as with `**Files:**`, every path used in a
`Wired-into:` line must be repo-relative and must not escape the repo via `../`.
Paths that climb outside the repo root are malformed and must be rejected.

**Derivation for Medium/Large tier:** for Medium/Large tier features,
architecture-review's `## Wiring Surface` section (see `skills/architecture-review/SKILL.md`)
is authored first, at design time, naming where each new production surface will be
called from. `/plan` reads that section and DERIVES each task's `Wired-into:` line
from it — the call sites named there become the `path#symbol` (or inheritance/waiver)
forms on the corresponding tasks. Do not invent `Wired-into:` values ad hoc when a
`## Wiring Surface` section exists; transcribe/refine what it already states.

**Mechanical validation — BLOCKING.** Grammar prose is not enforcement: an anchor form
that the wiring machinery cannot resolve produces no authoring-time error at all, and the
build then never advances a task past `pending` — a 19-task plan once spun for hours at
0/19 completed while the work was actually landing. Do not hand-check anchors. Once every
task's `Wired-into:` line is written, run:

```bash
conduct-ts validate-wired-into <path to the plan file>
```

It resolves each declared anchor through the *same* machinery BUILD-time per-task
completion verification uses (`same as Task N` inheritance is resolved first, `none (...)`
forms are skipped), and prints a per-task `PASS`/`FAIL`/`SKIP` report, exiting non-zero on
any failure. Any `FAIL` **hard-blocks the plan** — the same way `/verify-claims`'
`ASSUMPTIONS_PENDING` gate blocks on an unconfirmed load-bearing assumption. Two
resolutions, no third:

1. **Fix the anchor.** The usual cause is an anchor that names a definition rather than a
   call site (e.g. a class member that no line in the declared file literally writes).
   Name the file and symbol the new surface is actually *called from*.
2. **Escalate.** If the anchor is genuinely correct and the validator still rejects it, the
   parser or the verification layer is the defect. Surface it to the operator (HALT if
   autonomous) — do not weaken the anchor to something that merely passes, and never
   present the plan as complete with a `FAIL` outstanding.

The same validation runs again as a **blocking land gate**, at every tier, against the plan
being landed — so a plan cannot reach BUILD with an unresolvable anchor by skipping the
command above. Running it while authoring is how you see the failure early; the gate is what
makes it unavoidable.

#### Judged pass — does each resolving anchor assert real wiring?

**Run this only after the command above reports zero `FAIL` rows.** At that point every
declared anchor is already proven to resolve: its file exists and the declared symbol has a
literal non-test match in it. **Do not re-check any of that.** Resolvability is decided
mechanically and the mechanical verdict is authoritative — if the two of you ever disagree,
the validator is right and you are wrong. A judged finding can never overturn a `FAIL`, and
never converts a `FAIL` into a pass.

Judge exactly one question the matcher provably cannot answer: `verifyDeclaredSites` is a
literal text search, so it can prove a symbol *appears* in a file but not that the appearance
is a **call site**. Two shapes slip through, and both mean the anchor claims wiring that does
not exist:

1. **Self-referential anchor.** The anchor names a symbol defined in a file the *same task*
   authors, so it points at the definition of the new surface rather than at anything that
   reaches it. Detect it by comparing the anchor's path against that task's own `**Files:**`
   line: if the anchor path is a file this task creates, and the matched symbol is the surface
   this task introduces, the task has declared that its new code calls itself. This is the case
   that halted `build-post-task-tail-telemetry`: Task 9 declared
   `closeout-tail.ts#CloseoutEventTail`, a symbol in the file Task 9 creates. When that file
   does not exist yet the land gate catches it as an unresolvable anchor — but once the file
   already exists, the text search finds the definition, the gate passes, and only this pass
   can see the problem.
2. **Decorative anchor.** The match is real but is not a call: an import or re-export line, a
   comment or doc reference, a type-only annotation, or the symbol's name inside a string
   literal. Re-exporting a symbol moves it; it does not reach it. Read the matched line and ask
   whether *executing* that line invokes the new surface.

Ground every finding in the matched line's actual text, per `/verify-claims`. "This anchor
looks decorative" is not a finding — quote the line and say what it does instead of calling.
If you cannot ground it, treat the anchor as load-bearing and move on; an unproven suspicion
is not a defect.

**Enforcement: blocking, and only inside DECIDE.** A grounded finding blocks presenting the
plan as complete, because the cost of shipping it is a task whose new surface is unreachable
and whose BUILD-time wiring check will fail on work that is otherwise correct. Three
resolutions, no fourth:

1. **Name the real call site.** The usual fix — the wiring exists, the anchor pointed at the
   wrong line.
2. **Add the wiring.** If nothing calls the new surface yet, the plan is missing a task, not a
   better anchor. Add the task that wires it and point the anchor at that call site.
3. **Escalate.** If you believe the anchor is load-bearing and cannot resolve the
   disagreement, surface it to the operator with the quoted line (HALT if autonomous). Never
   present the plan as complete with an unresolved grounded finding.

**Never downgrade a judged finding to a `none (...)` form.** The deterministic gate `SKIP`s
every waiver form without inspection, so converting a self-referential or decorative anchor
into `none (no new production surface)` does not fix it — it makes it invisible to both
layers. A waiver is only honest when the task genuinely adds no new production surface.

**After any anchor edit, re-run `conduct-ts validate-wired-into`.** Every resolution above
changes an anchor, and a changed anchor is unproven until the deterministic gate re-passes.
This ordering is what keeps the two layers from ever issuing contradictory instructions: the
judged pass proposes, the mechanical gate disposes, and the plan is complete only when the
mechanical gate is green *after* the last judged edit.

**Never run this judged pass during BUILD.** It is a DECIDE-time authoring pass on a plan
that is not yet sealed. Once BUILD starts, the plan is an approved artifact, and a wiring
finding raised against it is resolved through the recorded kickback/remediation path — never
by rewriting the plan mid-build. A gate that instructs a mid-build plan-contract rewrite puts
the build agent in an unwinnable position: `build_review` reports the compliance as an
unauthorized scope violation, and the remediation re-triggers the original gate. That loop
does not terminate without a human, and it has already cost one (issue #1399). Catching these
anchors here, while the plan is still being authored, is the entire point.

**Small-tier fallback:** Small-tier features skip architecture-review entirely (see
its Lightweight Mode section), so there is no `## Wiring Surface` section to derive
from. In that case `/plan` self-authors reasonable `Wired-into:` lines directly,
using the same four-form grammar above, based on its own knowledge of where the
task's surface will be called from.

### 5d. `Verify-only:` Marker

A task block MAY include a `**Verify-only:** yes` line to declare that the task is
expected to prove existing behavior already satisfies its acceptance criteria, rather
than land new code. The match is exact (case-insensitive) on the literal value `yes`;
any other value, or the line's absence, means the task is NOT verify-only.

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
- [ ] Every task that touches new production-surface files carries a `**Wired-into:**`
      line (declared call site(s), `same as Task N`, or a `none (...)` form) — BLOCKS
      the plan's own verification if missing
- [ ] `conduct-ts plan-protected-targets .docs/plans/<feature>.md` passes with no task/path
      violations; no task targets another feature's sealed artifact
- [ ] `conduct-ts validate-wired-into <plan file>` run against the saved plan and reporting
      zero `FAIL` rows — any `FAIL` HARD-BLOCKS; fix the anchor or escalate (see 5c). Never
      present the plan as complete with an unresolved anchor
- [ ] §5c judged pass run over the anchors that already resolve — each one checked for the
      two shapes a text search cannot see: an anchor into a file the same task creates
      (compare against that task's `**Files:**` line), and a match that is an import,
      re-export, comment, type annotation, or string rather than a call
- [ ] Every judged finding grounded in the matched line's quoted text, resolved by naming the
      real call site or adding the wiring task — never by downgrading to a `none (...)` form
- [ ] `conduct-ts validate-wired-into` re-run and green AFTER the last anchor edit
- [ ] Plan saved to `.docs/plans/`
- [ ] Coverage mapping presented to user
