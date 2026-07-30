# ADR: Deterministic BUILD verification fan-out before model review

**Date:** 2026-07-29
**Status:** APPROVED (operator-approved 2026-07-29)
**Deciders:** James Stoup (operator), Codex engineer session
**Depends on:** `adr-2026-07-10-concurrent-group-core`
**Supersedes in part:** `adr-2026-07-12-wiring-check-gate` ordering; `adr-2026-07-25-content-addressed-full-suite-proof` ordering and direct-skill invocation
**Supersedes:** `adr-2026-07-25-direct-claude-configured-verifier-interface`

## Context

`wiring_check` and `test_suite` are already engine-computed gates, but the lifecycle and installed catalog still present `test-suite` as a skill. The current BUILD tail also dispatches the model-judged `build_review` before either deterministic gate can reject the build. A suite or wiring failure therefore spends review tokens that cannot affect the deterministic verdict.

The operator prioritizes avoiding model spend on mechanically invalid builds while recovering successful-path latency where safe. SHIP validators must remain downstream of every BUILD gate.

## Options Considered

### Option A: Sequential deterministic gates before review

- **Pros:** simplest state and failure semantics; no review tokens on a deterministic failure.
- **Cons:** successful-path duration is the sum of wiring, suite, and review durations.

### Option B: Concurrent deterministic gates, then review

- **Pros:** no review tokens on deterministic failures; successful-path deterministic latency becomes the slower branch rather than their sum; both failures can be reported from one round.
- **Cons:** requires a fail-closed join, interruption handling, and consolidated deterministic kickback.

### Option C: Run model review concurrently too

- **Pros:** lowest successful-path wall time.
- **Cons:** burns review tokens whenever wiring or the aggregate suite fails, contrary to the operator's cost priority.

## Decision

Choose **Option B**.

1. After `build`, the engine starts `wiring_check` and `test_suite` as one built-in deterministic BUILD group. Both run through engine-owned functions; neither renders or invokes a skill.
2. Reuse the APPROVED concurrent group core and `validation_concurrency` cap. Do not add a second `Promise.all` executor. With a cap of one, declared member order is `wiring_check` then `test_suite`.
3. Branches may write only their own evidence. The group join is the sole writer of conductor state, gate state, and joined events.
4. Wait for both branches to settle. Preserve each branch's existing deterministic failure classification and per-gate kickback budget; when both fail, issue one BUILD rewind carrying both evidence sources and charge each failing gate once.
5. The configured aggregate suite is execution-only with respect to verification inputs. It may write ignored ephemeral outputs such as coverage data, but it does not modify fingerprinted project inputs or files consumed by the wiring probe; both branches therefore observe the same completed build.
6. Dispatch `build_review` only after the joined deterministic result is green. A joined deterministic failure spends no build-review tokens. SHIP validation remains downstream of `build_review`.
7. Remove `skills/test-suite/SKILL.md` and every direct host-skill reference. Retain `conduct-ts test-suite` as the provider-neutral standalone deterministic adapter; interactive `conduct` guidance invokes that adapter directly when standalone aggregate verification is required.
8. Keep the aggregate verifier's content-addressed evidence, lock, timeout, redaction, process-tree cleanup, failure taxonomy, and finish/BUILD-fallback reuse unchanged.
9. Treat installed `test-suite` skill links as a real consumer migration. The release migration removes the obsolete Claude and Codex catalog links without touching unrelated skills.
10. Engine-native execution must remain provider-agnostic. Any exhaustive provider-policy metadata retained for step configuration is bookkeeping only and must never cause an LLM dispatch for `wiring_check` or `test_suite`.

## Verify-Claims Ledger

### Claims

- **Verified (99%):** `wiring_check` and `test_suite` are classified as entirely engine-computed and receive one deterministic attempt in `conductor.ts`.
- **Verified (99%):** `STEP_SKILL_INVOCATIONS.test_suite` is `engine-native`, and rendering it as a skill invocation throws.
- **Verified (98%):** `FullSuiteVerifier` owns inspection, execution, proof persistence, locking, and fail-closed result classification.
- **Verified (98%):** the approved concurrent-group core already supplies capped fan-out, branch outcomes, rate-limit integration for agent branches, and single-writer state joining.
- **Verified (99%):** `conduct-ts test-suite` already exposes the verifier without a skill dispatch.
- **Verified (99%):** the wiring and suite artifacts are distinct and are written through separate engine-owned evidence paths.

### Assumptions

- **Confirmed (100%, operator decision):** ignored ephemeral outputs such as coverage data are allowed, but a valid aggregate verifier does not modify fingerprinted project inputs or wiring-probe inputs.

**Verdict:** CLEAR.

## Consequences

### Positive

- Mechanical failures consume no `build_review` tokens.
- Wiring and aggregate verification overlap without allowing speculative SHIP work.
- The shipped catalog describes judgment workflows rather than wrapping an already-native gate.
- Dual deterministic failures can be remediated from one BUILD rewind.

### Negative

- The concurrent-group core needs a native-function branch adapter in addition to its existing dispatched-step branches.
- A heavy suite may contend briefly with wiring analysis for CPU or filesystem bandwidth.
- Removing an installed skill surface requires an explicit migration.

### Follow-up Actions

- [ ] Add deterministic group membership and joined-result handling.
- [ ] Reorder `build_review` after the deterministic group and preserve kickback accounting.
- [ ] Remove the shipped test-suite skill and direct invocation guidance.
- [ ] Add the skill-link removal migration and update canonical docs.
- [ ] Cover concurrent pass/fail, dual failure, cap-one, interruption, stale-at-join, and no-review-on-failure paths.
