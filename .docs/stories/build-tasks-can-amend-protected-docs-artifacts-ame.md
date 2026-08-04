**Status:** Accepted

# Technical Stories: DECIDE mutates accepted `.docs/` artifacts; no task may

Track: technical (no PRD — acceptance criteria live here)
Tier: M
Design: `.docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md`
Refs: jstoup111/ai-conductor#1293

## Story TS-1: DECIDE performs the mutation instead of deferring it

**Requirement:** Technical intent — authoring a change that will invalidate an existing accepted
assertion produces the amendment in the same DECIDE pass that produces the plan.

As a DECIDE skill that has just concluded an accepted assertion is falsified, I want to write the
amendment into that artifact now, so that the correction lands on the spec branch before BUILD exists
and no later phase is asked to make it.

### Acceptance Criteria

#### Happy Path

- Given a DECIDE pass whose change falsifies an assertion in another feature's accepted story, when
  `conflict-check` detects it, then it writes the dated amendment note into that story in place during
  the same pass.
- Given an `architecture-review` that concludes an accepted assertion is falsified, when the review
  completes, then the amendment has been performed rather than described as work for a later phase.
- Given a `stories` pass that supersedes or modifies an existing accepted story, when the new story is
  written, then the superseded assertion carries the same codified dated-note form.
- Given a feature whose DECIDE pass amended another feature's accepted story, when BUILD entry creates
  the protected-artifact seal, then the amended content is the sealed baseline and BUILD runs to
  completion with no protected-artifact halt.

#### Negative Paths

- Given an amendment note, when it is written, then the original assertion text is still present —
  the note is additive and never rewrites or deletes the text it corrects.
- Given a DECIDE pass that falsifies no accepted assertion, when it completes, then it writes no
  amendment note and creates no artifact; the convention adds no ceremony to the common case.
- Given a DECIDE pass that performs an amendment, when it completes, then it produces no separate
  record file — the mutated artifact and its git history are the only record.

### Done When

- [ ] The dated amendment-note form is codified in the skills that may produce one, not left as
      repository folklore.
- [ ] `conflict-check`, `architecture-review`, and `stories` each perform the mutation rather than
      defer it.
- [ ] An end-to-end proof shows a DECIDE-authored amendment landing in the seal baseline and BUILD
      completing without a halt.
- [ ] A no-amendment DECIDE pass is proven to add no artifact churn.

## Story TS-2: A plan task naming another feature's sealed artifact is rejected while it can still be fixed

**Requirement:** Technical intent — a plan whose task would edit a protected `.docs/` artifact is
rejected deterministically at authoring time, naming the task and the protected path.

As a plan author, I want the plan refused the moment it directs an edit to a sealed artifact, so that
the violation surfaces where it can be corrected rather than as a seal halt hours into a build.

### Acceptance Criteria

#### Happy Path

- Given a plan with a task whose `**Files:**` line names a file under a sealed directory belonging to
  another feature, when the authoring check runs, then it fails and its message names the offending
  task id and the protected path.
- Given the observed incident's own plan and its Task 14, when the check runs against it, then it
  fails naming Task 14 and both story paths.
- Given a plan whose tasks name only unsealed paths, when the check runs, then it passes.
- Given a plan task naming a path under a sealed directory whose stem names the plan's **own**
  feature, when the check runs, then it passes — own-feature amendment is already tolerated by the
  seal and is relied on by remediation task append.

#### Negative Paths

- Given a plan task naming a `.docs/` path outside the four sealed directories, when the check runs,
  then it passes; this check governs sealed artifacts, not all of `.docs/`.
- Given a task that inherits its file set via `same` or `same as Task N` from a task naming a sealed
  path, when the check runs, then the inheriting task is judged on the resolved set and fails too.
- Given a plan with no violations, when the check runs, then it writes nothing and mutates no file.
- Given the check, when the definition of which directories are sealed changes in the engine, then the
  check follows it without a second edit — it reads the engine's set rather than its own copy.

### Done When

- [ ] The check is reachable as a blocking command and is invoked by the plan-authoring skill.
- [ ] The message names both the task id and the path for every violation, not just the first.
- [ ] Own-feature and non-sealed paths are proven to pass.
- [ ] `same` / `same as Task N` inheritance is proven to resolve before judgement.
- [ ] The sealed-directory set and own-feature predicate are proven to come from the engine, not a
      duplicated literal.

## Story TS-3: The same violation cannot reach a daemon through a merged spec

**Requirement:** Technical intent — enforcement does not depend on an agent having chosen to run the
authoring check.

As the engine, I want a merged spec whose plan directs a sealed-artifact edit refused before any
daemon can build it, so that prompt discipline is never the only thing standing between a violation
and a seal halt.

### Acceptance Criteria

#### Happy Path

- Given a spec being landed whose plan contains a task naming another feature's sealed artifact, when
  the land gate runs, then the land is refused and the failure names the task id and the path.
- Given a spec whose plan contains no such task, when the land gate runs, then the land proceeds.

#### Negative Paths

- Given a spec that already satisfies every other land gate, when it fails only this one, then the
  worktree is kept for inspection exactly as other land-gate failures do — this gate introduces no
  new failure handling.
- Given plans merged before this gate existed, when the daemon builds them, then they are unaffected;
  the gate judges the spec being landed, not the historical corpus.
- Given a spec whose tier skips conflict-check, when it is landed, then this gate still runs — it is
  not tier-conditional.

### Done When

- [ ] The gate runs inside the existing land-gate sequence and reuses its failure handling.
- [ ] A violating spec is proven refused and a clean one proven to land.
- [ ] Tier independence is proven.

## Story TS-4: A BUILD-discovered falsification returns to DECIDE, never to BUILD

**Requirement:** Technical intent — a remediation finding that requires changing a protected DECIDE
artifact returns to its owning DECIDE phase; it is never routed back to BUILD.

As the remediation planner, I want a gap that requires amending another feature's sealed artifact
routed to the phase that owns the mutation, so that it can never be dispatched into a phase guaranteed
to halt on it and so that no parallel record is invented to avoid the trip.

### Acceptance Criteria

#### Happy Path

- Given a remediation gap whose fix requires amending another feature's sealed artifact, when
  dispositions are assigned, then it is routed to its owning DECIDE step and never given a `build` or
  `acceptance_specs` disposition.
- Given that routing in daemon mode, when the loop evaluates it, then it reaches the existing
  operator gate rather than any new gate introduced by this change.
- Given a remediation gap requiring a change to the feature's **own** plan, when dispositions are
  assigned, then the existing plan-append behavior is unchanged.

#### Negative Paths

- Given a remediation gap of any other category, when dispositions are assigned, then the existing
  routing table is unchanged — this story narrows one case, it does not restructure remediation.
- Given a BUILD session that discovers a falsified accepted assertion, when it proceeds, then it
  writes no request artifact, no ledger, and no record outside the sealed artifact — the finding
  travels through remediation only.
- Given a BUILD task that edits a sealed artifact despite the rule, when the seal is verified, then
  the existing halt fires unchanged and names the path; this story adds no tolerance and removes no
  backstop.

### Done When

- [ ] A sealed-artifact remediation gap is proven to route to DECIDE and never to `build` or
      `acceptance_specs`.
- [ ] The existing operator gate is proven to be the one reached, with no new gate added.
- [ ] Own-plan append and every other disposition are proven unchanged.
- [ ] The seal's existing halt is proven unchanged as the fail-closed backstop.
