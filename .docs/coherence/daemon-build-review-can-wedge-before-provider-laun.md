# Coherence: Bounded Provider Preparation Lifecycle

**Date:** 2026-07-30
**Plan stem:** `daemon-build-review-can-wedge-before-provider-laun`
**Track:** technical
**Tier:** L
**Source:** `jstoup111/ai-conductor#1141`

The technical track has no PRD, so the `fr` row class is correctly omitted. The deterministic
validator accepts one mapping table per artifact, so all applicable row classes are consolidated
below.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-TI-1, story-TI-2 | covered | Every-step visibility and bounded pre-spawn recovery include BUILD and SHIP |
| outcome | outcome-2 | story-TI-2, story-TI-5 | covered | Revoke-before-replace plus synchronous spawn permit prevents duplicate workers |
| outcome | outcome-3 | story-TI-4 | covered | Output silence, heartbeat age, and process scans cannot terminate a running provider |
| outcome | outcome-4 | story-TI-1, story-TI-3 | covered | Lifecycle phase, reason, attempt identity, and exhaustion diagnostics are visible |
| outcome | outcome-5 | story-TI-2, story-TI-3 | covered | One replacement is persisted and repeat failure halts needs-human |
| story | story-TI-1 | task-1, task-3, task-4, task-5, task-14, task-18, task-19 | covered | State, persistence, wiring, timing, and rendering cover TI-1 |
| story | story-TI-2 | task-1, task-5, task-6, task-7, task-14, task-15, task-16, task-20 | covered | Deadline, race, late resume, replacement, fallback, settlement, and integration cover TI-2 |
| story | story-TI-3 | task-3, task-4, task-7, task-8, task-9, task-16, task-19 | covered | Persistence, malformed evidence, exhaustion, retention, reset, and diagnostics cover TI-3 |
| story | story-TI-4 | task-17, task-19, task-20 | covered | Heartbeat authority removal, labeling, and silent-provider behavior cover TI-4 |
| story | story-TI-5 | task-10, task-11, task-12, task-13, task-14, task-15, task-20 | covered | Contract, built-ins, custom providers, propagation, fallback, and integration cover TI-5 |
| story | story-TI-6 | task-2, task-17, task-20 | covered | Independent config and legacy heartbeat separation cover TI-6 |
| task | task-1 | story-TI-1, story-TI-2 | covered | Defines lifecycle authority |
| task | task-2 | story-TI-6 | covered | Owns preparation-timeout configuration |
| task | task-3 | story-TI-3 | covered | Owns durable episode evidence |
| task | task-4 | story-TI-3 | covered | Owns malformed-evidence behavior |
| task | task-5 | story-TI-1, story-TI-2 | covered | Begins visible bounded preparation |
| task | task-6 | story-TI-2 | covered | Owns revocation and late-resume denial |
| task | task-7 | story-TI-2, story-TI-3 | covered | Owns one persisted replacement |
| task | task-8 | story-TI-3 | covered | Owns needs-human exhaustion |
| task | task-9 | story-TI-3 | covered | Verifies exhausted HALT retention |
| task | task-10 | story-TI-5 | covered | Defines provider capability and permit |
| task | task-11 | story-TI-5 | covered | Enforces Claude spawn fencing |
| task | task-12 | story-TI-5 | covered | Enforces Codex spawn fencing |
| task | task-13 | story-TI-5 | covered | Owns unsupported-provider failure |
| task | task-14 | story-TI-1, story-TI-2, story-TI-5 | covered | Wires every provider-aware step |
| task | task-15 | story-TI-2, story-TI-5 | covered | Preserves fallback lifecycle identity |
| task | task-16 | story-TI-2, story-TI-3 | covered | Owns authoritative reset |
| task | task-17 | story-TI-4 | covered | Removes heartbeat termination authority |
| task | task-18 | story-TI-1 | covered | Persists lifecycle timing |
| task | task-19 | story-TI-1, story-TI-3, story-TI-4 | covered | Renders phases and telemetry semantics |
| task | task-20 | story-TI-2, story-TI-4, story-TI-5, story-TI-6 | covered | Proves the provider-boundary integration |

## Verdict

All 5 intake outcomes, 6 technical stories, and 20 plan tasks have verified counterparts.
Zero gaps and zero waivers.
