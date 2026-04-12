# Epic: Pluggable Step Configuration

**Status:** DRAFT

## Description

As a developer configuring the harness for my project, I want to disable steps that don't
apply and add project-specific steps so that the SDLC flow matches my project's needs without
forking the harness.

## Child Stories

- ST-050 Disable steps via project config
- ST-051 Add custom steps with positional insertion
- ST-052 Config file loading and validation
- ST-053 Default tier override via config
- ST-054 Step registry from config + harness defaults

## Acceptance Criteria (Epic Level)

### Happy Path
- Given a project with `.harness/config.yml` that disables `architecture-review`, when the
  conductor runs, then architecture-review is skipped and marked as such in the dashboard
- Given a project config that adds `deploy-staging` after `build`, when the conductor reaches
  build completion, then it proceeds to deploy-staging before manual-test

### Negative Paths
- Given a config that disables a gating step (e.g., stories), when the conductor loads config,
  then it rejects the config with an error explaining why the step cannot be disabled
- Given a config that adds a step referencing a nonexistent SKILL.md, when the conductor loads
  config, then it fails with a clear error pointing to the missing file
- Given a malformed YAML config, when the conductor parses it, then it reports the parse error
  with line number and stops before running any steps
