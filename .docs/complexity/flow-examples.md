# Complexity: Runnable example scripts for every conduct-ts flow

Tier: M

## Rationale

Medium, not Small — the deliverable is bash-and-fixtures with no new TypeScript engine
code, no schema, and no state machine, but it carries three genuine cross-cutting design
decisions that warrant architecture + conflict review:

- **Cross-flow state isolation.** Five flows each touch a *different* state surface —
  the project registry (`~/.ai-conductor/registry.json`), the engineer/intake store
  (`~/.ai-conductor/engineer/`), the repo-relative `.daemon/` lock, `.worktrees/`,
  `.pipeline/`, plus git remotes and the GitHub API. An example must isolate all of
  them so a demo run never mutates the operator's real state or opens a real PR.
- **Headless vs interactive dichotomy.** `inline --auto`, `daemon` (drain), `intake-loop
  --once`, and the engineer *primitives* run headless to a checkpoint; `inline
  --interactive` and the full `engineer` loop require a live Claude REPL and cannot
  self-assert. The two need structurally different example shapes.
- **Fixture seeding.** The daemon and engineer primitive flows consume pre-authored
  artifacts (a spec with stories+plan / a `.docs/` set to land). Demonstrating them
  headless means seeding deterministic fixtures rather than invoking an LLM.

Signals: no new models, no auth, no integrations, one small state-isolation library +
five scripts + tiered prompt fixtures. Story count moderate (per-flow happy + negative).
Not Large (no multi-day engine surface); clearly past Small (design decisions above need
ADRs). **Tier M.**

The eval / regression-runner layer (single runner over flow×tier producing per-combination
pass/fail) is out of scope here — split to intake #807.
