# Implementation Plan: build_review / ci_watch partial-block preservation (#1002)

**Date:** 2026-07-27
**Design:** technical track — no PRD (`.docs/track/build-review-ci-watch-partial-block-1002.md`)
**Stories:** `.docs/stories/build-review-ci-watch-partial-block-1002.md`
**Complexity:** `.docs/complexity/build-review-ci-watch-partial-block-1002.md` — Tier S
**Conflict check:** skipped — Tier S
**Architecture diagram / review:** skipped — Tier S
**Source issue:** jstoup111/ai-conductor#1002

## Summary

Replace the whole-block discard in the `build_review` and `ci_watch` normalizers with per-key
normalization that preserves valid sibling keys, warns by name for unknown or badly-typed keys, and
stops `ci_watch` from discarding silently. Consumers (`engine/step-runners.ts` via
`resolveBuildReviewConfig`, and `engine/ci-fix.ts`) already read the keys with `??` defaults and are
not modified — proving reach is a test concern, not a code change. 9 tasks.

## Technical Approach

**Root cause.** `src/conductor/src/engine/config.ts:845-898`. Both blocks compute
`Object.keys(block).find(k => k !== 'enabled')` and, on any hit, assign
`obj.<block> = { enabled: true }` — discarding the block including a valid `enabled`.
`build_review` pushes a warning naming the whole block value (`:850`); `ci_watch` (`:884`) pushes
nothing at all, which is why `ci-fix.ts:250`'s `cfg?.ci_watch?.cooldownMinutes ?? 60` can only ever
observe `undefined`.

**Shape of the fix.** One module-private helper in `config.ts`, used by both blocks:

```ts
type KeySpec = { validate: (v: unknown) => boolean; label: string };

function normalizeKeyedBlock(
  blockName: 'build_review' | 'ci_watch',
  raw: Record<string, unknown>,
  specs: Record<string, KeySpec>,
  warnings: string[],
): Record<string, unknown>
```

Per key in `raw`:
- key not in `specs` → warn `` `<blockName> has unknown key "<key>" — ignoring it; other keys are unchanged.` `` and omit only that key;
- key in `specs` but value fails `validate` → warn
  `` `<blockName>.<key> has invalid value <json>, falling back to the default.` `` and omit only
  that key (so the downstream `??` / resolver default applies);
- otherwise copy the value through.

`enabled` is then defaulted to `true` when absent or omitted, preserving today's fail-open
semantics for both blocks. Key specs:

| block | key | validate |
| --- | --- | --- |
| `build_review` | `enabled` | `typeof v === 'boolean'` |
| `build_review` | `perTaskFloor` | `typeof v === 'boolean'` |
| `ci_watch` | `enabled` | `typeof v === 'boolean'` |
| `ci_watch` | `cooldownMinutes` | `typeof v === 'number' && Number.isFinite(v) && v >= 0` |

**Deliberately unchanged (do not "improve" these):**
- absent / `null` → `{ enabled: true }`, no warning (both blocks);
- non-object (string, number, array) → `{ enabled: true }` + **one** warning. `build_review`
  already warns; `ci_watch` gains a warning here (Story 2 negative path) — this is the only
  change to the non-object path;
- totality: `validateConfig` still never throws and never returns `ok: false` for these two
  blocks. An invalid `cooldownMinutes` is a warning, **not** a hard error — unlike
  `mergeable_autoresolve.cooldownMinutes` (`config.ts:1437-1450`), whose block has no
  never-throws contract. Do not copy that behavior here; `test/engine/config.test.ts`'s
  "never throws — always returns ok: true" cases pin the difference.

**Consumers are untouched.** `resolveBuildReviewConfig` (`engine/resolved-config.ts:629-638`)
already does `typeof block?.perTaskFloor === 'boolean' ? … : true`, and `ci-fix.ts:250` already does
`cfg?.ci_watch?.cooldownMinutes ?? 60`. Tasks 4 and 7 assert reach through those existing paths
rather than editing them.

**Test runner:** from `src/conductor` — `rtk proxy npx vitest run test/engine/config.test.ts`
(then the wider `test/engine` directory in Task 9).

## Prerequisites

None — no migration, no new dependency, no schema change. `src/conductor` `npm install` must exist
in the build worktree (standing repo convention).

## Tasks

### Task 1: Per-key normalizer helper (unknown key drops only itself)
**Story:** Story 3, happy path 1
**Type:** happy-path

**Steps:**
1. Write failing test in `test/engine/config.test.ts`: `validateConfig({ build_review: { enabled: false, perTaskFlooor: true } })`
   → `result.config.build_review` is `{ enabled: false }`, exactly one warning, warning matches
   `/perTaskFlooor/`.
2. Verify RED (today: block becomes `{ enabled: true }`, warning names the whole value).
3. Implement `normalizeKeyedBlock` + `KeySpec` in `config.ts` and route the `build_review`
   plain-object branch (`:846-863`) through it with specs `enabled`/`perTaskFloor`.
4. Verify GREEN.
5. Commit: "fix(config): drop only the unknown key in build_review, not the block"

