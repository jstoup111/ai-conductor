# Implementation plan: pr-labels structured gh not-found detection

Source issue: jstoup111/ai-conductor#148
Track: technical · Tier: S

## Summary

Replace `pr-labels.ts`'s brittle English-substring not-found classifier with a
structured one that keys off gh's GraphQL not-found signal reachable on the thrown
`ExecFileException` (`err.stderr` + non-zero `err.code`). Preserve the existing
`NOTFOUND`/`UNKNOWN` state contract and the fail-safe direction (uncertain → keep) so
`mergeable-sweep.ts` needs no change. Detection narrows from five loose fragments to
one durable signal, gated by exit code.

## Design

- **Primary change site:** `src/conductor/src/engine/pr-labels.ts`.
- `isNotFoundError` (`pr-labels.ts:234-237`) today reads only `err.message`. Widen it
  to inspect the structured fields on the thrown `ExecFileException`:
  - Read `err.stderr` (and `err.code`) in addition to `err.message`.
  - Return `true` **only** when (a) the process exited non-zero AND (b) the combined
    stderr/message carries gh's GraphQL not-found signal — the stable
    `Could not resolve to a PullRequest` phrase / GraphQL error type `NOT_FOUND`
    (a much narrower, gh-owned string than the five English fragments).
  - Everything else — including a non-zero exit with empty/ambiguous stderr — returns
    `false` → `UNKNOWN` → kept (Story 2).
