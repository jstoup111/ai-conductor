# Implementation plan: skip the per-dispatch engine tsup rebuild when engine source is unchanged

Source issue: jstoup111/ai-conductor#715
Track: technical · Tier: S

## Summary

`publish()` in `src/conductor/scripts/publish-engine.mjs` runs the tsup build **unconditionally**
into a `.engine-staging-*` dir, then computes a content SHA of the build **output** and only skips
the finalize+flip when it matches (`content unchanged (<sha>) — publish skipped`). The expensive
build that discovers "nothing changed" always runs (~2-3 min per dispatch). Add a **pre-build**
guard: compute a key over the engine build **inputs**, compare it to the key recorded for the
current (`dist`-linked) version, and — only when it matches and the current dist is intact — skip
the tsup build entirely and return the current version. Fail open (full rebuild) on any doubt so a
genuinely-changed engine always rebuilds (#625/#598). The existing post-build output-SHA guard and
the atomic finalize/flip are left exactly as they are, as a second safety net.

## Design

- **Source-key helper (new, in `engine-store.ts`).** Add an exported
  `computeEngineSourceKey({ conductorRoot }): Promise<string>` that returns a sha256 over a
  **defined, explicit superset** of tsup's real inputs, in deterministic sorted order:
  - the entire engine source tree `src/` (recursively — reuse the existing `collectFiles` +
    per-file `path\0bytes\0` hashing pattern already used by `computeContentStamp`, which today
    hashes a build-output dir), and
  - the build-config inputs: `package.json`, `package-lock.json`, `tsconfig.json`,
    `tsup.config.ts`, and `scripts/publish-guard.mjs` (imported by the tsup config).
  Over-inclusion is deliberate: it can only cost an unnecessary rebuild, never a stale skip. The
  helper reuses the existing sorted, content-addressed hashing so it stays consistent with
  `computeContentStamp` and cannot drift.

- **Sidecar record (new dotfile, mirrors the sentinel).** Persist the source key as
  `<dist-versions/<id>>/.engine-source-key` (plain text: the hex key). Write it right after the
  finalize/flip completes — in the same region that removes the `.publish-incomplete` sentinel —
  so it is only ever present on a fully-published version. Engine-identity hashes a single artifact
  file, not the version directory, so this sidecar is invisible to staleness detection and to GC
  (GC keys on version ids and pidfiles). It is also outside the staging dir at `computeVersionId`
  time, so it does not perturb the version id or the output-SHA comparison.

- **Pre-build skip (in `publish()`).** Immediately before invoking the tsup command, compute the
  current source key and compare to the recorded key of the current version:
  1. Resolve `currentTarget(conductorRoot)`; if none → **no skip** (build).
  2. Read `<storeRoot>/<current>/.engine-source-key`; missing/unreadable/empty → **no skip** (build).
  3. Compute `computeEngineSourceKey({ conductorRoot })`; if it **throws**, catch → **no skip**
     (build). (Fail open — the cache never fails or blocks a publish.)
  4. If the computed key equals the recorded key **and** the current version dir is an intact
     directory (reuse the same `lstat(...).isDirectory()` intactness check the output-SHA guard
     already does) → skip: remove nothing (no staging dir was created), log a **distinct**
     source-cache-hit line (e.g. `engine source unchanged (<key>) — build skipped, dist stays at
     <current>`), and `return { versionId: current, dir: currentDir }`.
  5. Otherwise fall through to the existing build → staging → finalize → flip path, which now also
     writes the sidecar for the new version.

- **Test seam.** Keep the change testable with the existing `--tsup-cmd` / `runCommand` seam by
  making the source-key computation injectable on `publish(opts)` — an optional
  `computeSourceKey?: (o: { conductorRoot }) => Promise<string>` (defaulting to the real helper),
  parallel to the existing `runCommand`/`tsupCommand` seams — so tests assert skip-vs-build without
  materializing a full engine tree. Real-tree behavior is covered by the helper's own unit tests.

- **Non-goals (kept out — Tier S boundary):** no change to `bin/setup`'s `npm install` step, no
  change to the versioned dist-versions/dist-symlink layout, no change to the output-SHA
  idempotence guard, GC, or `flipCurrent`.

## Prerequisites

- None. All seams exist: `publish()`'s `runCommand`/`tsupCommand` injection, `currentTarget`,
  `resolveEngineStoreRoot`, the `.publish-incomplete` sentinel precedent, and the `collectFiles` +
  content-stamp hashing in `engine-store.ts`.

## Tasks

### Task 1: Add `computeEngineSourceKey` helper over the defined input set
**Story:** Story 2
**Type:** happy-path
**Verify-only:** no
**Dependencies:** none
**Files likely touched:** src/conductor/src/engine/engine-store.ts, src/conductor/test/engine/engine-store.test.ts

RED: add a failing test — `computeEngineSourceKey({ conductorRoot })` over a fixture tree
(`src/`, `package.json`, `package-lock.json`, `tsconfig.json`, `tsup.config.ts`,
`scripts/publish-guard.mjs`) is deterministic across two calls, changes when any input in the set
changes (a src file byte, and the lockfile), and does **not** change when a file outside the set
changes. GREEN: implement the helper reusing the existing `collectFiles` + sorted `path\0bytes\0`
hashing; return full/prefixed hex. Commit.

### Task 2: Pre-build source-cache skip + sidecar persistence in `publish()`
**Story:** Story 1, Story 3
**Type:** happy-path
**Verify-only:** no
**Dependencies:** Task 1
**Files likely touched:** src/conductor/scripts/publish-engine.mjs, src/conductor/test/engine/publish-engine.test.ts

RED: add failing tests using the build-command stub (record invocation count):
(a) two publishes over an unchanged injected source key → 2nd publish invokes the build stub **0**
times, leaves no `.engine-staging-*` dir, `dist` unchanged, returns the 1st `versionId`, and logs a
distinct source-cache-hit line; (b) a first-ever publish writes `.engine-source-key` into the
finalized version dir. GREEN: add the injectable `computeSourceKey` seam to `publish(opts)`; insert
the pre-build skip (resolve current → read sidecar → compute key → intactness check → skip/return);
write the sidecar in the finalize region alongside the sentinel removal. Commit.

### Task 3: Changed-source and fail-open rebuild paths
**Story:** Story 2, Story 3
**Type:** negative-path
**Verify-only:** no
**Dependencies:** Task 2
**Files likely touched:** src/conductor/test/engine/publish-engine.test.ts

RED→GREEN: tests asserting the build **is** invoked (rebuild) when — the injected source key
differs from the recorded one; the current version dir is removed though the key matches
(dangling current, heal); the current version has **no** sidecar; the sidecar is corrupt/empty; and
the injected `computeSourceKey` **throws** (fail open — build runs, publish exits 0). Assert each
either finalizes a fresh version or heals, and that publish never errors on a cache fault. Commit.

### Task 4: GREEN + focused-suite check
**Story:** all
**Type:** verification
**Verify-only:** yes
**Dependencies:** Task 3
**Files likely touched:** src/conductor/scripts/publish-engine.mjs

Run `rtk proxy npx vitest run test/engine/publish-engine.test.ts test/engine/engine-store.test.ts
test/engine/publish-interrupted.test.ts` in `src/conductor` (each worktree needs its own
`npm install`). Confirm the interrupted-publish and output-SHA idempotence tests still pass
unchanged (the pre-build skip must not perturb them). Keep diffs minimal. No code changes in this
task — verification only.

## Files likely touched

- `src/conductor/src/engine/engine-store.ts` — new `computeEngineSourceKey` helper (reuses
  `collectFiles` + content-stamp hashing).
- `src/conductor/scripts/publish-engine.mjs` — pre-build source-cache skip, injectable
  `computeSourceKey` seam, `.engine-source-key` sidecar write in the finalize region.
- `src/conductor/test/engine/engine-store.test.ts` — source-key helper tests.
- `src/conductor/test/engine/publish-engine.test.ts` — skip / rebuild / fail-open tests.

## Verification

- [ ] A second publish over unchanged engine source invokes the tsup build 0 times and `dist` is
      unchanged (Story 1).
- [ ] Any change to a defined engine build input forces a rebuild (Story 2).
- [ ] Absent / corrupt sidecar, no current version, dangling dist, or a throwing key computation all
      fall through to a full build; publish never errors on a cache fault (Story 3).
- [ ] `publish-interrupted` and output-SHA idempotence behavior are unchanged.
