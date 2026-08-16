**Status:** Accepted

# Stories: remediation context pointer joins (#1620)

Technical track — acceptance criteria derived from the approved approach: engine-side
deterministic joins at remediation-dispatch time, injected as compact pointers only.

## Story 1: Remediation context carries a plan-contract pointer

As the remediation agent, I want the dispatch context to reference the governing plan
task for each finding so that my repair honors the plan's contract instead of greedy-
patching the finding text.

### Acceptance Criteria

#### Happy Path
- Given a build_review finding that carries a `planTask` anchor resolvable to a task in
  the feature's plan, when the engine dispatches /remediate for that finding, then the
  dispatch context contains a pointer line with the plan file path, the plan task id,
  and the finding's anchor — and does NOT inline the task's Steps text.
- Given a finding from a non-completeness rubric whose changed files map to exactly one
  plan task via the engine's task→files mapping, when /remediate is dispatched, then the
  same pointer form is injected for that task.

#### Negative Paths
- Given a finding whose anchor resolves to no plan task (missing, ambiguous, or drifted
  id), when /remediate is dispatched, then dispatch proceeds unchanged with no
  plan-contract pointer and no error — the join is advisory and fail-open.

### Done When
- [ ] Dispatch context for an anchored finding contains `plan:` pointer text with file
      path + task id + anchor (assertable in a unit test of the context builder).
- [ ] Dispatch context contains no plan task Steps content (assert absence of the
      mapped task's Steps text).
- [ ] An unresolvable anchor produces the same dispatch context as today (byte-equal
      apart from the absent pointer), exit path non-blocking.

## Story 2: Remediation context carries prior-attempt pointers

As the remediation agent, I want the dispatch context to reference prior laps that
flagged the same site so that I know this is a repeat attempt and can read why earlier
repairs failed.

### Acceptance Criteria

#### Happy Path
- Given a finding whose anchor matches a finding persisted in an earlier
  `.pipeline/build-review/lap-*` of the same build, when /remediate is dispatched, then
  the dispatch context contains one pointer per prior same-anchor finding (lap artifact
  path + finding id) and an attempt count — and does NOT inline the prior findings'
  bodies or evidence.

#### Negative Paths
- Given no prior lap contains a same-anchor finding (first attempt, or identity drift
  per #1611 prevents a match), when /remediate is dispatched, then dispatch proceeds
  unchanged with no history pointer and no error — fail-open.
- Given a prior lap directory is unreadable or malformed, when the engine scans laps,
  then the scan skips it without failing dispatch.

### Done When
- [ ] Dispatch context for a repeat-anchor finding contains `prior attempts:` pointer
      lines with lap paths + finding ids + count (unit-testable).
- [ ] Prior finding body text is absent from the dispatch context.
- [ ] First-attempt and unmatchable-anchor cases dispatch identically to today.

## Story 3: The remediate skill directs the agent to read the referenced files

As the operator, I want /remediate to instruct the agent to read the pointed-to plan
task and prior-lap findings so that the pointers are consumed rather than ignored,
without the engine inlining content.

### Acceptance Criteria

#### Happy Path
- Given the dispatch context contains plan-contract and/or prior-attempt pointers, when
  the /remediate skill runs, then its SKILL.md instructs the agent to read each
  referenced file before planning repairs, and to treat the plan task's Steps as the
  governing contract for the repair.

#### Negative Paths
- Given the dispatch context contains no pointers (both joins missed), when /remediate
  runs, then the skill's instructions still permit the agent to locate the plan and
  `.pipeline/build-review/lap-*` directly by path, so a missed join never leaves the
  inputs undiscoverable.

### Done When
- [ ] `skills/remediate/SKILL.md` names both pointer kinds and mandates reading the
      referenced files before planning.
- [ ] SKILL.md states the fallback paths (`.docs/plans/`, `.pipeline/build-review/lap-*`)
      for the no-pointer case.
- [ ] Harness integrity validation passes (frontmatter, references).
