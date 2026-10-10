# Complexity: Monitor guided session triage-complete quit cue

Tier: S

Rationale: Two surfaces, both text-level — the monitor guided-session opening prompt
(`src/conductor/src/engine/monitor/session.ts`, plus the provider's quit instruction sourced from
the provider catalog) and a closing step in `skills/daemon-triage/SKILL.md`. No new runtime
mechanism, state, event, schema, or CLI surface; queue and launch mechanics are untouched. Risk is
confined to prompt wording and a unit-testable prompt builder.
