# Intake origin: per-project-work-tracker-backend-selection-in-regi

Source-Ref: jstoup111/ai-conductor#845
Owner: jstoup111

## Desired outcome

- A project can declare its work-tracking backend (`github` default, `jira`) plus backend-specific settings (e.g. Jira site URL, project key) per repo/project via registry and/or project config.
- The intake composition root selects the adapter from that config instead of hardcoding GitHub.
- Projects with no tracker config behave byte-for-byte as today (GitHub, zero migration).
