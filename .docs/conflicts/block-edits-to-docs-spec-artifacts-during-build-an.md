# Conflict Check: Phase-Scoped .docs Write-Guard (#788)

**Date:** 2026-07-22
**New stories:** .docs/stories/block-edits-to-docs-spec-artifacts-during-build-an.md
**Scanned against:** all .docs/stories/ (including features/), APPROVED ADRs in
.docs/decisions/, prior .docs/conflicts/, and the unmerged
spec/demote-task-stamping-from-gate-to-telemetry branch.
**Result:** 1 blocking conflict found; RESOLVED (Option 1, operator-selected). Re-check
clean — zero blocking conflicts remain.

## Conflict: Default-deny guard blocks BUILD-phase release-waiver authoring

**Stories involved:** "Docs-guard blocks .docs writes during BUILD/SHIP with
default-deny" (new) vs "self-host release gate — waiver in the change set" (existing,
Accepted: .docs/stories/self-host-release-gate-bin-conduct-breaking-surfac.md)
**Type:** behavioral overlap
**Severity:** blocking (for self-host builds that touch a classified breaking surface)

**Description:**
The release-gate stories (and CLAUDE.md's migration-gate waiver rule,
adr-2026-07-06-migration-gate-waiver) require `.docs/release-waivers/<plan-stem>.md` to
be **part of the feature's own `base...HEAD` diff** — i.e. authored by the implementing
session DURING the BUILD phase (fail-closed freshness: a waiver merged earlier never
satisfies a later feature). The new guard's default-deny blocks every write-tool
mutation under `.docs/` during BUILD/SHIP outside the allowlist, and the allowlist
currently names only `retro`. A self-host build needing a waiver would be mechanically
blocked from writing it — halting the release gate (TR-10 HALT) or pushing agents
toward the Bash escape hatch. Both stories are Accepted; both cannot hold as written.
Confidence: verified (release-gate story text lines 72-75, 153-156; CLAUDE.md waiver
rule; guard story default-deny path) — ~95%.

**Resolution Options:**
1. **Always-allowed prefix (recommended):** add `.docs/release-waivers/` as a static
   always-allowed prefix in the engine table (allowed during any BUILD/SHIP step,
   carried in the marker like step allowlist entries). Rationale: a waiver is a
   ship-time compliance artifact (morally like CHANGELOG), not a DECIDE spec-as-contract
   artifact — the guard's purpose (spec drift) is untouched by exempting it. Self-host
   only; consumer repos ignore stray waivers by design (verified in the release-gate
   stories' negative paths).
2. **Step-scoped allowlist entries:** allow `.docs/release-waivers/` only for the
   `build` step. Tighter, but remediation-driven fixes and rebase-time repairs also
   legitimately amend the diff — enumerating every such step re-introduces the
   name-enumeration fragility the design explicitly avoids.
3. **Move waiver authoring engine-side:** have the release gate write the waiver
   skeleton itself. Most invasive; changes the waiver's authorship semantics (the
   implementing session attests internal-only-ness); out of this feature's scope.

**Recommendation:** Option 1 — preserves both stories with one table row, keeps the
phase-keyed/no-name-enumeration principle, and the exempted prefix cannot express spec
drift.

## Clean pairs (verified, not assumed)

- **AuditTrailWriter under fresh-context retro** (audit-trail-write-completeness…):
  writes `.pipeline/audit-trail/events.jsonl` — not `.docs/`. No interaction.
- **Attribution/session-hook stories** (inline-build-work…, fresh-build-dispatch…,
  engine-invoked-task-attribution…): guard uses its own marker + own settings entry;
  no shared state, no ordering dependency. No conflict.
- **manual-test results**: sole writer targets `.pipeline/manual-test-results.md`
  (SKILL.md:116); the legacy `.docs/manual-test-results.md` is historical. No
  interaction.
- **shipped-record at finish**: Bash CLI write, outside the write surface — explicitly
  accepted scope (ADR §Decision 6). Not a conflict, recorded as a known bypass.
- **remediate plan append**: engine-process write (conductor.ts:1205); invisible to
  the hook. No conflict.
- **demote-task-stamping (unmerged spec branch)**: targets evidence-ledger gating, not
  MUTATION_GATE_HOOK/session-hook wiring; docs-guard's own-entry requirement removes
  any chaining dependency. No structural conflict.
- **guard-bin-install-and-self-build-relink / rtk-hook-preservation**: install-merge
  stories are about preserving existing hooks through install runs — the new story's
  idempotent, user-preserving merge criteria align with (and re-assert) that contract.
  No contradiction.

## Post-resolution status

**Resolved 2026-07-22 — Option 1 selected by operator** ("and it only applies to this
repo anyways" — self-host-only blast radius confirmed). Applied:

- ADR amended in place (same unlanded spec session, never authoritative on main — not a
  supersede case): allowlist model now = per-step prefixes + static always-allowed
  prefixes (`.docs/release-waivers/` active during any BUILD/SHIP step).
- Guard story: waiver-write pass criterion added; boundary-safe negative extended to
  `.docs/release-waivers-evil/`.
- Allowlist story: every BUILD/SHIP marker carries the always-allowed prefix; retro
  carries three `allow:` lines, `manual_test` exactly one.

**Re-check:** the exemption interacts with no other story — waivers are written by the
implementing session into its own diff (release-gate stories), read only by the
self-host release gate, and ignored in consumer repos (verified negative path). Prefix
is directory-boundary-safe, so it widens nothing else. Zero blocking conflicts; zero
degrading conflicts accepted.
