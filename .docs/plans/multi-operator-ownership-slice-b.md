# Implementation Plan: Multi-operator ownership — Slice B (authoring-side)

**Date:** 2026-07-02
**Stories:** `.docs/stories/multi-operator-ownership-slice-b.md` (Accepted, 3 stories)
**Complexity:** M (`.docs/complexity/multi-operator-ownership-slice-b.md`)
**Architecture review:** `architecture-review-2026-07-02-multi-operator-ownership-slice-b.md`
(APPROVED WITH CONDITIONS 1–5, all reflected in the stories)
**Governing ADR:** `adr-2026-07-01-machine-scoped-operator-identity` (APPROVED)
**Conflict check:** Clean as of 2026-07-02 (`.docs/conflicts/multi-operator-ownership-slice-b.md`)
**Track:** technical

## Summary

Finishes the authoring side of multi-operator ownership hardening in 13 test-first
tasks: identity sourced from the machine (user config) at both engineer entry points,
land fails closed on unresolved identity, and the plain `/conduct` DECIDE path stamps
the same owner marker the `/engineer` path does.

## Technical Approach

- **Identity source switch (Story 1).** Replace the interim
  `loadConfig(target.canonicalPath) → ok ? config : {}` reads at
  `engine/engineer/loop.ts` (~L542) and `engine/engineer-cli.ts` (~L591) with
  `readMachineOwnerConfig()` from `engine/owner-gate/machine-identity.ts` (merged in
  Slice A). Same `OwnerConfig` shape flows into the existing chain — project config is
  never consulted for identity. Add a fail-fast resolution check at each entry so an
  operator learns of unresolved identity before authoring effort is spent; `landSpec`
  remains the enforcement point.
- **Fail-closed land (Story 2).** In `engine/engineer/land-spec.ts`, `landSpec` already
  resolves the chain (~L275) before `writeIntakeMarker` → `git add` → `commit`. Flip the
  unresolved branch from `specOwner = null` (silent un-owned stamp) to a thrown,
  actionable error naming both remediations (`spec_owner` in
  `~/.ai-conductor/config.yml`, `gh auth login`). Because resolution already precedes
  every write, no reordering is needed; refusal leaves the worktree + branch intact
  (keep-on-failure, FR-6).
