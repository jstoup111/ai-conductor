**Status:** Accepted

# Technical Stories: BUILD-verification member reuse after a repair

Track: technical (no PRD — acceptance criteria live here)
Tier: M
Design: `.docs/decisions/adr-2026-08-03-build-repair-member-reuse-validity.md`

## Story TS-1: A repaired BUILD rejoins verification instead of parking

**Requirement:** Technical intent — a BUILD-verification kickback and repair either rejoins
successfully or reports the actual failing verification.

As the conductor loop, I want every BUILD-verification member left in a status that the selection
predicate and the gate check read the same way, so that a repair cannot strand a passing sibling in a
state that is satisfied to one and unsatisfied to the other.

### Acceptance Criteria

#### Happy Path

- Given a BUILD-verification round where one member passes and its sibling yields no verdict, when the
  round kicks back to `build`, then both members are left in a status that the selection predicate
  treats as needing a re-run and the gate check treats as satisfied.
- Given that same round after `build` repairs the code, when the loop resumes, then both members are
  dispatched again and the run proceeds past `build_review` on their fresh verdicts.
- Given a BUILD-verification round where a member fails outright rather than yielding no verdict, when
  the round kicks back to `build`, then the passing sibling is left in that same reconciled status
  rather than whichever status it happened to hold.

#### Negative Paths

- Given a BUILD-verification member left in the reconciled status, when a downstream step's gate is
  checked, then that member does not appear in the unsatisfied-prerequisite list.
- Given the observed incident's event sequence replayed from seeded state, when the loop runs to
  completion, then it does not exit without a terminal verdict and no halt marker of the class the
  daemon refuses to re-kick is written.
- Given a kickback whose budget is already exhausted, when the round settles, then the existing
  cap-exhaustion halt is written unchanged — this story does not convert a genuine failure into a
  retry.
- Given a rebase-driven invalidation rather than a BUILD-verification kickback, when steps are reset,
  then the existing reset target and its pinned invalidation set are unchanged — this story is scoped
  to the BUILD-verification kickback branches only.

### Done When

- [ ] A reproduction test replays the observed sequence, fails before the fix for the stated reason,
      and passes after it.
- [ ] Both kickback branches are proven to leave every member of that round in the reconciled status.
- [ ] A downstream gate check is proven to pass with a prerequisite in that status.
- [ ] The existing kickback-cap and no-op-escalation halts are proven unchanged.
- [ ] The rebase invalidation path is proven untouched.

## Story TS-2: A post-repair round re-verifies every member

**Requirement:** Technical intent — after a BUILD repair changes the code state, every
BUILD-verification prerequisite whose prior verdict no longer represents that state runs again before
`build_review`.

As the conductor loop, I want no member declared satisfied on the strength of a gate verdict left on
disk by an earlier round, so that the only thing that can satisfy a member is a round that actually
verified the current code.

### Acceptance Criteria

#### Happy Path

- Given a BUILD repair has changed the code, when the verification round runs, then every non-skipped
  member of the group is dispatched, and the round's join is what declares each member satisfied.
- Given a member whose gate verdict on disk says satisfied from an earlier round, when reuse is
  considered, then that verdict alone does not exclude the member from the round.
- Given both members are dispatched, when they run, then they still fan out concurrently under the
  existing concurrency cap rather than degrading to a serial walk.

#### Negative Paths

- Given a member that the existing skip rules exclude by tier, track, upstream skip, or configuration,
  when the round runs, then it is still skipped and is not dispatched by this change.
- Given a round in which only one member needs work, when the round runs, then the existing
  width-based behavior applies and observers are not shown a member that did not dispatch.
- Given `build_review` is reached, when its prerequisites are evaluated, then every one of them was
  satisfied by the current round, not by a prior one.

### Done When

- [ ] A post-repair round is proven to dispatch every non-skipped member.
- [ ] A stale satisfied gate verdict is proven insufficient to exclude a member from the round.
- [ ] Concurrent fan-out under the existing cap is proven preserved.
- [ ] The existing skip rules are proven to still exclude the members they always excluded.

## Story TS-3: A member the repair could not affect does no redundant work

**Requirement:** Technical intent — a current sibling verdict remains reusable when the BUILD repair
did not invalidate what it verified.

As an operator, I want a re-dispatched member whose own evidence is still valid for the current code to
settle from that evidence rather than redoing its full verification, so that the concurrent
verification group keeps the speed it exists to provide.

### Acceptance Criteria

