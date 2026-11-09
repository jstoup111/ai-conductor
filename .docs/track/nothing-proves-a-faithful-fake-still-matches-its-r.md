# Track: Paired fake-and-real contracts for external boundaries

Track: technical

Scope boundary: All eight external boundaries in `test/structural/boundary-registry.ts` (`llm`, `git`, `gh`, `tmux`, `process`, `clock`, `otel`, `filesystem`) are covered. This spec delivers the reusable paired-contract harness, which runs each contract once against the boundary's fake in the default suite and once against its real adapter in an opt-in smoke leg. It also adds a registry obligation that a `ported` boundary must carry a contract with both legs, and it ships the `llm` contract. The other seven boundaries receive their contracts through their port migrations (#3043, #3633–#3639), because the obligation fires when each boundary becomes `ported`. This spec ports no boundary and adds no real external call to the default suite or CI.

This is internal test infrastructure plus a structural check, with no user-facing behavior to specify in a PRD. It is not a maintenance change, because it adds a new test target and a new mechanical rule. Source: intake jstoup111/ai-conductor#1990.
