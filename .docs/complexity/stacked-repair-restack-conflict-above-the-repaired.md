# Complexity: Accept an operator-recorded resolution for a stacked restack conflict above the repaired child

Tier: M

## Rationale

- Bounded engine change inside the existing restack machinery: the executor's and journal
  recovery's conflict branch gains one new input (a pinned operator resolution consumed as the
  resolver's output). The planner's range rules, the journal state machine, and the transition
  are unchanged.
- One new operator CLI subcommand (`stack restack-resolve`) that reuses shipped validators:
  ancestry, the FR-9 subject-preservation check, and path ownership. It joins #3203's operator
  command family (dispatch lease, HALT cleared only by its resolving command).
- One new durable ref namespace (`refs/conductor/<slug>/restack/resolution/c<k>`), which is
  covered by existing teardown and recovery rules.
- Two adjacent defect fixes in `routing/routed-exit.ts`: resolver wiring, and keeping the halt
  reason.
- Amends an approved ADR (`adr-2026-10-10-stacked-restack-journaled-replay`, conflict hand-off),
  so the tier needs an architecture diagram and a lightweight architecture review. It also
  interacts with in-flight #3203 and #3365, so a conflict check is needed.
- Not Large: no new step, no new lifecycle phase, no state machine, no external integration.
  The estimate is about 8–10 plan tasks.