- Replace the loose `NOT_FOUND_PATTERNS` (`pr-labels.ts:225-232`) with the single
  structured GraphQL-not-found matcher (keep it as a named constant for testability;
  drop `'404'`, `'no such'`, `'no pull requests'`, `'not found'` as standalone
  prune triggers so unrelated transient messages can't prune).
- `prMergeState` (`pr-labels.ts:335-365`) keeps its shape: `catch (err)` →
  `isNotFoundError(err) ? NOTFOUND_SENTINEL : ERROR_SENTINEL`. The sentinels
  (lines 204-210, 217-223) and the `PrMergeState` contract are unchanged.
- **Runner seam:** the production runner (`makeProductionGh`, `pr-labels.ts:61-67`)
  already lets the `execFile` rejection (an `ExecFileException` carrying `.code` and
  `.stderr`) propagate to the catch, so no production-runner change is required for
  the real path. `isNotFoundError` reads those fields off the thrown error directly —
  the typed `GhRunner` return shape (`{ stdout }`) is untouched, so test fakes that
  reject with a shaped `Error` (setting `.stderr`/`.code`) drive it without widening
  the seam.
- **No change to `mergeable-sweep.ts`:** `sweepMergeableLabels` (`mergeable-sweep.ts:237`)
  consumes only `state.state` (prunes on `MERGED||CLOSED||NOTFOUND` at 265-272 and
  311-323; keeps `UNKNOWN` at 276-280). Preserving the state contract keeps it inert.

## Prerequisites

- None. The change is inside `pr-labels.ts`'s classifier; the state contract and
  sweep consumer already exist.

## Tasks

### Task 1: Structured not-found matcher constant + helper
**Story:** Story 1a + Story 3
**Type:** happy-path
**Steps:**
1. Write a failing unit test (in `pr-labels.test.ts`) for a new `isNotFoundError` behavior: an error object with `code !== 0` and `stderr` containing `Could not resolve to a PullRequest` → `true`; an error whose message contains `"not found"` but no GraphQL signal → `false`.
2. Verify RED.
3. In `pr-labels.ts`, replace `NOT_FOUND_PATTERNS` (lines 225-232) with a single named constant capturing gh's GraphQL not-found signal (e.g. `GH_GRAPHQL_NOT_FOUND = 'could not resolve to a pullrequest'` plus optional GraphQL-error-type `NOT_FOUND`), documented.
4. Verify GREEN.
**Files:** `src/conductor/src/engine/pr-labels.ts`
**Wired-into:** `src/conductor/src/engine/pr-labels.ts#isNotFoundError`
**Dependencies:** none

### Task 2: Widen `isNotFoundError` to read structured fields, exit-code gated
**Story:** Story 1a + Story 2 (fail-safe)
**Type:** happy-path
**Steps:**
1. Write failing tests: non-zero `code` + GraphQL-not-found `stderr` → `true`; non-zero `code` + empty stderr → `false`; a transient `stderr` (`could not resolve host`, auth failure) → `false`.
2. Verify RED.
3. Rewrite `isNotFoundError` (lines 234-237) to inspect `err.stderr`/`err.code`/`err.message` on the `ExecFileException`, returning `true` only when exit is non-zero AND the structured GraphQL not-found signal is present.
4. Verify GREEN.
**Files:** `src/conductor/src/engine/pr-labels.ts`
**Wired-into:** `src/conductor/src/engine/pr-labels.ts#prMergeState` (line 355 catch — unchanged call, new classifier behavior)
**Dependencies:** 1

### Task 3: Preserve the state contract through `prMergeState`
**Story:** Story 1b + Story 2a
**Type:** happy-path
**Steps:**
1. Write failing tests driving `prMergeState` with a fake `runGh` that rejects with (a) a GraphQL-not-found-shaped error → asserts returned state `'NOTFOUND'`; (b) a transient-shaped error → asserts returned state `'UNKNOWN'`.
2. Verify RED.
3. Confirm `prMergeState`'s catch mapping (line 355-364) is unchanged and returns the correct sentinel via the new `isNotFoundError`. No structural change expected; adjust only if a helper signature moved.
4. Verify GREEN.
**Files:** `src/conductor/src/engine/pr-labels.ts`
**Wired-into:** `src/conductor/src/engine/pr-labels.ts#prMergeState`
**Dependencies:** 2

### Task 4: Sweep-level regression — prune vs keep unchanged, wording-drift safe
**Story:** Story 1b + Story 3
**Type:** negative-path
**Steps:**
1. In `mergeable-sweep.test.ts`, add/extend a test where `prMergeState` (or its underlying gh fake) yields `NOTFOUND` from a structured signal → entry pruned (drop logged); and a transient error containing an old English fragment → entry KEPT (survivor), proving no mis-prune.
2. Verify GREEN against Tasks 1–3 (no `mergeable-sweep.ts` source change).
**Files:** `src/conductor/test/engine/mergeable-sweep.test.ts`
**Wired-into:** none (asserts existing `sweepMergeableLabels` behavior via the new classifier)
**Dependencies:** 3

### Task 5: GREEN + full-suite check
**Story:** all
**Type:** verification
**Steps:**
1. Run `rtk proxy npx vitest run test/engine/pr-labels.test.ts test/engine/mergeable-sweep.test.ts` in `src/conductor` (each worktree needs its own `npm install`).
2. Keep diffs minimal; confirm no other consumer relied on the removed `NOT_FOUND_PATTERNS` export.
**Files:** `src/conductor/src/engine/pr-labels.ts`
**Wired-into:** none
**Dependencies:** 4

## Files likely touched

- `src/conductor/src/engine/pr-labels.ts` — `NOT_FOUND_PATTERNS` → structured
  constant, `isNotFoundError` rewrite; `prMergeState` catch unchanged.
- `src/conductor/test/engine/pr-labels.test.ts` — new/updated classifier tests.
- `src/conductor/test/engine/mergeable-sweep.test.ts` — prune-vs-keep regression.

(`src/conductor/src/engine/mergeable-sweep.ts` is intentionally NOT touched — the
state contract is preserved.)

## Verification

- [ ] Structured GraphQL not-found (non-zero exit + `Could not resolve to a PullRequest`) → `NOTFOUND` → pruned.
- [ ] Transient/ambiguous error (incl. empty stderr, `could not resolve host`) → `UNKNOWN` → kept + retried.
- [ ] An unrelated message containing an old English fragment no longer prunes.
- [ ] `mergeable-sweep.ts` unchanged; its behavior verified via the new classifier.
- [ ] pr-labels + mergeable-sweep suites green; harness integrity suite green.

## Out of scope

- Adding a dedicated `gh api graphql` NOT_FOUND probe (a second round-trip) — noted as
  a future option only if stderr inspection proves insufficient.
- The watch-registry age/size cap (#149) — a separate mergeable-sweep hardening.
- Any change to which PRs get watched or to label application.
