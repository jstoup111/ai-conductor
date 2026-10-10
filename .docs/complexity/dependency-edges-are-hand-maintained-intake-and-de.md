# Complexity: Dependency edges are hand-maintained — intake and DECIDE never create or verify blocked_by links

Tier: M

## Rationale

- One new engine module, a dependency reconciler. It computes declared edges (structured field plus the three prose patterns) and compares them with the actual blocked_by edges for an issue.
- It reuses existing machinery and invents no new primitive:
  - `parseDependencyProse` and `createDependencyLinks` (`issue-dep-migration.ts`)
  - `BlockerResolver` and `TrackerClient`
  - the `intake-file` accept/decline confirmation model
  - the existing event spine
- Three existing callers widen:
  - the intake-label-sync Action script, which parses prose on all issues instead of form submissions only;
  - `compose land`, which proposes edges and refuses while any are undecided;
  - the intake poll, which runs a read-only drift pass.
- One new read-only CLI verb (`engineer dep-audit`) and one new `ConductorEvent` variant.
- External integration is GitHub's issue-dependency REST API. It is already used in production, and no new endpoint is needed (blocked_by already returns each blocker's state_reason).
- No new architectural pattern, auth, or persisted state machine. Operator-facing behavior changes at the `land` gate, so architecture-diagram, a lightweight architecture-review, conflict-check, and coherence-check all apply.
- Estimated story count is around 5 or 6: prose auto-link, negative path, land proposal/refusal, accept/decline write, drift report, and the on-poll sweep event.
