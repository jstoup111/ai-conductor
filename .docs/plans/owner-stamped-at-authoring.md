# Implementation Plan: Owner marker stamped at authoring; no silent dead spec

**Date:** 2026-07-21
**Issue:** #721 — "Owner marker enforcement is repo-local — harness deployments in the wild can author un-owned specs the owner-gate silently skips forever"
**Stem:** `owner-stamped-at-authoring`
**Stories:** `.docs/stories/owner-stamped-at-authoring.md`
**Complexity:** `.docs/complexity/owner-stamped-at-authoring.md` (Tier: M)
**ADR:** `.docs/decisions/adr-2026-07-21-owner-stamped-at-authoring.md` (APPROVED)
**Conflict check:** `.docs/conflicts/owner-stamped-at-authoring.md`
**Architecture:** `.docs/architecture/owner-stamped-at-authoring.md`
**Track:** technical (no PRD)
**Relates to:** #695 (`intake-only-enforcement`, PR #719) — same "born complete at capture, no new downstream failure mode" shape; disjoint file set.

## Operator directive (binding)

**The Owner guarantee must be harness-native machinery carried by the deployed runtime —
so ANY deployment guarantees a spec is owned, not just this repo (whose
`test/test_harness_integrity.sh` consumers never run).** Artifacts are **born owned** at
authoring time; an artifact that still arrives un-owned is **default-attributed to the
daemon's own owner + loudly logged**, never silently skipped and never rejected at merge or
dispatch time.

## Summary

Harden the two `Owner:` chokepoints that ship with `conduct-ts` to every consumer:

- **Layer A (born owned):** close the one write path (`authoring.ts`) that silently omits
  the owner — fall back to machine identity like `conductor.ts` already does — so no
  conduct-ts write emits an un-owned marker while identity resolves. `writeIntakeMarker`
  itself is already correct (stamps when owned, omits-not-blanks when not) and is
  test-pinned unchanged.
- **Layer B (no silent dead spec):** `decideSpecGate`'s two un-owned branches
  (`unowned-post-cutover`, `unowned-indeterminate`) return a **default-build** attributed
  to the daemon's own owner (new reason `unowned-defaulted`) instead of `{ build: false }`,
  and `daemon-backlog.ts` emits a **loud, actionable** build-with-notice. `other-owner`,
  `grandfathered`, and stamped-and-matching are preserved byte-identical (multi-operator
  isolation intact). No merge-time or dispatch-time rejection is introduced.

## Technical approach

- **`authoring.ts` machine-identity fallback** — when `deps.ownerConfig` is empty/absent,
  resolve via `readMachineOwnerConfig()` (the sanctioned `spec_owner` → `gh` chain) before
  calling `writeIntakeMarker`, mirroring the `conductor.ts` plan-step stamp. Preserves the
  existing injectable `deps.gh`/`deps.ownerConfig` seams for tests.
- **`gate.ts` default-build** — add `unowned-defaulted` to `GateReason`; the un-owned
  post-cutover and indeterminate arms return `{ build: true, reason: 'unowned-defaulted' }`
  (attributed to `daemonOwner.id` at the call site). The function stays pure.
- **`daemon-backlog.ts` escalation** — on an `unowned-defaulted` decision, push the spec into
  the buildable `items` (not `gatedItems`) and emit a loud line (slug + defaulted owner +
  "add an `Owner:` marker on the default branch to make it explicit"). Not the deduped-forever
  silent skip; `other-owner` handling is unchanged.
- **Docs** — update both READMEs' owner-gate sections (the current "un-owned … skipped"
  wording becomes born-owned + default-and-log) and add a `[Unreleased]` CHANGELOG entry.

## Tasks

### Task 1: Autonomous authoring is born owned from machine identity
**Story:** FR-1
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests (injected machine-config reader + `gh`): with an empty `ownerConfig`, `runAuthoring` stamps `Owner: <machine-id>` on the marker; no un-owned marker is written while identity resolves; a genuinely unresolvable identity writes no **blank** `Owner:` line (per the ADR write-path policy).
2. RED → implement the `readMachineOwnerConfig()` fallback in `authoring.ts` (mirror `conductor.ts:4967`) → GREEN.
3. Commit: "fix(owner-gate): autonomous authoring is born owned from machine identity"
**Files likely touched:** `src/conductor/src/engine/engineer/authoring.ts`, `src/conductor/test/engine/engineer/authoring.test.ts`
**Dependencies:** none

