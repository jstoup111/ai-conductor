# Coherence Check: Codex Readiness Probe Failure Separation (#1039)

**Date:** 2026-07-30
**Tier:** M
**Track:** Product
**Source-Ref:** `jstoup111/ai-conductor#1039`
**Status:** Approved
**Approval:** James Stoup approved this coherence mapping on 2026-07-30.

Every verdict below was checked against the recovered issue outcomes, approved PRD amendment, accepted stories, and approved 20-task plan. No row depends on an inferred or nonexistent citation.

## Traceability Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-3, story-5 | covered | Structured secret-safe diagnostics, probe-specific recovery termination, and rendered progress distinguish probe failure from credential failure without rerunning the incident. |
| outcome | outcome-2 | story-1, story-3, story-5 | covered | The readiness result distinguishes affirmative verdicts from probe failure, and normal/recovery callers consume that distinction. |
| outcome | outcome-3 | story-3 | covered | Recovery authorizes one real trial after probe failure and a failed trial terminates probe-specifically without waiting through another credential park. |
| outcome | outcome-4 | story-4 | covered | The per-project finite-positive timeout replaces the private fixed readiness timeout and is verified at the doctor boundary. |
| outcome | outcome-5 | story-2, story-5 | covered | Closed evidence is persisted and rendered while raw output, exception text, paths, hashes, and credential material remain forbidden. |
| outcome | outcome-6 | story-1, story-2 | covered | Explicit execution, timeout, parser/evidence, and affirmative-unhealthy cases prove the outcomes are not collapsed. |
| fr | fr-1 | story-1 | covered | Story 1 requires distinct affirmative credential and unavailable-probe outcomes. |
| fr | fr-2 | story-1 | covered | Story 1 enumerates every execution and evidence failure class as `probe-failed`. |
| fr | fr-3 | story-1 | covered | Story 1 requires ordinary unattended dispatch after probe failure. |
| fr | fr-4 | story-1 | covered | Story 1 preserves blocking `missing` and `unusable` verdicts. |
| fr | fr-5 | story-1 | covered | Story 1 preserves actual invocation authentication-failure precedence. |
| fr | fr-6 | story-2 | covered | Story 2 retains distinct execution, timeout, and parser/schema diagnostics. |
| fr | fr-7 | story-2 | covered | Story 2 constrains retained evidence to closed, bounded, non-secret facts. |
| fr | fr-8 | story-3 | covered | Story 3 authorizes exactly one real trial after a degraded recovery probe. |
| fr | fr-9 | story-3 | covered | Story 3 makes successful and non-auth trial results authoritative. |
| fr | fr-10 | story-3 | covered | Story 3 terminates an auth-failed trial probe-specifically with no recursive bypass. |
| fr | fr-11 | story-3 | covered | Story 3 preserves bounded parking for affirmative `missing` and `unusable`. |
| fr | fr-12 | story-4 | covered | Story 4 defines default, custom, and invalid per-project timeout behavior. |
| fr | fr-13 | story-5 | covered | Story 5 preserves provider/source, fallback, budget, and actual-result precedence. |
| fr | fr-14 | story-5 | covered | Story 5 applies the behavior across all unattended execution and recovery contexts. |
| fr | fr-15 | story-5 | covered | Story 5 requires closed probe-failure progress to be emitted, persisted, and rendered. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5, task-6, task-18 | covered | Tasks define the union, preserve affirmative verdicts, classify all probe failures, authorize normal dispatch, and update stale provider acceptance behavior. |
| story | story-2 | task-1, task-4, task-5, task-8, task-9, task-18 | covered | Tasks define closed metadata and prove execution/parser diagnostics remain useful, bounded, secret-safe, and optional-sink tolerant. |
| story | story-3 | task-12, task-13, task-14, task-15, task-16, task-19 | covered | Tasks implement explicit recovery dispositions and the one-trial/no-recursion rule in serial, group, auxiliary, and acceptance flows. |
| story | story-4 | task-10, task-11 | covered | Tasks validate the key and prove default/custom isolation at both production composition roots. |
| story | story-5 | task-6, task-7, task-13, task-14, task-15, task-16, task-17, task-18, task-19, task-20 | covered | Tasks cover normal/streaming dispatch, every recovery caller, actual-result precedence, event consumers, and the full propagation matrix. |
| task | task-1 | story-1, story-2 | covered | Defines the exhaustive readiness and closed diagnostic contract required by both stories. |
| task | task-2 | story-1 | covered | Preserves affirmative ready evidence and unrelated-health separation. |
| task | task-3 | story-1 | covered | Preserves conclusive missing/unusable blocking behavior. |
| task | task-4 | story-1, story-2 | covered | Classifies execution error and timeout with bounded facts. |
| task | task-5 | story-1, story-2 | covered | Classifies parser, schema, envelope, conflict, and ambiguity failures. |
| task | task-6 | story-1, story-5 | covered | Authorizes ordinary invocation without synthetic auth/fallback/budget effects. |
| task | task-7 | story-5 | covered | Applies degraded dispatch to unattended streaming/resume and preserves real-result precedence. |
| task | task-8 | story-2 | covered | Proves execution diagnostics exclude adversarial secret-bearing content. |
| task | task-9 | story-2 | covered | Bounds parser diagnostics and preserves sinkless dispatch. |
| task | task-10 | story-4 | covered | Adds default/custom validation and rejects every invalid timeout class. |
| task | task-11 | story-4 | covered | Injects only the readiness timeout through CLI and daemon roots to the doctor runner. |
| task | task-12 | story-3 | covered | Replaces the ambiguous park result with exhaustive recovery dispositions. |
| task | task-13 | story-3, story-5 | covered | Returns one `trial-required` disposition and emits closed progress facts. |
| task | task-14 | story-3, story-5 | covered | Enforces one trial and no recursion in serial dispatch while preserving actual results. |
| task | task-15 | story-3, story-5 | covered | Enforces the same bound in groups while preserving completed sibling work. |
| task | task-16 | story-3, story-5 | covered | Enforces the same bound in judged and auxiliary verification paths. |
| task | task-17 | story-5 | covered | Wires closed progress through event policy, persistence, CLI/daemon subscriptions, and renderers without audit widening. |
| task | task-18 | story-1, story-2, story-5 | covered | Replaces stale fail-closed acceptance expectations across provider/runtime handling. |
| task | task-19 | story-3, story-5 | covered | Proves bounded recovery and progress as deterministic serial/group/auxiliary acceptance flows. |
| task | task-20 | story-5 | covered | Proves exhaustive call-shape propagation and actual-failure precedence. |

## Verdict

**CLEAR:** 46 required rows are covered: six intake outcomes, 15 functional requirements, five stories, and 20 plan tasks. There are zero `gap` verdicts, zero phantom ids, and zero load-bearing assumptions awaiting confirmation.
