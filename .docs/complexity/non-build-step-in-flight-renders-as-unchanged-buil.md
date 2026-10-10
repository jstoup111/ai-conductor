# Complexity: Non-build step in flight renders as unchanged build progress

Tier: S

Rationale: Against the rubric in `skills/conduct/SKILL.md` §2.5, this change has one new
`ConductorEvent` variant and no tables. It has 0 external integrations, no auth, and no state
machine, and it needs 2 stories, so Small wins on every signal. The work is additive telemetry: one
event variant with its sink declaration and daemon render case, a small timer class, two start/stop
call sites at existing dispatch seams in `conductor.ts`, and an in-flight fold plus one status
section built on the existing `scanInheritedState` / `readMergedFeatureEvents` readers. It adds no
config key, no settings schema, no hook, no CLI flag, and no persisted state.
