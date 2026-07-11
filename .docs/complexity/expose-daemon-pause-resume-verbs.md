# Complexity Assessment — expose-daemon-pause-resume-verbs

Tier: S

## Signals

| Signal | Value |
|--------|-------|
| New domain models | 0 |
| External integrations | 0 |
| Auth / permission surfaces | 0 |
| State machines / workflows | 0 (behavior already exists; not touched) |
| Story count | 3 (2 happy + 1 negative) |
| Runtime behavior change | None — pure help-string registration + docs |
| Files touched | 3 (`cli.ts`, `README.md`, `src/conductor/README.md`) |

## Rationale

This is a discoverability/documentation fix for functionality that already shipped
(PR #296). The verbs `pause`/`resume` are already recognized by
`detectDaemonSupervisorCommand` and fully implemented in `daemon-supervisor-cli.ts`;
the only missing piece is their `.command().description()` declaration in the commander
help tree (so `--help` renders them) plus README command-form documentation and a
one-line refresh of `restart`'s stale description.

No models, no integrations, no auth, no new state, no algorithmic risk. The change is
mechanical and self-contained. → **Small.**

## Tier consequences (per HARNESS.md DECIDE flow)

- **PRD** — skipped (technical track; no product requirements).
- **architecture-diagram** — skipped (Small).
- **architecture-review** — skipped (Small).
- **conflict-check** — skipped (Small).
- **stories + plan** — authored (this artifact set).
