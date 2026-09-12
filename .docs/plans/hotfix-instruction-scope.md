# Hotfix: scope repository startup instructions

Operator-requested hotfix, 2026-09-11. Rename the introduction to ai-conductor and
remove instructions that make unrelated daemon steps repeat testing or upkeep.

Scope check: repository-only (this repository's validation gates and startup
instructions); catalog n/a; provider-agnostic. No new skill registration.

## Instruction inventory

| Material | Disposition | Reason |
| --- | --- | --- |
| Mandatory HARNESS.md read | Keep | Shared execution contract remains authoritative. |
| Machinery/judgement and event-spine principles | Keep | Constrain repository design choices. |
| Duplicate third-party test policy | Cut | HARNESS.md already owns this policy. |
| Daemon safety rules and recovery context | Keep | Protect live worktrees, provider state, and dispatch evidence. |
| Skills/agents/tech-context/templates layout | Move to ARCHITECTURE.md | Reference material, not a step obligation. |
| Scope decisions and staged directory removal | Keep | Repository authoring constraints still apply. |
| Full suite after every change and unconditional edit triggers | Replace | Managed verification belongs to test_suite and the self-host release gate; direct hotfixes validate once at completion. |
| Test authoring and process isolation | Keep | Conditional safeguards when tests are actually authored or reviewed. |
| Partial integrity checklist | Cut; link validation reference | Canonical catalog already exists and the copied counts drift. |
| Worktree and release/migration obligations | Keep | Required actions before authoring or publication. |
| Release bot mechanics, semver table, release integrity description | Move to ARCHITECTURE.md | Operational reference; preserve authoring obligations in startup instructions. |
| HARNESS.md Flow recap | Cut | Duplicates the opening contract and architecture introduction; hook implementation detail is unnecessary startup context. |
| Documentation upkeep | No new callout | No standalone upkeep section exists in this revision; configured maintain-documentation already owns the repository pass. |

## Task 1: Apply the instruction inventory

Update AGENT_INSTRUCTIONS.md and the affected references. Preserve both root host
symlinks. Do not change engine configuration, lifecycle gates, or shared consumer
rules. No behavioral tests for natural-language wording.

Done when: managed steps are not directed to rerun suites after edits; standalone
hotfix validation has a clear completion owner; reference material has a canonical
destination; affected links resolve and harness integrity passes.
