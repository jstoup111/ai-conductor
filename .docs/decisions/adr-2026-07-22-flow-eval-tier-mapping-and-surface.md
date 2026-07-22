# ADR: S/M/L map to ComplexityTier; eval surface is a non-blocking on-demand runner

**Date:** 2026-07-22
**Status:** APPROVED
**Deciders:** engineer (operator delegate), #786

## Context

#786 asks for example prompts at "small, medium, large" and a standing eval. Two sub-decisions:

1. **What does S/M/L mean?** Either (a) the harness's existing `ComplexityTier = 'S'|'M'|'L'`
   (`src/conductor/src/types/steps.ts`), which drives real tier-dependent step-skipping in
   `selector.ts`; or (b) literal prompt text length (short/medium/long).
2. **Where does the eval live and how does it run?** It uses real `git`/worktree operations in
   throwaway repos, so it is meaningfully slower than the unit suite, and must never touch the real
   registry/daemon.

## Options Considered

### S/M/L meaning
- **(a) Map to `ComplexityTier`** — a "Large" scenario is a fixture feature the flow classifies as
  `L` and runs the full step set; "Small" skips conflict-check/architecture/etc. Exercises the real
  branching in `selector.ts`/`steps.ts`.
  - **Pros:** meaningful (covers tier step-skipping — a real regression surface); harness-native;
    matches the issue's own hypothesis.
  - **Cons:** the scripted provider must classify the fixture at the intended tier (pin
    `state.complexity_tier` in the sandbox to make it deterministic).
- **(b) Literal prompt length** — three prompt strings of different sizes.
  - **Pros:** trivially simple.
  - **Cons:** exercises nothing tier-dependent; prompt length is not a flow behavior. Low value.

### Eval surface / CI posture
- **(a) A separate `evals/` tree + `conduct-ts eval` + `npm run eval`, run on-demand/nightly, NOT in
  the default per-PR `vitest run`.**
- **(b) Fold into the normal vitest gate so every PR runs it.**

## Decision

1. **S/M/L map to `ComplexityTier`.** Each scenario pins the sandbox's `state.complexity_tier`
   (deterministically, not via a live classification turn) so the eval covers real tier-dependent
   step-skipping. Reuse the existing `ComplexityTier` union — do not invent a parallel size axis.
2. **Ship a dedicated eval surface, non-blocking.** The framework, drivers, fixtures, and runner
   live under a top-level `evals/` tree (thin driver over the `conduct-ts` CLIs / engine entry
   points). Expose it via a `conduct-ts eval` subcommand and an `npm run eval` script in
   `src/conductor/package.json`. It runs on-demand and (optionally) nightly — it is **not** added to
   the default per-PR `vitest run`, because real-git scenarios are slower and PR latency matters. A
   fast subset MAY be surfaced as vitest specs, but the full matrix is the on-demand runner.

Rationale: (a) makes the eval test something real; (b) keeps the PR gate fast while still giving a
single command that reports per-flow×tier pass/fail — the #786 acceptance shape.

## Consequences

### Positive
- Eval covers tier step-skipping (`selector.ts`) — a genuine regression surface — for free.
- One command (`conduct-ts eval` / `npm run eval`) executes flow×tier and reports per-combination
  pass/fail with a captured reason, satisfying #786's observable-acceptance clause.
- PR latency is unaffected; the suite runs where slowness is acceptable (on-demand/nightly).

### Negative
- Regressions caught by the eval land between nightly runs unless a developer runs it locally — the
  cost of keeping it off the PR gate. Mitigated by making it a single documented command.
- Pinning tier deterministically means the eval does not test the live tier-classification turn
  itself (a separate, lower-risk concern).

### Follow-up Actions
- [ ] Add the `evals/` tree, `conduct-ts eval` subcommand (`detectEvalCommand` in `index.ts` +
      `cli.ts`), and `npm run eval` script.
- [ ] Commit S/M/L example prompts per flow keyed to `ComplexityTier`.
- [ ] Document (README.md + src/conductor/README.md) that the eval is on-demand/nightly, not a PR gate.
