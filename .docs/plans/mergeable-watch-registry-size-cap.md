# Implementation plan: cap the mergeable-watch registry size (bounded growth)

Source issue: jstoup111/ai-conductor#149
Track: technical · Tier: S

## Summary

Add a max-COUNT cap to the mergeable watch registry so an unmerged `done` PR that never
self-prunes cannot grow it without bound. After the existing merged/closed/gone prune
and before `rewriteWatch`, trim the `survivors` list to a maximum entry count, dropping
the oldest excess and logging each drop via the injected `log` callback. No schema
change; max-AGE (which would need an enrollment-timestamp field) is deferred.

## Design

- **Single source change:** `sweepMergeableLabels` in
  `src/conductor/src/engine/mergeable-sweep.ts` (declared line 237). It builds
  `survivors` (line 248), prunes merged/closed/gone (lines 265–272, secondary re-check
  311–323), then calls `rewriteWatch(projectRoot, survivors)` at line 507.
- **Insert the cap between the loop and `rewriteWatch` (before line 507):**
  - Define a maximum count constant (e.g. `MAX_WATCH_ENTRIES = 100`) at module scope
    with a doc comment. (A configurable override can be threaded later; a constant keeps
    this S — no config-schema surface.)
  - If `survivors.length > MAX_WATCH_ENTRIES`, drop the oldest excess. The JSONL is
    append-ordered (`enrollWatch` appends, lines 82–89) and `readWatch` preserves order,
    so `survivors` is oldest-first; keep the last `MAX_WATCH_ENTRIES` and drop the front
    `survivors.length - MAX_WATCH_ENTRIES`.
  - For each dropped entry, `log?.('[mergeable-sweep] registry cap: dropping <prUrl> (slug <slug>) — over MAX_WATCH_ENTRIES')`
    using `SweepOpts.log` (line 223), matching the existing prune-log prefix (line 270).
    No silent truncation.
  - Pass the trimmed list to `rewriteWatch`.
- **No schema change:** `WatchEntry` (lines 64–72) is untouched; the cap is a pure
  array-length trim. `enrollWatch` and its call sites are unchanged.
- **Best-effort preserved:** `rewriteWatch` (lines 145–153) already swallows write
  failures (C3); the cap adds no new failure mode.
- **Not touched:** `pr-labels.ts` (the sibling #148 spec edits the not-found classifier
  there; this spec consumes it read-only via the existing import, lines 22–32).
- **ADR:** closes the deferred item in
  `.docs/decisions/adr-015-daemon-pr-labeling-sweep.md:90` ("(Optional, deferred) cap
  registry age/size … log any drop"). (The issue text's "ADR-014" is a mis-reference;
  ADR-014 is the OTel exporter.)

## Prerequisites

- None. The `survivors`/`rewriteWatch` seam exists; the cap is a local insertion.

## Tasks

### Task 1: Max-count constant + trim before rewrite
**Story:** Story 1a + Story 2a
**Type:** happy-path
**Steps:**
1. In `src/conductor/test/engine/mergeable-sweep.test.ts`, add a failing test: seed a
   registry with more than the cap of live-but-unmerged entries (all returning a kept
   state), run `sweepMergeableLabels`, assert the persisted registry (via `readWatch`)
   holds exactly `MAX_WATCH_ENTRIES` and that the OLDEST (front) entries were dropped.
   Add an under-cap test asserting no drops.
2. Verify RED.
3. In `mergeable-sweep.ts`, add the `MAX_WATCH_ENTRIES` constant and, before
   `rewriteWatch(projectRoot, survivors)` (line 507), trim `survivors` to the last
   `MAX_WATCH_ENTRIES` when it exceeds the cap.
4. Verify GREEN.
**Files:** `src/conductor/src/engine/mergeable-sweep.ts`
**Wired-into:** `src/conductor/src/engine/mergeable-sweep.ts#sweepMergeableLabels` (the existing `rewriteWatch` call at line 507)
**Dependencies:** none

### Task 2: Log every drop (no silent caps)
**Story:** Story 1b
**Type:** happy-path
**Steps:**
1. Extend the over-cap test to capture the injected `log` callback and assert one
   `[mergeable-sweep]` cap-drop line per dropped entry, naming the dropped PR.
2. Verify RED.
3. Emit `log?.('[mergeable-sweep] registry cap: dropping …')` for each dropped entry in
   the trim loop.
4. Verify GREEN.
**Files:** `src/conductor/src/engine/mergeable-sweep.ts`
**Wired-into:** `src/conductor/src/engine/mergeable-sweep.ts` (`SweepOpts.log`, line 223)
**Dependencies:** 1

### Task 3: Cap composes with self-prune + stays best-effort
**Story:** Story 3a + Story 3b
**Type:** negative-path
**Steps:**
1. Add a test seeding both gone PRs (MERGED/CLOSED/NOTFOUND) and a surplus of kept
   entries; assert the gone PRs are pruned by the existing state logic FIRST and the cap
   applies only to survivors. Add a test where `rewriteWatch` is forced to fail and
   assert the sweep does not throw (best-effort preserved).
2. Verify GREEN against Tasks 1–2.
**Files:** `src/conductor/test/engine/mergeable-sweep.test.ts`
**Wired-into:** none
**Dependencies:** 2

### Task 4: GREEN + full-suite check
**Story:** all
**Type:** verification
**Steps:**
1. Run `rtk proxy npx vitest run test/engine/mergeable-sweep.test.ts` in `src/conductor`
   (each worktree needs its own `npm install`).
2. Keep diffs minimal; confirm no other consumer depends on unbounded registry size.
**Files:** `src/conductor/src/engine/mergeable-sweep.ts`
**Wired-into:** none
**Dependencies:** 3

## Files likely touched

- `src/conductor/src/engine/mergeable-sweep.ts` — `MAX_WATCH_ENTRIES` constant + the
  trim-and-log step before `rewriteWatch` (line 507 region).
- `src/conductor/test/engine/mergeable-sweep.test.ts` — cap, logging, and composition tests.

(`src/conductor/src/engine/pr-labels.ts` is intentionally NOT touched — disjoint from
the sibling #148 spec.)

## Verification

- [ ] Over-cap registry trimmed to `MAX_WATCH_ENTRIES`, dropping the oldest excess.
- [ ] Each drop logs one `[mergeable-sweep]` line (no silent truncation).
- [ ] Under-cap registry unchanged; no drop lines.
- [ ] merged/closed/gone still self-prune first; cap applies only to survivors.
- [ ] `rewriteWatch` failure still swallowed (best-effort/non-blocking preserved).
- [ ] mergeable-sweep suite green; harness integrity suite green.

## Out of scope

- Max-AGE cap keyed on enrollment time — requires an `addedAt` field on `WatchEntry`,
  stamping in `enrollWatch`, and a call-site ripple (Medium); deferred as a follow-up.
- Making the cap operator-configurable via a config schema (a constant suffices for the
  bounded-growth guarantee).
- Any change to the not-found classifier (`pr-labels.ts`, #148) or to which PRs are
  enrolled.