- **Universal stamping (Story 3).** The conduct DECIDE tail has no marker writer today
  (only parsers — the #189/#190 backfill proves the gap). Hook the conductor's
  plan-step completion (the point where the `.docs/plans/<stem>.md` artifact gate
  passes in `engine/conductor.ts`) to resolve machine identity and call the existing
  `engineer/intake-marker.ts#writeIntakeMarker(repoRoot, <plan-stem>, sourceRef?,
  owner)` — keyed by the **plan stem**, the daemon's discovery unit
  (`daemon-backlog.ts` L312/L352). `writeIntakeMarker` must preserve an existing
  `Source-Ref:` line when re-stamping.
- **Tests.** Vitest via `rtk proxy npx vitest run` (RTK swallows vitest output
  otherwise); the worktree needs its own `npm install` in `src/conductor`. The two
  interim tests are REWRITTEN in place — they must not survive asserting the
  swallow-to-gh fallback.

## Prerequisites

- `cd src/conductor && npm install` (fresh worktree has no `node_modules`).
- Verify main is the base (spec authored against post-#185/#183 code — both merged).

## Tasks

### Task 1: Rewrite loop.test.ts identity-source contract (RED)
**Story:** Story 1 — negative "project `spec_owner: alice` + user `spec_owner: bob` → `Owner: bob`"
**Type:** negative-path
**Steps:**
1. In `test/engine/engineer/loop.test.ts`, REWRITE the interim test "does NOT honor a
   project-config spec_owner (D2 anti-leak) — falls through to gh login": commit
   `spec_owner: Carol` in the target's project config, set user config
   `spec_owner: bob`, assert the landed marker carries `Owner: bob` (not carol, not the
   gh login).
2. Verify it fails (RED) — the interim code reads project config and swallows.
**Files likely touched:** `src/conductor/test/engine/engineer/loop.test.ts`
**Dependencies:** none

### Task 2: Switch loop.ts to readMachineOwnerConfig (GREEN)
**Story:** Story 1 — happy "user config `spec_owner: bob` → chain receives bob"
**Type:** happy-path
**Steps:**
1. In `engine/engineer/loop.ts` (~L542), replace the `loadConfig(target.canonicalPath)`
   identity read + `ok ? config : {}` swallow with `readMachineOwnerConfig()` (inject
   the user-config reader per the existing machine-identity seam).
2. Verify Task 1's test passes (GREEN); run the loop suite for regressions.
3. Commit: "feat(slice-b): loop authoring identity from machine config (D1)"
**Files likely touched:** `src/conductor/src/engine/engineer/loop.ts`
**Dependencies:** Task 1

### Task 3: Rewrite engineer-cli-land-owner.test.ts identity-source contract (RED)
**Story:** Story 1 — negatives "project alice + user bob → bob" and "project alice + no
user + gh ghlogin → ghlogin, no swallow"
**Type:** negative-path
**Steps:**
1. REWRITE the interim test "does NOT honor a project-config spec_owner (D2 anti-leak)
   — identity never comes from the repo": project config `spec_owner: Alice`, user
   config `spec_owner: bob` → marker `Owner: bob`.
2. Add the fallback case: project `spec_owner: Alice`, NO user `spec_owner`, gh →
   `ghlogin`; assert `Owner: ghlogin` and that no config-load failure is swallowed on
   the identity path.
3. Verify both fail (RED).
**Files likely touched:** `src/conductor/test/engine/engineer/engineer-cli-land-owner.test.ts`
**Dependencies:** none

### Task 4: Switch engineer-cli.ts to readMachineOwnerConfig (GREEN)
**Story:** Story 1 — happy paths at the CLI call site
**Type:** happy-path
**Steps:**
1. In `engine/engineer-cli.ts` (~L591), same replacement as Task 2.
2. Verify Task 3's tests pass (GREEN).
3. Commit: "feat(slice-b): engineer-cli land identity from machine config (D1)"
**Files likely touched:** `src/conductor/src/engine/engineer-cli.ts`
**Dependencies:** Task 3

### Task 5: landSpec refuses unresolved identity (RED)
**Story:** Story 2 — negative (primary) "unresolved → loud throw before any write"
**Type:** negative-path
**Steps:**
1. New test: `landSpec` with empty `ownerConfig` and a failing/uninjected gh runner, in
   a worktree with valid Accepted artifacts → rejects; error message contains BOTH
   `~/.ai-conductor/config.yml` and `gh auth login`.
2. Verify it fails (RED) — current code stamps un-owned.
**Files likely touched:** `src/conductor/test/engine/engineer/land-spec.test.ts` (or the
existing land test file)
**Dependencies:** none

### Task 6: Implement the fail-closed flip in landSpec (GREEN)
**Story:** Story 2 — negative (primary) + happy regression
**Type:** negative-path
**Steps:**
1. In `engine/engineer/land-spec.ts` (~L280), replace
   `const specOwner = ownerResolution.resolved ? ownerResolution.id : null;` with a
   throw on `!ownerResolution.resolved` carrying the actionable message; remove the
   un-owned (`null`) stamp path and the "degrades to unresolved" comment contract.
2. Verify Task 5 passes (GREEN); run the land suite — resolved-identity tests must
   still pass (Story 2 happy regression).
3. Commit: "feat(slice-b): landSpec fails closed on unresolved identity (D3)"
**Files likely touched:** `src/conductor/src/engine/engineer/land-spec.ts`
**Dependencies:** Task 5

### Task 7: No-write contract after refusal (RED→GREEN)
**Story:** Story 2 — negatives "no marker / nothing staged / no commit; worktree +
branch retained"
**Type:** negative-path
**Steps:**
1. Extend the Task 5 test (or add one): after the rejected `landSpec`, assert
   `.docs/intake/<slug>.md` does NOT exist, `git status --porcelain` shows nothing
   staged, `git log` count on `spec/<slug>` is unchanged, and the worktree directory
   still exists.
2. Should pass once Task 6 lands (the throw precedes all writes) — if any write
   precedes the gate, fix ordering until green.
3. Commit: "test(slice-b): refusal leaves zero writes, worktree retained (FR-6)"
**Files likely touched:** land test file
**Dependencies:** Task 6

### Task 8: Gate fires even with invalid artifacts present (RED→GREEN)
**Story:** Story 2 — negative "unresolved + DRAFT ADR → still refuses with no writes"
**Type:** negative-path
**Steps:**
1. Test: worktree contains an ADR still in DRAFT status (un-approved) AND identity is
   unresolved →
   `landSpec` rejects and the no-write contract of Task 7 holds (no guard path stamps
   or stages anything first).
2. Verify green (guards are read-only; if not, reorder until green).
3. Commit: "test(slice-b): fail-closed ordering vs artifact guards"
**Files likely touched:** land test file
**Dependencies:** Task 6

### Task 9: Fail-fast identity check at the loop entry (RED→GREEN)
**Story:** Story 1 — negative "unresolved → refuse BEFORE DECIDE authoring begins"
**Type:** negative-path
**Steps:**
1. Test: loop run with unresolved identity → reports the Story 2 error and dispatches
   NO DECIDE authoring (assert the authoring fn was never invoked).
2. Implement: resolve the chain once at idea start in `loop.ts`; refuse early with the
   same error text (landSpec gate stays as enforcement).
3. Commit: "feat(slice-b): fail-fast identity check at loop entry"
**Files likely touched:** `loop.ts`, `loop.test.ts`
**Dependencies:** Task 2, Task 6

### Task 10: Fail-fast identity check at the CLI land entry (RED→GREEN)
**Story:** Story 1 — negative (CLI half); Story 2 error-text reuse
**Type:** negative-path
**Steps:**
1. Test: `engineer land` CLI with unresolved identity → exits non-zero with the
   actionable error before `landSpec` is entered.
2. Implement in `engineer-cli.ts`.
3. Commit: "feat(slice-b): fail-fast identity check at CLI land entry"
**Files likely touched:** `engineer-cli.ts`, `engineer-cli-land-owner.test.ts`
**Dependencies:** Task 4, Task 6

### Task 11: Conduct DECIDE tail stamps the owner marker (RED)
**Story:** Story 3 — happy "plan finalized → `.docs/intake/<plan-stem>.md` with `Owner:`"
**Type:** happy-path
**Steps:**
1. Contract test: drive the conductor's plan-step completion path (the
   `.docs/plans/<stem>.md` artifact gate passing) with resolved machine identity `bob`;
   assert `.docs/intake/<plan-stem>.md` exists with `Owner: bob`, and the path equals
   the stem `daemon-backlog.ts` resolves for that plan file (High-impact keying risk).
2. Verify it fails (RED) — no writer exists on this path today.
**Files likely touched:** new/extended conductor test under `test/engine/`
**Dependencies:** none

### Task 12: Wire writeIntakeMarker into the plan-step completion (GREEN)
**Story:** Story 3 — happy + "single writer" Done-When
**Type:** happy-path
**Steps:**
1. In `engine/conductor.ts`, at the plan-step completion point (post artifact gate),
   resolve identity via the machine chain and call
   `writeIntakeMarker(repoRoot, planStem, sourceRef?, owner)`. No new writer
   implementation — grep proves `writeIntakeMarker` remains the only marker writer.
2. Verify Task 11 passes (GREEN); engineer-path land tests unchanged (no regression).
3. Commit: "feat(slice-b): conduct DECIDE tail stamps owner marker (D4)"
**Files likely touched:** `src/conductor/src/engine/conductor.ts` (or the extracted
step-completion module the code actually uses — locate at implementation)
**Dependencies:** Task 11

### Task 13: Source-Ref preservation + unresolved refusal on conduct path (RED→GREEN)
**Story:** Story 3 — negatives "existing `Source-Ref:` survives" and "unresolved →
refuse, write nothing"
**Type:** negative-path
**Steps:**
1. Test A: pre-existing `.docs/intake/<stem>.md` with `Source-Ref: owner/repo#N`; owner
   stamping preserves the line (extend `intake-marker.ts` merge semantics if RED).
2. Test B: unresolved identity at the conduct tail → loud refusal with the Story 2
   error; no marker written.
3. Implement until green.
4. Commit: "feat(slice-b): marker stamping preserves Source-Ref; fails closed (D3/D4)"
**Files likely touched:** `intake-marker.ts`, conductor test file
**Dependencies:** Task 12

## Task Dependency Graph

```
T1 ─▶ T2 ─┐
T3 ─▶ T4 ─┤
T5 ─▶ T6 ─┼─▶ T9 (loop entry)   T6 ─▶ T7, T8
          └─▶ T10 (CLI entry)
T11 ─▶ T12 ─▶ T13
Docs/CHANGELOG ride each commit (harness repo rule); no separate task.
```

## Integration Points

- After Task 6: engineer land path is fully fail-closed — exercisable end-to-end with
  `conduct-ts engineer land` in a scratch repo.
- After Task 12: a plain `/conduct`-authored spec is daemon-buildable (owner gate sees
  the stamp) — the #189/#190 manual-backfill class of gap is closed.

## Verification

- [ ] All happy path criteria covered (T2, T4, T6-regression, T11/T12)
- [ ] All negative path criteria covered (T1, T3, T5, T7, T8, T9, T10, T13)
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
- [ ] Interim tests rewritten, not retained (T1, T3)
- [ ] Marker keyed by plan stem, single writer (T11/T12)
