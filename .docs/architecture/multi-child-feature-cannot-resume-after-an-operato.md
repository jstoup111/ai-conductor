# Components and sequences: Stacked slice topology from the sealed plan

**Last updated:** 2026-10-23
**Scope:** To-be slice-topology source for stacked features after the `coverage_binding` step is
removed, for jstoup111/ai-conductor#3365 (folds #3366). Feature:
`multi-child-feature-cannot-resume-after-an-operato`. Covers the slice-topology loader, its readers,
the reseal position guard, the child cursor, and the resume preflight HALT. Flat (N=1) paths are
shown only to mark them unchanged.

## Component diagram

```mermaid
graph TD
  plan["Sealed plan .docs/plans/«stem».md (## Slices)"] --> loader["NEW: slice-topology loader (slice-topology.ts)"]
  stories["Sealed stories"] --> loader
  config["Project config (stacked_prs, step registry)"] --> loader
  pure["plan-slices.ts pure functions (unchanged): validatePlanSlices, deriveStoryOwnership, evaluateStackEligibility"] --> loader
  posRef["Durable positions ref refs/conductor/«slug»/positions"] --> loader
  loader --> cursor["Child cursor: resolveActiveChild (envelope-missing becomes topology-unavailable)"]
  loader --> lifecycle["Child lifecycle: start child, enter region"]
  loader --> taskScope["Task progress, task CLI, task-membership commit hook"]
  loader --> evidence["Acceptance evidence and acceptance child input"]
  loader --> finishPub["Finish stack publication"]
  loader --> routing["Routed whole-feature repair"]
  loader --> surfaces["Dashboard and daemon observe"]
  reseal["reseal CLI"] -->|"CHANGED: refuse when plan positions differ from the ref"| posRef
  reseal -.->|"REMOVED: coverage-binding void"| gone["REMOVED: coverage_binding step, envelope, void, decide-set, rebase refresh, events"]
  preflight["Resume stack preflight"] --> cursor
  preflight -->|"CHANGED: unresolvable writes HALT with cause and recovery command"| halt["needs-human HALT + loop_halt event"]
  cfgLoad["Config loader"] -->|"CHANGED: coverage_binding and steps.coverage_binding warned and ignored"| config
  skill["skills/coverage-binding/SKILL.md (kept: plan §7a judge policy)"]
```

## Sequence: resume after a reseal or a worktree recreation

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Reseal as reseal CLI
  participant Daemon as Daemon dispatch
  participant Pre as Stack preflight
  participant Cur as Child cursor
  participant Load as Slice-topology loader
  participant Plan as Sealed plan and stories
  participant Ref as Positions ref
  participant Region as Child region «n»
  Op->>Reseal: reseal --slug «slug» --path «plan» --clear-halt
  Reseal->>Load: positions of the proposed plan
  Load->>Plan: validatePlanSlices
  Reseal->>Ref: compare with recorded positions
  Ref-->>Reseal: equal, so rebaseline (no void)
  Daemon->>Pre: dispatch (resume)
  Pre->>Cur: resolveActiveChild
  Cur->>Load: load topology
  Load->>Plan: slices, membership, story ownership
  Load->>Ref: child state exists, so positions must match
  Load-->>Cur: sliced
  Cur-->>Pre: active child «n»
  Pre-->>Daemon: clear
  Daemon->>Region: resume region steps for child «n»
  Note over Load,Ref: A recreated worktree reads the same committed plan, so no cache needs rebuilding
```

## Sequence: refused reseal and unresolvable cursor

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Reseal as reseal CLI
  participant Pre as Stack preflight
  participant Cur as Child cursor
  participant Halt as HALT writer
  Op->>Reseal: reseal a plan that moves a slice position
  Reseal-->>Op: refused, naming recorded and proposed positions
  Pre->>Cur: resolveActiveChild
  Cur-->>Pre: topology-unavailable (cause), git-error, or detached-head
  Pre->>Halt: needs-human HALT naming the cause and one recovery command
  Halt-->>Pre: loop_halt emitted on the event spine
  Note over Pre,Halt: The run ends with its own HALT, never the daemon's generic "loop ended without DONE or HALT"
```

## Legend

- **NEW**, **CHANGED**, and **REMOVED** mark what this feature adds, alters, or deletes. Other nodes keep today's behavior.
- «slug», «stem», and «n» are placeholders for the feature slug, plan stem, and child position.
- Flat (N=1) features have no child state and no positions ref. The cursor returns `no-child` and the loader's positions check never runs.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-23 | Initial generation | DECIDE for #3365 (folds #3366) |
