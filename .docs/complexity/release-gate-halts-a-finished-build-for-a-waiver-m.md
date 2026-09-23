# Complexity: release-gate-halts-a-finished-build-for-a-waiver-m

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One schema-bounded verdict shape for the release-disposition step (migration / waiver / unclassifiable) |
| External integrations | None new — the step already reads and writes the retained SHIP draft PR |
| Auth / permission surface | None — `.docs/release-waivers/` is already always write-allowed (`phase-marker.ts`) |
| State machines | None new — the existing fail-closed TR-10 gate stays the validator |
| ADR impact | Amends adr-2026-07-06-migration-gate-waiver (who authors the waiver; attestation rests on PR-merge review) |
| Files touched | Repository-local skill (`.agents/skills/release-disposition/SKILL.md`), possibly `self-host/release-gate.ts` and its tests |

## Rationale

The change crosses a skill contract and a fail-closed engine gate and amends an approved ADR, so it
needs lightweight architecture review and a conflict check against the release-gate and
release-disposition stories — more than Small. It adds no integration, no new state machine, and
leaves the classifier untouched, so it is not Large. → **Medium.**
