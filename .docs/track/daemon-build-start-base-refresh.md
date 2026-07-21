# Track: daemon-build-start-base-refresh

Track: technical

## Rationale

This change generalises THIS repo's conductor into a **config-driven custom-step framework**:
a project may declare extra pipeline steps in its own `.ai-conductor/config.yml` (`steps:`
map, each with an `after:` insertion point and a body that is a `skill:`, an engine-native
`action:`, or a `hooks.before` script), and the engine splices them into the step sequence
for THAT repo only — nothing global, nothing baked into the harness for downstream consumers.
The build-start base-refresh is then wired as ONE such custom step in this repo's config
(`action: base-refresh`, `after: plan`), running `git fetch origin` + rebase onto
`origin/<default>` before any build task.

There is no user-facing product surface: the framework is an internal engine capability and
the base-refresh is a per-project build-flow correctness step. Acceptance criteria (insertion
ordering, `after:`/cycle validation, skill-optional bodies, enforcement + fail-closed
semantics) are engine behaviours that belong in stories, not a PRD. → **technical track**
(skip `/prd`).
