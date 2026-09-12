# Complexity: Reliable test temporary storage

Tier: S

Operator confirmed Small on 2026-09-11. This bounded change selects test storage and adapts existing startup/cleanup wiring to distinguish storage from the original temporary directory. It introduces no runtime service, production schema, provider dependency, quota manager, or scheduler. Existing redirect, owner-heartbeat, stale-root sweep, and leak-guard mechanisms remain the foundation.

Risks are localized: allocating before Vitest loads, preserving the original temporary-directory guard, retaining concurrent run roots, and keeping tmux cleanup restricted to corroborated fixture paths. Tests must mock process boundaries; no operator tmux session may be reached.

Under the composer Small route, PRD, architecture diagram/review, conflict-check, and coherence-check artifacts are not required. Stories and a plan with explicit task dependencies and criterion coverage remain required.
