# Track: Support multiple test suites in BUILD

Track: product

Source: jstoup111/ai-conductor#2358

Scope boundary: Cover all desired outcomes of #2358 with suite-agnostic behavior: ordered aggregate verification entries with independent working directories and timeouts, first-failure stopping, attributable evidence and remediation, complete proof invalidation, backward compatibility, configuration validation, and documentation. Existing scoped invocation and the build-review counterfactual preflight retain their contracts. Adoption by this repository's integrity suite belongs to #658 and is not part of this feature.

Approach: Extend the existing test-suite configuration with an inline ordered command list, preserving the single-command form. Commands are project-owned; execution and result handling do not depend on a test framework or output grammar.

Rationale: This is a new consumer-facing verification capability with user-visible configuration, compatibility, and failure-reporting requirements.

Operator decisions, 2026-09-11: confirmed issue and repository; requested "cover all - needs to be suite agnostic"; selected approach A in response to the recommended A/product-track proposal.

Scope check: A — consumer-facing, because installed consumer projects use the same aggregate verifier. B — n/a, no new skill. C — provider-agnostic, engine-owned command execution for every supported host. Registration — configuration consumer keys and canonical consumer documentation in implementation; no skill registration.

Alternatives: A separate named-suite registry was considered but adds a reusable-definition surface that this request does not need. Inline entries deliver the complete requested behavior within the existing verifier.

Verified context: `TestSuiteConfig` in `src/conductor/src/types/config.ts` declares one aggregate command; `executeFullSuite` in `src/conductor/src/engine/full-suite-executor.ts` executes one command with one directory and timeout. The #658 plan explicitly depends on #2358 for ordered-command support.
