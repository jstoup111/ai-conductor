# Conflict Check: Pluggable Harness Architecture Stories

**Date:** 2026-04-12
**Stories checked:** 36 feature stories across 16 skill areas + 5 epics
**Conflict types scanned:** contradiction, behavioral overlap, state conflict, resource contention, sequencing

## Conflicts Found

### Conflict 1: Enforcement Bypass via Skill Override

**Stories involved:** ST-050 (Disable Steps) vs ST-060 (Skill Replacement)
**Files:** .docs/stories/features/config/ST-050-disable-steps.md vs .docs/stories/features/config/ST-060-skill-replacement.md
**Type:** behavioral overlap
**Severity:** degrading

**Description:**
ST-050 establishes that gating steps (stories, plan, build, finish) cannot be disabled via
config. However, ST-060 allows projects to override any skill's SKILL.md, including changing
the `enforcement` field in frontmatter. A project could override a gating step's skill to
change enforcement from `gating` to `advisory`, then skip it via the normal skip mechanism.
This creates a backdoor around the gating protection.

**Resolution Options:**
1. Lock enforcement level for gating steps — overrides can change the skill content but not
   the enforcement field. The conductor reads enforcement from a hardcoded registry, not from
   the SKILL.md frontmatter.
2. Allow enforcement changes but warn — the conductor accepts the override but logs a prominent
   warning: "Gating step [step] has been downgraded to advisory via override."
3. Allow enforcement changes freely — trust the project to make its own decisions.

**Recommendation:** Option 1.
**Resolution:** Option 1 accepted. ST-060 updated — enforcement is locked for gating steps
(stories, plan, build, finish). Overrides can change skill content but not enforcement level
for those steps. Non-gating steps can have enforcement changed freely.

---

### Conflict 2: Hook Applicability to Replaced Skills

**Stories involved:** ST-061 (Skill Hooks) vs ST-060 (Skill Replacement)
**Files:** .docs/stories/features/config/ST-061-skill-hooks.md vs .docs/stories/features/config/ST-060-skill-replacement.md
**Type:** behavioral overlap
**Severity:** degrading

**Description:**
ST-061 defines before/after hooks on skills. ST-060 defines full skill replacement. Neither
specifies what happens when a skill is both replaced AND has hooks configured. Three possible
behaviors exist, and the stories are ambiguous about which one applies:
- (A) Hooks run around the replacement skill (before -> replacement -> after)
- (B) Hooks only apply to the harness default — replacement disables hooks
- (C) Config validation rejects hooks + replacement on the same skill

**Resolution Options:**
1. Hooks always run regardless of replacement — they wrap whatever skill is active (default
   or override). This is the most flexible and intuitive behavior.
2. Replacement disables hooks for that skill — if you're replacing the whole skill, you
   control the full behavior. Hooks are for augmenting, not wrapping replacements.
3. Config rejects the combination — force the user to choose one mechanism per skill.

**Recommendation:** Option 1.
**Resolution:** Option 1 accepted. ST-061 updated — hooks always wrap the active skill
(default or replacement). Execution order: before-hook -> active skill -> after-hook,
regardless of whether the skill is the harness default or a project override.

---

## Clean Checks (No Conflicts)

The following potential overlaps were evaluated and found to be non-conflicting:

- **ST-005 (Tier Skipping) vs ST-050 (Disable Steps):** Different mechanisms — tier skipping
  is automatic based on complexity classification, config disabling is explicit. They coexist
  cleanly because tier-dependent steps are not gating steps.

- **ST-003 (Checkpoints) vs ST-009 (Recovery):** Both offer `b = go back` but at different
  trigger points. Checkpoints fire on success, recovery fires on failure. Complementary.

- **ST-008 (Session Management) vs ST-009 (Recovery):** Recovery intentionally creates a
  fresh session, not the feature session. Both stories document this correctly.

- **ST-006 (Gate Enforcement) vs ST-013 (Story Generation):** Same gate described from
  different perspectives (conductor vs skill). Complementary, not overlapping.

- **ST-022 (Manual Test auto-skip) vs ST-050 (Config disable):** Two independent skip
  mechanisms. Auto-skip is behavior-based, config-disable is explicit. No conflict.

- **ST-007 (Worktree isolation) vs ST-026 (Bootstrap scaffolding):** Bootstrap runs before
  worktree setup by design — project-level scaffolding happens in the main repo, feature
  work in the worktree. Intentional sequencing.
