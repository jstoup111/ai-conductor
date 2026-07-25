# Coherence: Full-suite verification gate (#940)

**Date:** 2026-07-25
**Tier:** M
**Track:** Product
**Plan:** `.docs/plans/2026-07-25-full-suite-verification-gate-940.md`

This feature originated in chat and has no staged or committed intake artifact,
so the `outcome` row class is not required. Verdicts below were checked against
the approved PRD, accepted stories, and approved plan rather than inferred from
identifier shape.

## Functional requirements

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-1 | covered | Story 1 requires the automated pre-SHIP aggregate gate. |
| fr | fr-2 | story-2 | covered | Story 2 requires the equivalent direct-Claude gate. |
| fr | fr-3 | story-4 | covered | Story 4 requires current passing evidence to satisfy later callers. |
| fr | fr-4 | story-4 | covered | Story 4 requires one execution across unchanged gate, finish, fallback, and PR preparation. |
| fr | fr-5 | story-6 | covered | Story 6 requires scoped intermediate verification. |
| fr | fr-6 | story-4 | covered | Story 4 covers reuse of an earlier supported broad fallback. |
| fr | fr-7 | story-1 | covered | Story 1 routes automated suite failure to BUILD before SHIP. |
| fr | fr-8 | story-2 | covered | Story 2 blocks direct SHIP and routes failure to implementation. |
| fr | fr-9 | story-3 | covered | Story 3 declares one project-owned aggregate operation. |
| fr | fr-10 | story-3 | covered | Story 3 enumerates all fail-closed configuration and execution outcomes. |
| fr | fr-11 | story-5 | covered | Story 5 enumerates test-relevant invalidation inputs. |
| fr | fr-12 | story-5 | covered | Story 5 preserves proof for documentation-only changes. |
| fr | fr-13 | story-7 | covered | Story 7 defines finish reuse and standalone fallback. |
| fr | fr-14 | story-8 | covered | Story 8 removes local aggregate execution from PR preparation. |
| fr | fr-15 | story-8 | covered | Story 8 preserves independent CI execution. |
| fr | fr-16 | story-5 | covered | Story 5 requires executed, reused, stale, and failed status with reasons. |
| fr | fr-17 | story-9 | covered | Story 9 preserves autoresolve and CI-repair post-mutation suites. |

## Stories

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-15, task-16, task-17, task-25 | covered | Tasks register, execute, remediate, and prove the automated gate. |
| story | story-2 | task-13, task-14, task-21, task-25 | covered | Tasks expose the shared CLI, enforce failure, add direct guidance, and prove parity. |
| story | story-3 | task-1, task-2, task-6, task-7, task-8, task-9, task-10, task-14, task-17, task-24, task-25 | covered | Tasks cover declaration, execution, failure classes, migration, and integration. |
| story | story-4 | task-3, task-5, task-6, task-10, task-11, task-12, task-13, task-18, task-25 | covered | Tasks cover content identity, evidence, reuse, staleness, rebase, and caller integration. |
| story | story-5 | task-3, task-4, task-5, task-6, task-12, task-18, task-20, task-25 | covered | Tasks cover all invalidation inputs, safe evidence, rebase, and visible status. |
| story | story-6 | task-13, task-22, task-25 | covered | Tasks provide the supported broad fallback and scope ordinary verification. |
| story | story-7 | task-19, task-25 | covered | Tasks implement and prove finish reuse/fallback. |
| story | story-8 | task-23, task-25 | covered | Tasks enforce and prove the PR/CI boundary. |
| story | story-9 | task-23, task-25 | covered | Tasks preserve and prove both repair-suite invariants. |

## Plan tasks

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| task | task-1 | story-3 | covered | Adds the aggregate-suite configuration contract. |
| task | task-2 | story-3 | covered | Adds malformed-declaration negative paths. |
| task | task-3 | story-4, story-5 | covered | Builds the working-tree content identity. |
| task | task-4 | story-5 | covered | Adds config, extra-input, and environment invalidation. |
| task | task-5 | story-4, story-5 | covered | Persists reusable and observable evidence. |
| task | task-6 | story-3, story-4, story-5 | covered | Rejects corrupt evidence and bounds secret-safe diagnostics. |
| task | task-7 | story-3 | covered | Executes the declared aggregate command. |
| task | task-8 | story-3 | covered | Classifies launch and non-zero failures. |
| task | task-9 | story-3 | covered | Enforces timeout cleanup. |
| task | task-10 | story-3, story-4 | covered | Composes execution and evidence into a current proof. |
| task | task-11 | story-4 | covered | Reuses content-identical proof across callers and SHA churn. |
| task | task-12 | story-4, story-5 | covered | Replaces stale proof and blocks indeterminate freshness. |
| task | task-13 | story-2, story-4, story-6 | covered | Exposes the shared TypeScript verifier entrypoint. |
| task | task-14 | story-2, story-3 | covered | Makes verification and invocation failures block. |
| task | task-15 | story-1 | covered | Registers the non-disableable native gate topology. |
| task | task-16 | story-1 | covered | Runs and resume-verifies the gate before SHIP. |
| task | task-17 | story-1, story-3 | covered | Routes blocking results back to BUILD with a cap. |
| task | task-18 | story-4, story-5 | covered | Rechecks after rebase using content rather than SHA alone. |
| task | task-19 | story-7 | covered | Makes finish reuse current proof and supply fallback. |
| task | task-20 | story-5 | covered | Emits all required verification states and safe reasons. |
| task | task-21 | story-2 | covered | Adds the direct-Claude `/test-suite` step. |
| task | task-22 | story-6 | covered | Scopes ordinary build and review verification. |
| task | task-23 | story-8, story-9 | covered | Removes PR reruns while preserving CI and repair checks. |
| task | task-24 | story-3 | covered | Documents and configures fail-closed project migration. |
| task | task-25 | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-8, story-9 | covered | Proves the complete cross-surface behavior and once-only metric. |

## Verdict

All required rows are covered. No coherence waiver is needed.
