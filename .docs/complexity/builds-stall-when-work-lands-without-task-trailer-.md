# Complexity: builds stall when work lands without Task: trailer stamps

Tier: M

## Rationale

Signals weighed (same set conduct uses):

- **Models / schemas:** none added. Existing signals only (head SHA movement, dispatch-count
  sentinel, resolved-task count, retry budget).
- **Integrations:** none — internal to the engine (`conductor.ts` breaker site,
  `task-progress.ts`, contract text in `skills/pipeline/SKILL.md` / `docs/daemon-operations.md`).
- **Auth:** not touched.
- **State machines:** one, and it is why this is not Small — the build step's
  retry/stall/HALT/handoff state machine gains a liveness-floor branch and an
  exhausted-budget-with-real-work → build_review routing outcome. Editing a live circuit
  breaker whose false negatives currently terminal-HALT daily builds carries real blast
  radius; the genuinely-wedged HALT path must be provably preserved (negative path).
- **Story count:** ~5 expected (liveness floor; budget-exhaustion routing; genuine-wedge
  preservation; telemetry demotion + contract-text sync; regression fixture from the live
  halted-worktree shape).
- **Prior-art coupling:** must compose with #859 (trailer-union routing), #773 (build_review
  sole authority), #280 (progress-bypass/attempt ceiling), #569 (stall → /remediate routing),
  #505 (zero-work detection) — conflict-check against that story cluster is required.

Not Large: no new subsystem, no schema/CLI change, signals already computed at the call
site. Not Small: live-gate semantics change + multi-feature story-cluster interaction.
