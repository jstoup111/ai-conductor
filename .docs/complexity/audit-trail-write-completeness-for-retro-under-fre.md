# Complexity Assessment

**Tier: M**

**Feature:** Engine event-sink audit-trail writer — every step/gate/retry/kickback/HALT
outcome appends a structured record to `.pipeline/audit-trail/events.jsonl` so `/retro`
can reconstruct run friction under the fresh-session-per-step model (#325) without
conversational recall. Source: jstoup111/ai-conductor#328.

## Signals

| Signal | Present? | Notes |
|---|---|---|
| New/changed data models | Yes (small) | New `AuditRecord` shape `{step, phase, event, reason?, cause?, attempt?, at}`; new `halt_cleared` emission; no persistence-schema migration |
| External integrations | No | Purely local `.pipeline/` file writes |
| Auth / identity | No | — |
| State machines / workflows | Touches one | Hooks into the existing engine loop at defined seams (retry loop, verdict/kickback outcome, HALT write/clear); adds no new states |
| Story count | Medium (~5–6) | Writer module; seam wiring (gate_pass/gate_fail/kickback/retry); HALT write/clear records; clean-pass positive evidence; retro Data Collection update; completeness tests |
| Cross-file blast radius | Moderate | New `audit-trail.ts` + touches `conductor.ts` (3–4 seams), `halt-marker.ts`/`task-progress.ts` or their callers, `types/events.ts`, `skills/retro/SKILL.md`, tests |
| Reversibility | Good | Append-only sidecar records; removing the writer restores status quo; no consumer-visible CLI/hook/schema change |

## Rationale

Not **S**: the change cuts across multiple engine seams in `conductor.ts`, introduces a
new record type and a new event, carries a cross-cutting completeness guarantee
("absence of a record is provably a bug") that needs dedicated negative-path tests, and
updates a skill contract (`/retro` Data Collection). Not **L**: single component (the
conductor engine), no external integrations, no auth, no data migration, no
multi-service coordination; the design was fully settled in explore (event-sink writer,
approach A, operator-approved).

## Tier consequences (DECIDE)

- `/prd` — skipped (technical track; see `.docs/track/`).
- `/architecture-diagram` — required (Medium).
- `/architecture-review` — required, lightweight (Medium); ADRs must be APPROVED.
- `/conflict-check` — required (Medium).
- Build-ready set: **track → complexity → architecture-diagram → architecture-review →
  stories → conflict-check → plan**.