**Files likely touched:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/test/engine/config.test.ts`

**Dependencies:** none

### Task 2: build_review preserves a valid partial block
**Story:** Story 1, happy paths 1–2
**Type:** happy-path

**Steps:**
1. Write failing tests: `{ enabled: false, perTaskFloor: false }` → both preserved, zero warnings;
   `{ perTaskFloor: false }` → `perTaskFloor: false` and `enabled: true`, zero warnings.
2. Verify RED.
3. Implement: ensure the `enabled`-absent default is applied after per-key normalization (not
   before), so it cannot clobber siblings.
4. Verify GREEN.
5. Commit: "fix(config): preserve build_review siblings when perTaskFloor is set"

**Files likely touched:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/test/engine/config.test.ts`

**Dependencies:** Task 1

### Task 3: build_review bad-typed keys warn by name and keep siblings
**Story:** Story 1, negative paths 1–3
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) `{ enabled: 'banana', perTaskFloor: false }` → warning matches
   `/build_review\.enabled/`, `enabled === true`, `perTaskFloor === false`; (b)
   `{ enabled: false, perTaskFloor: 'sometimes' }` → warning matches
   `/build_review\.perTaskFloor/`, `enabled === false`, `perTaskFloor` absent; (c) non-object
   `build_review: 'yes'` → `{ enabled: true }` + exactly one warning (existing test at
   `config.test.ts:1402` still passes unmodified).
2. Verify RED for (a) and (b).
3. Implement: per-key invalid handling emits the named warning and omits only that key.
4. Verify GREEN, including the pre-existing `build_review` describe block untouched.
5. Commit: "fix(config): name the offending build_review key in warnings"

**Files likely touched:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/test/engine/config.test.ts`

**Dependencies:** Tasks 1, 2

### Task 4: perTaskFloor reaches its consumer
**Story:** Story 1, happy path 3 + Done When 2
**Type:** happy-path

**Steps:**
1. Write failing test: feed `{ build_review: { enabled: true, perTaskFloor: false } }` through
   `validateConfig`, pass `result.config` to `resolveBuildReviewConfig`
   (`engine/resolved-config.ts`), assert `{ enabled: true, perTaskFloor: false }` — the exact
   value `step-runners.ts:1571` branches on.
2. Verify RED against the pre-fix normalizer shape (guard: if GREEN by construction after Tasks
   1–3, keep it as the standing reach regression pin and say so in the commit body).
3. Implement: no production change expected; fix only if resolution drops the key.
4. Verify GREEN.
5. Commit: "test(config): pin build_review.perTaskFloor reach to its resolver"

**Files likely touched:**
- `src/conductor/test/engine/config.test.ts` (or `test/engine/resolved-config.test.ts` if that is
  where resolver tests live)

**Dependencies:** Tasks 1–3

### Task 5: ci_watch routed through the same helper (unknown key warns, block survives)
**Story:** Story 3, happy path 2 + Story 2 Done When 3
**Type:** happy-path

**Steps:**
1. Write failing test: `validateConfig({ ci_watch: { cooldownMinutes: 15, bogus: 1 } })` →
   `cooldownMinutes === 15`, `enabled === true`, exactly one warning matching `/bogus/`.
2. Verify RED (today: silently becomes `{ enabled: true }`, zero warnings).
3. Implement: route the `ci_watch` plain-object branch (`config.ts:881-892`) through
   `normalizeKeyedBlock` with specs `enabled`/`cooldownMinutes`; add the previously-missing
   warning on the non-object branch (`:894`).
4. Verify GREEN; confirm the existing `ci_watch` describe block (`config.test.ts:1578-1647`)
   still passes unmodified.
5. Commit: "fix(config): stop ci_watch discarding the block silently"

**Files likely touched:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/test/engine/config.test.ts`

**Dependencies:** Task 1

### Task 6: ci_watch preserves a valid partial block, including cooldownMinutes: 0
**Story:** Story 2, happy paths 1–2
**Type:** happy-path

**Steps:**
1. Write failing tests: `{ enabled: true, cooldownMinutes: 15 }` → both preserved, zero warnings;
   `{ cooldownMinutes: 0 }` → `cooldownMinutes === 0` (explicitly assert `0` survives and is not
   coerced to the 60 default), `enabled === true`, zero warnings.
2. Verify RED.
3. Implement: ensure the validity predicate is `v >= 0` (not truthiness) so `0` is kept.
4. Verify GREEN.
5. Commit: "fix(config): preserve ci_watch.cooldownMinutes including zero"

