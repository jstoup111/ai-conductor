# Story: Before/After Hooks on Skills

**Status:** DRAFT
**Epic:** EP-003 Skill Override System
**Skill:** (new — config system)

As a developer, I want to run custom scripts before or after a skill executes so that I can
augment harness behavior without replacing entire skills.

## Acceptance Criteria

### Happy Path
- Given `.harness/config.yml` specifies `skills.hooks.brainstorm.after: .harness/hooks/notify.sh`,
  when brainstorm completes successfully, then the after-hook script executes
- Given a before-hook is configured, when the skill is about to run, then the before-hook
  executes first — if it succeeds, the skill runs normally
- Given both before and after hooks exist for a skill, when the skill runs, then the order
  is: before-hook -> skill -> after-hook
- Given a skill is both replaced (ST-060) AND has hooks configured, when the step runs, then
  hooks wrap the replacement skill: before-hook -> replacement skill -> after-hook. Hooks
  always wrap the active skill regardless of whether it's the default or an override.

### Negative Paths
- Given a before-hook exits non-zero, when the hook fails, then the skill does NOT run and
  the step is treated as failed (enters recovery flow)
- Given an after-hook exits non-zero, when the hook fails, then the step is treated as failed
  even though the skill itself succeeded — the hook failure is the step failure
- Given a hook script path doesn't exist, when the conductor loads hooks, then it fails with:
  "Hook for '[skill]' not found: [path]"
- Given a hook script is not executable, when the conductor checks permissions, then it warns
  and attempts to run it via `bash <path>` as a fallback

### Done When
- [ ] Before-hooks execute before the skill; after-hooks execute after
- [ ] Before-hook failure prevents the skill from running
- [ ] After-hook failure marks the step as failed
- [ ] Missing hook scripts detected at config load time
- [ ] Non-executable scripts handled gracefully
- [ ] Execution order: before -> skill -> after
- [ ] Hooks wrap replacement skills (not just defaults)

> **Conflict resolution (2026-04-12):** Hooks always wrap the active skill, whether default
> or override. See .docs/conflicts/2026-04-12-pluggable-harness-stories.md, Conflict 2.
