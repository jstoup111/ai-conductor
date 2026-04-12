# Story: Status Dashboard Display

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer running the conductor, I want a clear status dashboard showing all steps
with their current state so that I can see progress at a glance.

## Acceptance Criteria

### Happy Path
- Given the conductor is running, when it displays the dashboard, then each step shows
  its label, phase (UNDERSTAND/DECIDE/BUILD/SHIP), and status icon
- Given a step is complete, when displayed, then it shows a green checkmark (done)
- Given a step is in progress, when displayed, then it shows a yellow arrow (active)
- Given a step is pending, when displayed, then it shows an empty box
- Given a step was skipped (tier-dependent), when displayed, then it shows a skip arrow
- Given a step is stale (upstream revisited), when displayed, then it shows a yellow warning

### Negative Paths
- Given the terminal width is very narrow, when the dashboard renders, then it does not
  break or produce garbled output — it truncates gracefully
- Given a step has no recognized state value (corrupted state file), when the dashboard
  renders, then it shows the step as pending rather than crashing

### Done When
- [ ] Dashboard shows all steps with correct icons: done, stale, skipped, failed, in_progress, pending
- [ ] Dashboard includes feature name, project name, branch, and run mode
- [ ] Dashboard refreshes periodically during execution (live refresh)
- [ ] Activity line shows elapsed time and last meaningful log line
