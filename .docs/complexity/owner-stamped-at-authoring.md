# Complexity: Owner marker stamped at authoring; no silent dead spec — #721

**Issue:** #721 — "Owner marker enforcement is repo-local — harness deployments in the wild can author un-owned specs the owner-gate silently skips forever"
**Plan stem:** `owner-stamped-at-authoring`
**Relates to:** #695 (`intake-only-enforcement`, PR #719) — same "born complete at capture, no new downstream failure mode" shape; disjoint file set.

Tier: M

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | None. Reuses the existing `Owner:` marker line, the machine-identity resolver (`readMachineOwnerConfig` / `resolveDaemonOwner`), and `OwnerStamp`/`GateDecision` types. Adds one `GateReason` variant (`unowned-defaulted`). |
| Integrations | Two existing seams: the write chokepoint `writeIntakeMarker` (+ its `authoring.ts` caller) and the read chokepoint `decideSpecGate` (+ `daemon-backlog.ts`). No new external service, no new hook wiring, no new CLI command. |
| Auth / secrets | None beyond the machine identity already resolved by the owner-gate. |
| State machines | None. Stamping is a stateless at-write side effect; the gate is a pure function gaining one branch. No new claim/dispatch state. |
| Story count | 5 functional stories (3 born-owned write paths + 1 load-bearing negative-path "un-owned arrival defaults + loudly logs, never rejects" + 1 explicit-owner-isolation-preserved guard). |
| Blast radius | Owner-gate + intake-marker authoring only. The claim path, pipeline gates, CI, and the `other-owner` isolation decision are provably untouched (a story guards the last). |

## Why M (not S, not L)

- **Not S:** it touches more than one seam (the `writeIntakeMarker` write path AND
  the `decideSpecGate` read path across `gate.ts` + `daemon-backlog.ts`), and it
  **changes a captured design decision** — the owner-gate's `unowned-post-cutover`
  silent-skip becomes a default-build. Reversing a shipped gate decision is a genuine
  architectural choice that must be recorded in an ADR and conflict-checked against the
  owner-gate's original ADRs and against #695. Small would skip both — and skipping the
  conflict-check is exactly how a competing decision slips in unnoticed.
- **Not L:** no data model, no state machine, no new long-lived service, no new hook
  wiring or CLI, no `settings.json` schema change. The change is bounded to two existing
  functions plus their tests and docs.

## Tier consequences (per engineer skill)

- `/architecture-diagram`: present (lightweight) — `.docs/architecture/owner-stamped-at-authoring.md`.
- `/architecture-review`: lightweight, one ADR — `.docs/decisions/adr-2026-07-21-owner-stamped-at-authoring.md` (APPROVED before land).
- `/conflict-check`: present — `.docs/conflicts/owner-stamped-at-authoring.md` (reconciles with #695 and the owner-gate ADRs).
- `/prd`: skipped (technical track — acceptance criteria live in the stories).
