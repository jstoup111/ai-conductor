# Complexity: Reliable CI repair dispatch

Tier: M

Source: jstoup111/ai-conductor#2153

The expanded change crosses the existing check-context builder, daemon dispatch wiring, sweep attempt bookkeeping, repair outcome handling, and build-provider readiness boundaries. It reuses existing provider selection, isolated repair worktrees, configured verification, and lease-protected publication. No new service, persistent store, provider configuration surface, or product requirements document is needed.

Medium is appropriate because the work requires integration proof across these boundaries and negative outcomes must preserve attempt limits and publication authority. Small would understate those interactions; Large would overstate a bounded correction within the existing repair flow.

Required DECIDE outputs: technical track, architecture diagram, lightweight feasibility/alignment review, accepted stories, conflict check, implementation plan, and coherence check. No production implementation is part of this spec branch.