**Files likely touched:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/test/engine/config.test.ts`

**Dependencies:** Task 5

### Task 7: ci_watch negatives + cooldown reaches ci-fix
**Story:** Story 2, negative paths 1–3 + happy path 3
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) `{ enabled: false, cooldownMinutes: 'thirty' }` → warning matches
   `/ci_watch\.cooldownMinutes/`, `enabled === false`, `cooldownMinutes` absent; (b)
   `{ enabled: true, cooldownMinutes: -5 }` → same warning, `-5` not adopted, `enabled === true`;
   (c) `{ enabled: 'banana' }` → `enabled === true` + a warning naming `ci_watch.enabled`;
   (d) reach pin — a validated config with `ci_watch: { cooldownMinutes: 15 }` yields
   `cfg.ci_watch.cooldownMinutes === 15`, the value `ci-fix.ts:250` multiplies into `cooldownMs`.
2. Verify RED.
3. Implement: nothing expected beyond Tasks 5–6; fix if a predicate is wrong.
4. Verify GREEN.
5. Commit: "test(config): ci_watch invalid keys warn by name and never drop siblings"

**Files likely touched:**
- `src/conductor/test/engine/config.test.ts`

**Dependencies:** Tasks 5, 6

### Task 8: Totality + multi-unknown-key sweep for both blocks
**Story:** Story 3, negative paths 1–2
**Type:** negative-path

**Steps:**
1. Write tests: (a) a block with several unknown keys (`{ enabled: false, a: 1, b: 2 }`) for each
   block → every unknown key is named across the warnings and `enabled: false` survives; (b) a
   table-driven totality sweep over absent, `null`, `{}`, `'yes'`, `1`, `[]`, valid, partially
   valid, and fully invalid shapes for both blocks → `result.ok === true` every time and
   `result.config.<block>` is always defined.
2. Verify RED/GREEN and pin.
3. Implement: fix only if a shape throws or yields `undefined`.
4. Verify GREEN.
5. Commit: "test(config): totality and multi-unknown-key coverage for both blocks"

**Files likely touched:**
- `src/conductor/test/engine/config.test.ts`

**Dependencies:** Tasks 1–7

### Task 9: Docs, changelog, full verification
**Story:** Story 4 (all) + repo validation and release gates
**Type:** infrastructure

**Steps:**
1. Update `docs/reference/configuration.md`: remove/rewrite the two "Known limitation" callouts
   (`:819-826` build_review, `:849-853` ci_watch); change the `build_review.perTaskFloor` and
   `ci_watch.cooldownMinutes` rows (`:801`, `:836`) from "Unreachable from config" to working with
   their defaults; correct the normalizer references at `:77` and the block list at `:652` so
   `ci_watch` is no longer listed as a silent-discard block. Leave `kickback_escalation` and every
   other block's description exactly as-is (Story 4 negative path).
2. Add a `CHANGELOG.md` `[Unreleased]` → `### Fixed` entry: `build_review` and `ci_watch` no longer
   discard the whole block when a non-`enabled` key is set; `perTaskFloor` and `cooldownMinutes`
   now reach their consumers and invalid keys warn by name (#1002). Do **not** touch `VERSION`
   (repo is pre-v1).
3. Run `rtk proxy npx vitest run test/engine/config.test.ts` from `src/conductor`, then
   `rtk proxy npx vitest run test/engine` for collateral damage, then `rtk proxy npx tsc --noEmit`.
4. Run `test/test_harness_integrity.sh` from the repo root.
5. Commit: "docs: build_review/ci_watch partial blocks now preserved (#1002)"

**Files likely touched:**
- `docs/reference/configuration.md`
- `CHANGELOG.md`

**Dependencies:** Tasks 1–8

**Note on the release gate:** this change touches no `settings.json` schema, hook wiring, skill
symlink target, or `bin/conduct` CLI, so no migration block is expected. If the path-based
classifier flags a surface anyway, add a waiver under `.docs/release-waivers/` in the same diff per
`CLAUDE.md` — do not invent an empty migration block.

## Task Dependency Graph

```
Task 1 ──┬─ Task 2 ── Task 3 ── Task 4 ──┐
         └─ Task 5 ── Task 6 ── Task 7 ──┤
                                          ├─ Task 8 ── Task 9
```

## Integration Points

- After Task 4: `build_review` is fully fixed and `perTaskFloor` is provably readable at the
  resolver `step-runners.ts` consumes.
- After Task 7: `ci_watch` is fully fixed, no longer silent, and `cooldownMinutes` is provably
  readable at the value `ci-fix.ts` turns into `cooldownMs`.
- After Task 9: documentation no longer advertises either key as unreachable.

## Verification

- [ ] Story 1 happy (Tasks 2, 4) and negative (Task 3) criteria each covered by a task
- [ ] Story 2 happy (Tasks 6, 7d) and negative (Task 7) criteria each covered by a task
- [ ] Story 3 happy (Tasks 1, 5) and negative (Task 8) criteria each covered by a task
- [ ] Story 4 covered by Task 9, including the negative path (other blocks left accurate)
- [ ] Partially-specified blocks are tested for BOTH `build_review` and `ci_watch` (issue's
      explicit test requirement) — Tasks 2 and 6
- [ ] Pre-existing `build_review` / `ci_watch` describe blocks pass unmodified except where a
      task names the edit
- [ ] `validateConfig` totality preserved: never throws, never `ok: false` for these blocks
- [ ] No task exceeds 5 minutes of work; dependencies explicit and acyclic
- [ ] `CHANGELOG.md` `[Unreleased]` entry added; `VERSION` untouched
