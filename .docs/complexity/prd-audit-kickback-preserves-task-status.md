# Complexity Assessment: prd-audit kickback preserves task-status.json

**Plan stem:** `prd-audit-kickback-preserves-task-status`
**Date:** 2026-07-05
**Source:** jstoup111/ai-conductor#302

Tier: L

## Signals

| Signal | Value | Reading |
|---|---|---|
| Models/tables | 0 | Small |
| External integrations | 0 (engine-internal only) | Small |
| Auth/authz | None | Small |
| State machines | prd_audit → build kickback + task-status lifecycle + re-kick idempotency + survivable-park interaction | Medium |
| Coordinated contract change | Engine becomes sole authority for `task-status.json`; `/pipeline` and `/remediate` SKILL.md contracts change; `autoheal` promoted to authoritative; in-flight-state migration | **Large** |
| Estimated stories | ~7–9 (seed-merge happy/idempotent/preserve-rework, task-ID-derived completion + fallback + park, remediation-extends-plan idempotent, empty-plan park, #115 no-regression, fresh-build no-false-positive, single-authority migration) | Large |

## Decision

**Large.** Started as a two-mechanism Medium fix, but a Fable-driven adversarial pressure-test of
the design (`.docs/decisions/architecture-review-prd-audit-kickback-preserves-task-status.md`)
showed the durable fix is not a localized patch: it **inverts ownership** of `.pipeline/task-status.json`
so the engine (not the build agent) is its single writer, deriving per-task completion from
task-ID-stamped git commits (promoting the existing `autoheal` machinery to authoritative). That is a
**coordinated contract change across the engine + `/pipeline` SKILL.md + `/remediate` SKILL.md**, with
`autoheal` hardening, a survivable auto-park last-resort (reconciled with the unlanded #280
forward-progress work), and a careful **migration of in-flight state** (merge-not-overwrite seeding).

No data model / integration / auth keeps the individual signals low, but the cross-cutting,
correctness-critical, multi-artifact coordination + migration is the Large trigger. Full chain:
conflict-check, architecture-diagram, architecture-review (ADR), system tests, retro. The plan is
sequenced so the loop-and-wipe elimination (engine seed+merge+derive) lands first as a self-contained,
testable slice, then remediation-extends-plan and the survivable park layer on top.

Track: technical. Confirmed with operator (2026-07-05): decoupled engine-owned design ("the right
way"), task-ID-in-commit evidence bar, Fable to pressure-test the design.
