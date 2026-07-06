# Complexity: Guard bin/install and self-build relink against worktree-rooted global installs (#363)

Tier: M

## Rationale

- Two integration points across languages: `bin/install` (bash guard + override flag)
  and `src/conductor/src/engine/install-freshness.ts` (`resolveHarnessRoot` /
  `relinkSkillsForSelfBuild` hardening), plus the `conductor.ts` self-build preflight
  call site whose HALT behavior must be preserved.
- New cross-component contract: registry-first root resolution introduces a read
  dependency on `~/.ai-conductor/registry.json` with fallback semantics.
- Failure-mode design matters (fail loud vs skip vs override) — negative paths are
  the whole point of the feature.
- No new data models, external integrations, auth, or state machines; expected
  story count is moderate (4–6). Not Small (guard semantics span two subsystems and
  a daemon HALT path); not Large (no schema/product surface, bounded diff).