#### Happy Path

- Given a member whose own recorded evidence still corresponds to the current code state, when the
  member is dispatched in a post-repair round, then it settles from that evidence without redoing its
  full verification work.
- Given a member whose recorded evidence no longer corresponds to the current code state, when it is
  dispatched, then it derives fresh evidence and settles on that.
- Given a member that settled from still-valid evidence, when `build_review` is reached, then that
  member counts as a satisfied prerequisite for the current round.

#### Negative Paths

- Given a member that settled from still-valid evidence, when the round settles, then no retry and no
  kickback budget is charged against it.
- Given a member whose evidence validity cannot be determined, when it is dispatched, then it derives
  fresh evidence rather than settling from evidence it could not confirm.
- Given a member's existing evidence format and validity rule, when this change lands, then neither is
  modified — no second authority decides that member's validity.

### Done When

- [ ] A member with still-valid evidence is proven to settle without redoing its verification work.
- [ ] A member with invalidated evidence is proven to derive fresh evidence.
- [ ] A member that settled from valid evidence is proven to charge no retry or kickback budget.
- [ ] Each member's existing evidence format and validity rule is proven unchanged.

## Story TS-4: Review is never reached on a prerequisite the engine rejects

**Requirement:** Technical intent — `build_review` is never reached with a prerequisite state that the
engine itself considers unsatisfied.

As the conductor loop, I want a selected step whose gate would reject a prerequisite to resolve that
prerequisite instead of blocking, so that a disagreement between the selection predicate and the gate
predicate can never end the run without a verdict.

### Acceptance Criteria

#### Happy Path

- Given the loop selects a step whose gate rejects a prerequisite that the selection predicate
  considered satisfied, when the step is about to be entered, then the loop dispatches that
  prerequisite instead of entering the step.
- Given that prerequisite then produces a fresh verdict, when the loop advances, then the originally
  selected step is entered normally.

#### Negative Paths

- Given a step whose gate rejects a prerequisite that the selection predicate also considers
  unsatisfied, when the step is evaluated, then the existing blocking behavior is unchanged — this
  story resolves only the disagreement case.
- Given a prerequisite that cannot be made satisfiable by dispatching it, when the loop evaluates it,
  then the run terminates with an explicit verdict naming that prerequisite, never with a missing
  terminal marker.
- Given the resolution fires repeatedly for the same prerequisite, when the bound is reached, then the
  run halts with an explicit reason rather than looping.
- Given this resolution, when it is implemented, then it introduces no third satisfaction predicate and
  resolves only backward, never advancing the loop past a step it has not entered.

### Done When

- [ ] A selected step whose gate rejects a selector-satisfied prerequisite is proven to dispatch that
      prerequisite.
- [ ] The unchanged case — both predicates agree the prerequisite is unsatisfied — is proven
      unaffected.
- [ ] A non-resolvable prerequisite is proven to produce an explicit terminal verdict.
- [ ] The resolution is proven bounded, backward-only, and free of any new satisfaction predicate.

## Story TS-5: Reuse and recompute decisions are observable

**Requirement:** Technical intent — daemon events make reused versus redispatched group members and the
validity basis observable.

As an operator reading the daemon log, I want each BUILD-verification member's settle decision and the
basis for it, so that I can tell a justified reuse from a self-inflicted one without reconstructing it
from gate timestamps.

### Acceptance Criteria

#### Happy Path

- Given a member that settled from still-valid evidence, when the round settles, then an event names
  the member, the reuse decision, and the basis for it.
- Given a member that derived fresh evidence, when the round settles, then an event names the member,
  the recompute decision, and which basis forced it.
- Given either event, when the daemon log is read, then the decision and its basis are legible there
  without inspecting the event file.

#### Negative Paths

- Given a new event type, when the event sink registry is evaluated, then the type is declared and
  reaches a sink — it is not silently dropped.
- Given the registry's existing equivalence assertion against pre-refactor sink membership, when new
  types are added, then that assertion still holds for the types it was written to cover and is not
  broken by the additions.
- Given a decision event, when it is written, then it carries no secret, credential, or absolute host
  path.

### Done When

- [ ] Reuse and recompute each emit a decision event carrying the member and the basis.
- [ ] Both events are proven to reach a sink through the registry.
- [ ] The existing sink-membership equivalence assertion is proven still valid.
- [ ] Both events are proven to render in the daemon log.
- [ ] The rendered output is proven free of secrets and absolute host paths.
