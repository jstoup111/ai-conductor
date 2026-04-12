# Story: Disable Steps via Project Config

**Status:** ACCEPTED
**Epic:** EP-002 Pluggable Step Configuration
**Skill:** (new — config system)

As a developer, I want to disable SDLC steps that don't apply to my project so that the
flow only includes relevant steps.

## Acceptance Criteria

### Happy Path
- Given `.harness/config.yml` contains `steps.disable: [architecture-review, retro]`, when
  the conductor loads config, then those steps are marked `skipped` in the step registry
  and never execute
- Given a disabled step, when the dashboard displays, then it shows the skip icon with a
  note: "disabled via config"
- Given a step is disabled, when downstream gates reference it, then the gate is satisfied
  (disabled counts as skipped)

### Negative Paths
- Given the config disables a gating step (e.g., stories, plan, build), when the conductor
  loads config, then it rejects the config with: "Cannot disable gating step: [step].
  Reason: [why it's required]"
- Given the config disables a step that doesn't exist in the registry, when parsed, then it
  warns: "Unknown step '[name]' in steps.disable — ignoring"
- Given the config disables all steps in a phase, when the conductor runs, then it warns
  but allows it — an empty phase is skipped entirely

### Done When
- [ ] steps.disable in config prevents listed steps from executing
- [ ] Disabled steps show skip icon with "disabled via config" note
- [ ] Disabled steps satisfy downstream gates
- [ ] Gating steps cannot be disabled
- [ ] Unknown step names produce a warning (not a crash)
