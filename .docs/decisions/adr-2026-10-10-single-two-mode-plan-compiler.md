# ADR: Plan task structure is owned by one two-mode plan compiler

**Date:** 2026-10-10
**Status:** APPROVED
**Deciders:** operator (jstoup111), composer session for #623

## Context

The plan's machine-consumed task structure is recovered from `.docs/plans/<stem>.md` by the
shared parsers in `plan-task-parse.ts` (`TASK_HEADER_PATTERN`, `parsePlanTaskBodies` / `Paths` /
`DoneWhen` / `Titles` / `StoryIds`, `planTaskDigests`), `autoheal.ts` (`parsePlanTasks`,
`parsePlanTaskVerifyOnly`), `plan-slices.ts`, and roughly a dozen ad-hoc task-heading regexes:
`autoheal.ts:691`, `artifacts.ts:3005` and `planHasDependencyTree`, `remediation-task-append.ts:94`,
`remediation-append.ts:101`, `conductor.ts` (~4000, 4248), `protected-artifact-seal.ts:361,387`,
`kickback-ledger.ts:918`, `attribution-inputs.ts:152`, and `coherence-validator.ts:629,857`.
These grammars disagree today in heading level, separators, multi-id headings, fence handling,
and span (where a task's text ends). Each new authoring variation is a latent parser break; the
#578 → #615 → #620 → #622 → #3094 chain is that class.

The same disagreement means "today's behavior" is per-consumer, not one grammar. For example,
`### Task 1, 2: x` is two tasks to `TASK_HEADER_PATTERN` and zero to `parsePlanTasks`, and
`conductor.ts:4248`'s authored-task count, which sets the remediation growth cap, also counts
`## Task Dependency Graph`. Unifying these for an in-flight plan would flip verdicts mid-build.

Constraints:

- `.docs/plans` is sealed (`protected-artifact-seal.ts`); the only build-time plan change is an
  engine-appended `### Task <id>:` remediation tail, with no other heading.
- Daemon discovery vets merged specs on main without passing through land
  (`daemon-backlog.ts`).
- Task digests drive the reopen flow (adr-2026-09-06-reopened-task-resolution); a digest change
  for an unchanged plan reopens finished tasks.
- `skills/plan` ships to consumer repos, which may run older engines.

## Options Considered

### Option A: Authored JSON sidecar beside the plan
- **Pros:** consumers read JSON directly.
- **Cons:** two authored sources of the same facts; land must still parse Markdown to check
  agreement; a build-time JSON write trips the seal.

### Option B: Engine-generated committed JSON
- **Pros:** one authored source.
- **Cons:** same seal conflict; stale after remediation-append or an operator amendment;
  undefined for discovery and for consumer plans that never pass land.

### Option C: One compiler, strict for new plans, every legacy behavior preserved for old plans
- **Pros:** one module owns task recognition; new plans get one grammar refused at land;
  unmarked plans keep exactly today's per-consumer behavior, so no in-flight verdict changes;
  nothing derived is written to disk.
- **Cons:** the legacy half of the module carries today's disagreeing grammars until a later
  deletion feature.

### Option D: One compiler, one unified legacy grammar
- **Pros:** fewer grammars immediately.
- **Cons:** in-flight builds change verdicts (growth cap, attribution set, autoheal multi-id
  tasks); each delta needs its own mitigation.

## Decision

We chose Option C. It puts one module in charge now, refuses bad new plans at authoring time,
and makes the upgrade invisible to plans already in flight. The cost is temporary and bounded:
the legacy grammars are relocated, not deleted, and removing them is a separate follow-up
feature (operator-directed intake).

1. **One compiler module owns task recognition.** No engine module outside the plan compiler
   matches a task heading or reads a per-task plan field from plan Markdown. Every consumer of
   task ids, titles, dependency edges, declared paths, Done when, story ids, verify-only, slices,
   bodies, digests, or task counts calls the compiler.
2. **The mode is selected by a format marker.** `/plan` stamps a plain (non-heading) marker line
   in the plan header, before the first task heading and outside any fence. A marked plan
   compiles in strict mode; an unmarked plan compiles in legacy mode. A marker anywhere else is a
   compile error. Because it is not a heading, older engines ignore it and no task digest moves.
3. **Strict mode is one closed grammar.** A task heading is exactly `### Task <id>: <title>`, with
   one id from the existing H9 id grammar; multi-id headings and ranges are refused. A task owns
   its text until the next heading at its level or above, and that one span feeds every field.
   Authored tasks must declare Files, Story, Dependencies, and Done when. Every dependency edge
   must name a declared task, and the dependency graph must be acyclic. A Dependencies line is
   `none` or a comma list of task references (optionally prefixed `Task`/`Tasks`, optionally
   annotated in parentheses), the grammar adr-2026-09-29-plan-slice-manifest D4 already applies to
   sliced plans; ranges and prose are refused. References resolve through the shared
   `resolvePlanTaskReference`. Story-line values keep today's grammar, including non-story values
   and free-form infrastructure labels. A marked plan with no tasks is a compile error. Engine-appended
   remediation tasks are a separate task class with only the fields the remediation renderer
   emits, and keep the h3-with-colon shape so the seal's append check is unchanged. Violations
   are a list of named compile errors (line, task, rule).
4. **Legacy mode preserves every consumer's current behavior exactly.** Each existing
   per-consumer interpretation is relocated into the compiler as a named legacy view whose
   output for any unmarked plan equals that consumer's output today, quirks included. This
   includes the shared parsers' differing span rules, `parsePlanTasks`' title-required single-id
   rule, the authored-task count, the attribution and coherence h3 readings, and
   `planHasDependencyTree`. Task digests for an unmarked plan are byte-identical to today's.
5. **Compilation is pure and memoized only in process.** The compiler is a function of plan text;
   its memo is keyed by that text's sha256. Caller-specific inputs, such as the feature
   description `parsePlanTaskPaths` uses for protected-path filtering, are applied by the caller
   after compilation, never folded into the memo key. The same holds for the engine's record of
   appended remediation task ids: the plan check applies it to the compiled plan to classify tasks
   as appended or authored, then enforces the authored-task required fields, reporting any
   violation with the compile errors.
   Commit-boundary scope containment keeps counting only an explicit Files declaration line
   (`**Files:**`, `**Files**:`, or `**Files likely touched:**`), never paths harvested from prose
   (adr-2026-08-02-plan-scope-containment-at-commit-boundary); the compiled result records
   whether each task's paths came from a declaration line so it can. Nothing derived is written to disk.
6. **Strict errors fail loudly at the point of use.** Engineer land refuses a marked plan with
   compile errors and names every error. Daemon discovery skips a marked plan with compile errors
   (including a missing dependency declaration) under blocked reason `plan-compile-failed`, which
   takes precedence over `no-dependency-tree`, with the errors in the remedy. At land, compile
   errors are reported first, then the task-count hard stop, then coherence checks.
   Unmarked plans keep today's discovery check unchanged. A marked plan that stops compiling
   mid-build (for example after an operator amendment) raises one `needs-human` halt at plan
   read naming every error; no consumer may treat a compile failure as an empty plan.
7. **Remediation append stays an append.** The renderer writes canonical remediation-class tasks,
   recompiles the plan to confirm the appended ids, and fails loudly if they do not compile. The
   seal takes the appended task ids from the compiler but keeps refusing any non-task heading in
   the appended tail.

## Consequences

### Positive
- Heading-shape drift in a new plan is a land-time error naming the line, not a build-time
  phantom task or false park.
- One place to read when asking what the engine thinks a plan's tasks are.
- No in-flight build, merged-unbuilt spec, or consumer plan changes behavior on upgrade.

### Negative
- The legacy half carries roughly a dozen relocated grammars until the deletion feature lands.
- Strict refusal reaches consumer projects that skip engineer land only at discovery, later than
  for this repository.
- Stripping the marker from a plan silently returns it to legacy mode; the seal blocks this at
  build time, but an operator reseal can still do it.

### Follow-up Actions
- [ ] Implement per the plan for `plan-task-dependencies-should-be-a-machine-readabl`.
- [ ] File the follow-up intake: delete legacy mode once no unshipped unmarked plan remains.
