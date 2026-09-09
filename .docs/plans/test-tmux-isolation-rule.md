# Plan: Test process isolation rule

Operator-authorized direct repository documentation change, 2026-09-09.

## Scope

Record the required safety boundary for guard tests and real-tmux fixtures. Runtime private-socket implementation and automated enforcement are separately tracked in #2476.

### Task 1: Document the isolation contract

**Files:** AGENT_INSTRUCTIONS.md

**Done when:** Repository guidance requires guard tests to remain harmless against pre-change production, verified process mocks before destructive arguments, and private sockets for new or changed real-tmux fixtures. Repository integrity validation passes.
