# Track: per-project-work-tracker-backend-selection-in-regi

Track: technical

Scope boundary: intake seam, full — a validated `tracker` key in project `.ai-conductor/config.yml`
(the shape reserved by adr-2026-07-22-canonical-tracker-client-seam, additively extended with
Jira-only `site` and `project_key`), one resolver that reads it, and backend selection in the
`buildIntake()` composition root covering poll, claim, and the land/handoff write-backs. Projects
with no `tracker` key behave byte-for-byte as today. A project that selects `jira` fails closed
(excluded from polling with a diagnostic event) until #849 supplies a Jira adapter. Excluded: the
Jira adapter itself (#849), daemon backlog reads (#851), close/PR linkage (#852), gate/halt status
writebacks (#853), and the registry record shape (no `ProjectRecord` field).

## Rationale

Internal intake plumbing with no end-user product requirements: the observable contract is one
config key plus zero-migration invariance, which stories express directly → technical track (no PRD).