### Task 2: Pin the `writeIntakeMarker` born-owned contract (no code change)
**Story:** FR-2
**Type:** negative-path
**Verify-only:** yes
**Steps:**
1. Assert `writeIntakeMarker` stamps `Owner: <id>` when owned, **omits** (never blanks) `Owner:` when null/whitespace, preserves an existing `Source-Ref:`, and no-ops when neither ref nor owner is present — confirming the born-owned guarantee rests entirely on the caller (Task 1), with `intake-marker.ts` unchanged.
2. Commit: "test(owner-gate): pin writeIntakeMarker stamp/omit contract (born-owned rests on caller)"
**Files likely touched:** `src/conductor/test/engine/engineer/intake-marker.test.ts` (reads, does not modify, `src/conductor/src/engine/engineer/intake-marker.ts`)
**Dependencies:** Task 1

### Task 3: Gate returns default-build for an un-owned arrival
**Story:** FR-3
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: un-owned + merge on/after cutover → `{ build: true, reason: 'unowned-defaulted' }`; un-owned + indeterminate merge time → same; un-owned + merge **before** cutover → `grandfathered` (unchanged); `other-owner` and stamped-and-matching → unchanged.
2. RED → add `'unowned-defaulted'` to `GateReason`/`GateDecision` and return default-build from the two un-owned arms in `decideSpecGate` → GREEN.
3. Commit: "feat(owner-gate): un-owned specs default-build (unowned-defaulted), not silent-skip"
**Files likely touched:** `src/conductor/src/engine/owner-gate/gate.ts`, `src/conductor/test/engine/owner-gate/gate.test.ts`
**Dependencies:** none

### Task 4: Daemon builds the defaulted spec + emits a loud escalation
**Story:** FR-3
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: an `unowned-defaulted` decision places the spec in buildable `items` (not `gatedItems`); a loud, actionable line naming slug + defaulted owner + remedy is emitted (build-with-notice, not the deduped silent skip); an **unresolved** daemon owner still builds nothing (gate not consulted); `other-owner` still gates-out with its existing GATED entry.
2. RED → in `daemon-backlog.ts`, branch on `decision.reason === 'unowned-defaulted'` (build + loud log) vs the unchanged skip/`other-owner` handling → GREEN. Update `ownershipSkipMessage`/`gateRemedy` so the un-owned wording reflects the default-build.
3. Commit: "feat(owner-gate): daemon builds defaulted un-owned specs with a loud escalation"
**Files likely touched:** `src/conductor/src/engine/daemon-backlog.ts`, `src/conductor/test/engine/daemon-backlog.test.ts`
**Dependencies:** Task 3

### Task 5: Prove cross-operator isolation is intact and no new HALT was added
**Story:** FR-4
**Type:** negative-path
**Verify-only:** yes
**Steps:**
1. Assert `decideSpecGate`'s `other-owner` and stamped-and-matching decisions are unchanged from `main` (only the two un-owned arms changed).
2. Assert `daemon-backlog.ts` gates-out `other-owner` exactly as `main` and that no merge-time/dispatch-time rejection or HALT is introduced for a missing `Owner:` (the un-owned path only ever builds-with-log).
3. Commit: "test(owner-gate): guard other-owner isolation + no-new-HALT for un-owned specs"
**Files likely touched:** `src/conductor/test/engine/owner-gate/gate.test.ts`, `src/conductor/test/engine/daemon-backlog.test.ts`
**Dependencies:** Task 3, Task 4

### Task 6: Docs + CHANGELOG (docs-track-features)
**Story:** FR-5
**Type:** happy-path
**Steps:**
1. Update the owner-gate sections of `README.md` and `src/conductor/README.md`: intake markers are born owned from machine identity at every write path, and an un-owned arrival is default-built under the daemon's own owner with a loud escalation (`unowned-defaulted`) — supersede the "un-owned specs are surfaced … skipped" wording. Note the repo-local integrity check is a supplementary belt, not the enforcement.
2. Add an `[Unreleased]` entry to `CHANGELOG.md` (Added/Changed) describing the born-owned stamping + no-silent-skip default.
3. Commit: "docs(owner-gate): born-owned stamping + no-silent-skip default"
**Files likely touched:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** Task 1, Task 3, Task 4

## Task dependency graph

```
Task 1 ── Task 2
Task 3 ── Task 4 ── Task 5
Tasks 1,3,4 ── Task 6
```

## Out of scope

- Any change to the GitHub-issue criteria path owned by #695 (`intake.yml`,
  `intake-label-sync.yml`, `bin/intake-file`, `bin/intake-backfill`, `backlog-priority.ts`,
  `dependency-claim.ts`, `github-issues.ts`) — disjoint surface (see conflict-check).
- The marker format and `provenance.ts` parser (kept byte-identical), and the identity
  resolution chain (reused unchanged).
- A new auto-installed git pre-commit hook — rejected in the ADR (opt-in-only precedent;
  consumer-visible hook-wiring surface; redundant with the read-gate default).
- Removing the #720 repo-local integrity check — retained as a fast local belt.
- Any `settings.json` schema / hook wiring / `bin/conduct` CLI change → no migration block
  needed (internal gate-decision + authoring-fallback change; no consumer-visible CLI/hook/
  schema surface).
