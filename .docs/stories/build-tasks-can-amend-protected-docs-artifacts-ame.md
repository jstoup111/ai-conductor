**Status:** Accepted

# Technical Stories: Amendment of accepted `.docs/` artifacts belongs to DECIDE

Track: technical (no PRD — acceptance criteria live here)
Tier: M
Design: `.docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md`
Refs: jstoup111/ai-conductor#1293

## Story TS-1: DECIDE performs the amendment instead of deferring it

**Requirement:** Technical intent — authoring a change that will invalidate an existing accepted
assertion produces the amendment in the same DECIDE pass that produces the plan.

As a DECIDE skill that has just concluded an accepted assertion is falsified, I want a defined act
that writes the amendment into the artifact now, so that the correction lands on the spec branch
before BUILD exists and no later phase is asked to make it.

### Acceptance Criteria

#### Happy Path

- Given a DECIDE pass whose change falsifies an assertion in another feature's accepted story, when
  `conflict-check` detects it, then it writes the dated amendment note into that story in place and
  records a row naming the amended path in the feature's amendment ledger.
- Given an `architecture-review` that concludes an accepted assertion is falsified, when the review
  report is written, then it records a ledger row rather than instructing a later phase to amend.
- Given a `stories` pass that supersedes or modifies an existing accepted story, when the new story is
  written, then the superseded assertion carries the same dated note form and a ledger row.
- Given a feature whose DECIDE pass amended another feature's accepted story, when BUILD entry creates
  the protected-artifact seal, then the amended content is the sealed baseline and BUILD runs to
  completion with no protected-artifact halt.

#### Negative Paths

- Given an amendment note, when it is written, then the original assertion text is still present —
  the note is additive and never rewrites or deletes the text it corrects.
- Given a DECIDE pass that falsifies no accepted assertion, when it completes, then it records an
  empty ledger and writes no amendment note; the convention adds no ceremony to the common case.
- Given a ledger row naming a path that does not exist or lies outside the sealed directories, when
  the ledger is validated, then it is rejected naming the row and the path rather than silently
  accepted.

### Done When

- [ ] The dated amendment-note form is codified in the skills that may produce one, not left as
      repository folklore.
- [ ] `conflict-check`, `architecture-review`, and `stories` each perform-and-record rather than defer.
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

## Story TS-4: A mid-BUILD discovery is recorded and the build keeps going

**Requirement:** Technical intent — a mid-BUILD discovery that an accepted assertion is about to be
falsified has a defined, non-manual route that does not convert a self-healing build into an operator
interrupt.

As a BUILD session that has just learned an accepted assertion is now false, I want to record that
fact somewhere I am permitted to write, so that the knowledge survives without halting the build or
requiring a rewind the daemon cannot perform.

### Acceptance Criteria

#### Happy Path

- Given a BUILD session that concludes an accepted assertion is falsified, when it records an
  amendment request, then the request is written under the unsealed amendment directory and the build
  continues to its next step.
- Given that request, when the protected-artifact seal is next verified, then it does not fire — the
  request path lies outside the sealed directories.
- Given that request, when the `.docs` write-guard evaluates the write, then it is allowed for every
  supported provider, not only the one whose host hooks are wired.

#### Negative Paths

- Given a mid-BUILD amendment request, when it is written, then no halt marker is created, no
  kickback is queued, and no rewind to a DECIDE step is attempted.
- Given a BUILD session, when it attempts to write the amendment into the accepted artifact itself
  rather than into a request, then the existing seal refusal is unchanged — this story adds a
  sanctioned route, it does not weaken the ban.
- Given a build with no mid-BUILD discovery, when it completes, then no request artifact is created.

### Done When

- [ ] The amendment directory is on the `.docs` write allowlist and outside the sealed set, with both
      properties proven.
- [ ] A recorded request is proven not to halt, kick back, or rewind.
- [ ] A direct write to a sealed artifact from BUILD is proven to still refuse.

## Story TS-5: An unresolved amendment request fails closed at SHIP

**Requirement:** Technical intent — the accepted story corpus never silently contradicts shipped
behavior; if an assertion is falsified and not amended, something fails closed and says so.

As the operator, I want a shipped feature that falsified an accepted assertion to say so in its pull
request and leave a tracked follow-up, so that the corpus can be temporarily stale but never
silently wrong.

### Acceptance Criteria

#### Happy Path

- Given a feature carrying an unresolved amendment request, when `finish` runs, then the request's
  content is carried into the pull-request body and a follow-up issue is filed for the amendment.
- Given a feature carrying no unresolved request, when `finish` runs, then its behavior is unchanged.

#### Negative Paths

- Given an unresolved request that could not be carried into the pull-request body or filed, when
  `finish` runs, then it refuses to report completion and names the request it could not surface —
  the failure is on the silence, never on the build.
- Given a request whose amendment was already performed during the same feature's DECIDE pass, when
  `finish` runs, then it is treated as resolved and raises nothing.
- Given the SHIP fail-closed condition, when it triggers, then the build's own verification verdicts
  are untouched — it reports an unsurfaced amendment, not a build failure.

### Done When

- [ ] An unresolved request is proven to reach both the pull-request body and a filed follow-up.
- [ ] Failure to surface is proven to fail closed with the request named.
- [ ] A resolved request and a feature with no requests are both proven to change nothing.

## Story TS-6: Remediation never routes a sealed-artifact amendment back to BUILD

**Requirement:** Technical intent — a remediation finding that requires changing a protected DECIDE
artifact is never routed to the phase whose seal rejects it.

As the remediation planner, I want a gap that requires amending another feature's sealed artifact to
take the recorded-request route, so that it cannot be dispatched into a phase guaranteed to halt on it.

### Acceptance Criteria

#### Happy Path

- Given a remediation gap whose fix requires amending another feature's sealed artifact, when
  dispositions are assigned, then it is recorded as an amendment request rather than given a `build`
  or `acceptance_specs` disposition.
- Given a remediation gap requiring a change to the feature's **own** plan, when dispositions are
  assigned, then the existing plan-append behavior is unchanged.

#### Negative Paths

- Given a remediation gap of any other category, when dispositions are assigned, then the existing
  routing table is unchanged — this story narrows one case, it does not restructure remediation.
- Given a remediation gap routed to an amendment request, when the loop continues, then no DECIDE
  rewind is attempted and the existing operator-only DECIDE gate is never reached on its account.

### Done When

- [ ] A sealed-artifact remediation gap is proven to take the request route.
- [ ] Own-plan append is proven unchanged.
- [ ] Every other disposition is proven unchanged.
