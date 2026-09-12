# PRD: Support multiple test suites in BUILD

**Date:** 2026-09-11
**Status:** Approved
**Approved by:** James Stoup, 2026-09-11, explicit approval in composer chat.
**Source:** jstoup111/ai-conductor#2358

## Problem / Background

A project may verify different parts of its software with different test runners in different directories. Today aggregate BUILD verification describes one operation with one working directory and timeout. Combining several suites inside that operation obscures which suite failed and prevents the harness from reporting each suite's result separately.

Project maintainers need one authoritative BUILD verification result that covers their ordered collection of suites, while retaining enough detail to identify and repair a specific failure. The capability must work for any project-owned runner, not just this repository's stack.

## Goals & Non-Goals

**Goals**

- Allow one project to verify multiple suites in its declared order.
- Make a failed suite identifiable in both operator feedback and automated repair context.
- Reuse verification only when it still covers the complete declared verification operation under the existing freshness policy.
- Preserve existing single-suite projects without mandatory configuration edits.

**Non-Goals**

- Selecting, installing, or discovering a test runner for the project.
- Parallel suite scheduling, a dependency graph of suites, or independently cached partial passes.
- Migrating this repository's integrity suite into BUILD; that adoption is a separate feature.
- Changing the existing scoped-test invocation or counterfactual review behavior.

## Users / Personas

- Project maintainers configure complete verification for projects with multiple languages, packages, or test categories.
- Operators need to see which suite blocked BUILD and whether subsequent suites ran.
- Repair agents need the failing suite's actual execution context and diagnostics rather than an opaque combined failure.

## Functional Requirements

- **FR-1:** A maintainer can declare a non-empty ordered collection of aggregate verification operations for one project.
- **FR-2:** Each operation can run in its own project-contained working directory.
- **FR-3:** Each operation can have its own positive execution timeout.
- **FR-4:** Verification runs the declared operations serially in order and stops at the first unsuccessful operation; later operations do not execute.
- **FR-5:** Aggregate success requires every declared operation to finish successfully; an omitted, interrupted, or unexecuted operation cannot count as passing.
- **FR-6:** Operations work independently of test framework, implementation language, or diagnostic-output format. A successfully completed operation with zero exit status succeeds even with empty or unfamiliar output; nonzero exit status fails even if its output claims success.
- **FR-7:** Verification evidence identifies each attempted operation, its execution directory, duration, and result, including exit status when available and the reason when no ordinary exit status exists.
- **FR-8:** When verification fails, operator feedback and automated repair context identify the failed operation and provide its bounded diagnostic output. They distinguish subsequent unexecuted operations from completed ones.
- **FR-9:** Existing single-operation configurations retain their execution semantics without operator edits.
- **FR-10:** Adding, removing, reordering, or changing a declared operation invalidates an earlier aggregate pass; verification inputs relevant to any operation participate in freshness checks.
- **FR-11:** An unchanged, current pass remains reusable under the existing verification policy; inspecting or reporting it does not re-execute the operations.
- **FR-12:** Invalid declarations are rejected before execution with the offending operation and setting identified. Rejections include an empty collection, missing or empty operation, invalid timeout, ambiguous aggregate declarations, and working directories outside the project root, including escapes through symbolic links.
- **FR-13:** Existing verification entry points apply the same multi-operation result and freshness rules, so a partial pass cannot satisfy one entry point while failing another.

## Documentation Upkeep

- Maintainer documentation explains ordered verification, per-operation settings, compatibility, failure reporting, and invalid declarations using examples that do not imply dependence on one test framework.

This is ordinary documentation upkeep accompanying the functional change, fulfilled alongside implementation rather than as a separate story, acceptance criterion, or documentation-only task. FR-1 through FR-13 form the functional story inventory.

## Non-Functional Requirements

- **Reliability:** Preserve existing process cleanup, execution locking, atomic evidence persistence, and fail-closed treatment of unavailable or incomplete proof.
- **Security:** Preserve diagnostic redaction and bounded output. Verification must not expand the allowed project-directory boundary.
- **Portability:** The feature is independent of the selected coding-agent provider and imposes no new test-runner installation or output-format requirement.
- **Observability:** Existing verification reporting must expose attributable operation outcomes through the established telemetry system.
- **Compatibility:** Existing scoped verification and its aggregate fallback retain their routing rules; when aggregate verification is selected, it covers the entire declared collection.

## Acceptance Criteria / Success Metrics

- A project with multiple operations in different directories verifies them in order with independent timeouts and obtains one complete aggregate pass.
- A failure or timeout in the middle stops execution; evidence, operator feedback, and repair context identify that operation and do not represent later operations as passed.
- Empty or unfamiliar successful output passes; misleading success text with a nonzero exit status fails.
- Any declared-operation change invalidates the prior aggregate proof, while unchanged valid proof is reused without launching operations.
- Existing single-operation configuration and scoped-test behavior continue to work.
- Invalid declarations fail before launching any operation and identify the actionable error.

## Scope

### In Scope

All desired outcomes of #2358: suite-agnostic ordered execution, per-operation directory and timeout, attributable evidence and diagnostics, freshness across the full collection, compatibility, validation, and documentation.

### Out of Scope

The #658 integrity-suite adoption, suite-specific adapters or output parsers, runner discovery, parallel scheduling, partial-suite cache/retry optimization, and changes to scoped invocation or counterfactual review.

## Key Decisions & Rationale

- **Complete requested breadth:** The operator explicitly requested all of #2358 and suite-agnostic behavior on 2026-09-11.
- **Stop at the first failure:** This follows the requested ordered verification behavior and prevents subsequent execution from obscuring the first blocker.
- **Keep old configurations usable:** Existing projects should not need edits to retain their current single-suite behavior.
- **Whole-operation proof:** Successful earlier suites do not independently satisfy the aggregate gate after another suite fails.

## Dependencies

- The existing project-owned aggregate verifier, freshness policy, scoped invocation, and verification-reporting surfaces are the integration context.
- #658 consumes this capability after it ships; it is not a prerequisite for this feature.
- No additional external service or runner-specific integration is required.

## Resolved Architecture Questions

- Entries use their declaration index and inherit shared directory/timeout settings, then existing defaults. Explicit directories resolve from the project root; scoped invocation retains its shared context.
- Scalar/scoped evidence retains v4 compatibility; aggregate list execution uses complete v5 proof. Diagnostics remain redacted and bounded, with the failed entry prioritized.
- The existing verifier, CLI, BUILD repair, and event consumers carry the ordered result. Inspection-only callers retain the same verifier authority.

The operator-approved architecture review defines these contracts in detail; no design question remains open.

## Verification Basis

- **Verified:** The current configuration type and aggregate executor each describe one aggregate operation (`TestSuiteConfig` and `executeFullSuite`, inspected 2026-09-11).
- **Verified:** Current configuration validation checks non-empty operations, positive timeouts, and project-contained working directories, including existing symbolic-link escapes.
- **Verified:** Existing evidence records aggregate execution context and versioned PASS/FAIL proof; current execution classifies exit failures, timeout, signal, and launch failure independently of a test-output grammar.
- **Confirmed input:** Operator approved the full suite-agnostic scope and selected approach A on 2026-09-11.
- **Assumptions:** No unconfirmed existing-behavior assumption drives these requirements. The scope and architecture decisions above are operator-approved.
- **Verify-claims verdict:** CLEAR. Product requirements approved by the operator on 2026-09-11.
