# Complexity: finish rehabilitates reused needs-remediation PRs

Tier: M

## Rationale

- **Integration points (drives M):** /finish + /pr SKILL.md contract changes,
  a new deterministic conductor-side completion check on the recorded PR's
  presentation/state, and an engine rehabilitation step touching `gh` (REST
  label ops via pr-labels.ts, draft→ready flip, idempotent Closes injection
  via issue-ref.ts). Skill + gate + engine + external CLI = multiple
  integrations.
- **Not L:** no new models, services, auth, state machines, or storage; all
  mechanical primitives already exist and are reused, not built.
- **Not S:** changes cross the skill/engine boundary and alter a gating
  completion check — regression risk to the daemon ship path warrants
  architecture review + conflict-check.
- Estimated stories: ~5 (happy path + negative paths for gh failures,
  never-halted PRs, missing sourceRef, idempotent re-run).
