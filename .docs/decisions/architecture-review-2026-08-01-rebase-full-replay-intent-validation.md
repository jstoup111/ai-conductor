# Architecture Review: Full-replay rebase intent validation

**Date:** 2026-08-01
**Mode:** Lightweight (Medium tier)
**Inputs reviewed:** intake `jstoup111/ai-conductor#1152`, technical track marker, existing rebase ADRs, `skills/rebase/SKILL.md`, rebase engine and runner seams
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** No dependency, schema, external service, or new provider capability is required. The existing supported-host skill invocation and `{resolved, reason}` result contract carry the behavior.
- **Prerequisites:** The existing runner already supplies project root, base ref, and conflicted files; Git's paused-rebase state exposes the replay commit and parent context inside the worktree.
- **Integration surface:** Shipped `rebase` skill, its runner prompt/contract tests, rebase-resolution acceptance coverage, and daemon/recovery documentation.
- **Data implications:** No persistent schema changes. HALT text gains more specific evidence through the existing reason propagation path.
- **Performance:** Additional local Git inspection occurs only during an already-paused semantic conflict resolution; no steady-state daemon cost.
- **Worktree isolation:** All reads and edits remain inside the caller-supplied rebase worktree.

## Alignment

- The design preserves `adr-2026-06-29-rebase-conflict-resolution-dispatch`: only the judgment-bearing conflict sub-path dispatches a skill; currentness and commit preservation remain engine-native.
- It amends that ADR's accepted residual risk. A test-passing semantic ambiguity is no longer an acceptable automatic outcome; the skill must HALT when it cannot attribute the full staged replay to source intent and necessary upstream adaptation.
- The operator rejected mechanical file/hunk restrictions because valid semantic resolution can require supporting changes elsewhere. Cross-file edits are therefore allowed but must be explained and validated.
- Provider behavior stays neutral: the shared `rebase` semantic skill contract is strengthened once and rendered through each supported host's existing invocation adapter.

## Wiring Surface

- `skills/rebase/SKILL.md` — the strengthened semantic protocol, invoked by the existing `DefaultStepRunner.resolveRebaseConflict` provider-aware one-shot path and by manual supported-host invocation.
- `src/conductor/src/engine/step-runners.ts#resolveRebaseConflict` — retains the bounded skill dispatch and structured result parser; its delivered prompt/skill contract must remain reachable and tested.
- `src/conductor/src/engine/rebase.ts#resolveRebaseConflicts` and `writeHalt` — consume a specific `resolved: false` reason and surface it through the existing HALT path without introducing a second resolver.
- Third-party-free tests — drive the real internal prompt/result/HALT flow with fake provider and Git boundaries; any real-model exercise is explicitly opt-in smoke only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Model asserts confidence without inspecting the full replay | Data | Medium | High | Explicit evidence checklist, prompt-contract tests, and mandatory ambiguity HALT |
| Conservative rule causes avoidable HALTs | Technical | Medium | Medium | Permit explained cross-file adaptations; require specific missing-decision evidence |
| Provider adapter delivers only the terse runner prompt and weakens the shared skill | Integration | Low | High | Acceptance test the provider-aware semantic skill boundary and final result propagation |
| Tests accidentally call a real model | Technical | Low | High | Fake every provider boundary; reserve real providers for named opt-in smoke tests |

## ADRs Created

- `adr-2026-08-01-rebase-full-replay-intent-validation` — APPROVED; amends the prior residual-risk decision.

## Conditions

1. Do not add a mechanical resolver, file allowlist, hunk-only write restriction, or whole-patch equality gate.
2. The skill must validate the complete staged replay before continue and inspect the resulting replay commit afterward.
3. `resolved: false` evidence must name the replay commit, affected file/region, competing intentions, and the missing decision whenever those facts are available.
4. Automated tests must use fake provider/Git boundaries; no default or CI test may call a real third party.
