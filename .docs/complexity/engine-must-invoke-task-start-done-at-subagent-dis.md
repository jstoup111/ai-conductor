# Complexity: engine-invoked task start/done at subagent dispatch (#477)

Tier: M

## Rationale

- **No new models, external integrations, or auth** — pure wiring of shipped
  #452 primitives (task CLI logic + worktree provisioning install path).
- **Moderate state machinery:** current-task stamp lifecycle (start → done),
  fail-closed rejection of id-less implementation dispatches, and an
  ambiguity guard for overlapping parallel dispatches (clear stamp → commit
  hook abstains).
- **Cross-surface touch:** new Claude-session hook asset, engine install
  wiring at worktree provisioning, build-session settings wiring,
  skills/pipeline/SKILL.md rewrite of steps 0/6 to document engine behavior,
  CHANGELOG Migration block (hook wiring is a canonical breaking surface).
- **One spike:** confirm PreToolUse tool-matcher hooks fire in headless
  `--print` sessions (gates the design; cheap one-shot test).
- Estimated 6–9 stories; well under Large (no schema/product surface, single
  subsystem), above Small (multiple surfaces + breaking-surface migration).

Per tier M: architecture diagram required, lightweight architecture review,
conflict-check required, no PRD (technical track).
