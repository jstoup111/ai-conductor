# Complexity Assessment: Auto-opened needs-remediation PR occupies the branch's retained draft-PR slot

**Date:** 2026-08-09
**Tier:** M
**Source:** jstoup111/ai-conductor#1415
**Plan stem:** auto-opened-needs-remediation-pr-occupies-the-bran

Tier: M

## Signals

| Signal | Value | Reading |
|---|---|---|
| Models/tables | 0 | Small |
| External integrations | 1 (GitHub via `gh`) | Small/Medium |
| Auth/authz | None | Small |
| State machines | Yes — the feature branch's PR lifecycle becomes one PR with a halt *state* (live ⇄ needs-human), replacing two colliding PR shapes | Medium |
| Modules touched | `conductor.ts`, `ship-draft-pr.ts`, `build-failure-escalation.ts`, `halt-pr-rehabilitation.ts`, plus eligibility readers `ci-fix.ts` / `mergeable-sweep.ts` | Medium |
| Estimated stories | ~6–9 (birth, decorate-on-halt, clear-on-resume, adoption of existing placeholders, eligibility restoration, no-commits edge) | Medium |

## Decision

**Medium.** No data model and a single integration surface (GitHub through the injected `gh` seam)
keep it off Large. But this is not a one-call-site patch: it moves *when* the implementation draft
PR is born, converges two PR shapes into one PR carrying a halt state, and must deterministically
clear that state on a successful re-dispatch while keeping the existing rehabilitation path working
for branches already stuck (#1395, #1412). The label also feeds two independent eligibility
predicates (`ci-fix.ts:264`, `mergeable-sweep.ts:431`), so the state transitions have downstream
consumers that must be re-verified.

That combination — a lifecycle change with multiple consumers and a required backward-compatible
adoption path — warrants the full Medium chain: architecture-diagram, architecture-review,
conflict-check, and coherence-check. It does not warrant Large: there is no new integration, no
schema, no auth surface, and the blast radius is confined to the daemon's PR-presentation path.
