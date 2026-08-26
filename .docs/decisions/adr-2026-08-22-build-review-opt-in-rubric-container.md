# ADR: build_review is an opt-in rubric container
**Date:** 2026-08-22
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1805
**Amends:** adr-2026-08-13-engine-managed-build-review-rubric-branches, adr-2026-08-16-closed-build-review-finding-vocabularies, adr-2026-08-13-stable-build-review-finding-dispositions, adr-2026-08-17-framework-agnostic-tautology-scoped-run, adr-2026-08-18-content-anchored-finding-reference-schema, adr-2026-08-19-engine-stamped-rubric-judged-result-envelope, adr-2026-08-21-review-bound-by-plan-done-when-criteria, adr-2026-08-21-engine-identity-in-build-review-cache-key, adr-2026-08-14-retire-build-review-wiring-rubric, adr-2026-07-21-s-tier-pipeline-knobs

## Context

adr-2026-08-13-engine-managed-build-review-rubric-branches fixed four rubric branches and made an
enabled gate with no enabled rubric a configuration error (`config.ts:1093`). The tautology rubric
fails ~often on refactors and relocations because its revert-preflight classification is the verdict
(adr-2026-08-17 D4). The operator wants the gate to be a container that later rubrics (security,
…) can join, each opt-in, each unable to grow the plan.

## Options Considered

### Option A: Keep four fixed branches, disable three by default
- **Pros:** no schema change.
- **Cons:** dead branches stay dispatchable; the "at least one enabled rubric" rule still fires.

### Option B: Container with registry-driven membership, empty set valid (chosen)
- **Pros:** retiring/adding a rubric is a registry change; empty container is a PASS with no dispatch.
- **Cons:** supersedes the fail-closed "no enabled rubric" rule and the four-branch closure in several ADRs.

## Decision

1. **Membership** is the rubric registry (`build-review-registry.ts`); the only shipped member is
   `test-quality`, **enabled: false by default**. The engine dispatches only enabled members; an
   enabled gate with zero enabled members yields a PASS verdict with a `build_review_no_rubrics`
   reason on the spine and no grader dispatch. This replaces adr-2026-08-13's configuration-error rule.
2. **Retired rubric keys** (`scope`, `completeness`, `rootCause`, `causalIntegrity`, `tautology`,
   `wiring`) stay on the accepted-key list and are ignored with a one-time `config_deprecated_key`
   warning naming the key and this ADR — the adr-2026-08-14 wiring precedent, extended. They are
   removed from the key list in a later, separate change (adr-2026-08-11 two-phase retirement).
   Scaffolded config stops emitting them (adr-2026-07-27-project-config-scaffolder).
3. **test-quality** reshapes tautology: its question is whether tests added for new behavior assert
   that behavior. Its closed input is the changed-test set **intersected with tests bound to a story
   criterion or a `Done when:` check**; binding is the existing `Covers:` marker grammar
   (writing-system-tests §"Covers: FR-N"), extended to accept `S<n>.<m>` story-criterion ids and
   `task:<id>` references. An empty in-scope set (a refactor) passes without judging and without a
   preflight run. The revert preflight runs only when the rubric is enabled and the in-scope set is
   non-empty, and its classification is **evidence in the projection, never a finding**; the judge
   must cite a concrete stub-passable assertion to raise `test-insensitive`. Findings never append
   plan tasks; a FAIL kicks back to BUILD under the existing cumulative bound.
4. **Contracts preserved:** the engine-stamped `judged` envelope, the three-kind content-anchored
   reference schema (test-quality anchors are `content-region` references), stable finding identity
   and dispositions, the mechanical-fault lane, the fresh-base disposition, the cache key (now
   resolving `skills/build-review-test-quality/SKILL.md`), and the `beyond` record kind — retained
   as data for #1810, never produced by this rubric. Vocabularies are now per-registered-rubric;
   the four-rubric enumerations in the amended ADRs are narrowed to the registry, not re-cut by hand.
5. S-tier: build_review runs for S exactly as for L (adr-2026-07-21 D4 holds); with the container
   empty it is a no-dispatch PASS at every tier.

## Consequences

### Positive
- Rubric retirement and addition become registry edits; the gate cannot cycle on an empty set.
- Refactors stop failing tautology.

### Negative
- Default-off means the green-but-stubbed test class is only caught when an operator opts in.
- Config schema is a canonical breaking surface: the PR carries a migration block (or a waiver if
  the edit is internal-only).

### Follow-up Actions
- [ ] Registry-driven dispatch; empty-set PASS with spine reason.
- [ ] Deprecated-key acceptance + warning; scaffolder update.
- [ ] `build-review-test-quality` skill replacing `build-review-tautology`; `Covers:` grammar extension.
