# Implementation plan — Evidence-range anchor rung: distinguish absent anchor from stale anchor

Fix `getEvidenceRange` (`src/conductor/src/engine/autoheal.ts`) so the empty-string
anchor sentinel that every production gate call supplies is recognized as
"no recorded anchor" and routed straight to branch-base (merge-base) derivation,
instead of being fed into the reachability probe and logged as a
recorded-but-unreachable anchor. A genuinely non-empty unreachable anchor keeps its
existing `unreachable` warning verbatim; derivation results and the fail-closed
contract are unchanged.

Root cause (verified): `autoheal.ts:762` coerces the omitted anchor to `''`;
`autoheal.ts:370` probes `git rev-parse --verify '^{commit}'` (exit 128);
`autoheal.ts:380` logs `anchor  is unreachable` (empty value, doubled space) on
100% of gate derivations.

## Summary

One guarded branch added at the top of the anchor-resolution block in
`getEvidenceRange`. Empty/blank anchor → skip the probe, emit a distinct
informational "no recorded anchor" line (NOT a warn), fall through to the SAME
merge-base ladder already present. Non-empty anchor → unchanged (probe, then the
existing `unreachable` warn on failure). Tests updated/added in the existing
`getEvidenceRange` describe block; the production gate path is exercised
end-to-end for the zero-`unreachable` assertion.

## Tasks

### Task 1: Add an absent-anchor guard that skips the reachability probe
**Story:** Story 2 (absent anchor → branch base, no `unreachable`); Story 1 (present anchor unchanged)
**Type:** happy-path

**Steps:**
1. Write failing test in the `getEvidenceRange` describe block: `getEvidenceRange(root, '')`
   against a repo with a resolvable origin default and branch commits ahead returns
   `<merge-base>..HEAD`, and `result.warnings` contains NO entry matching `/unreachable/`.
   (Today it contains exactly one such entry — the RED.)
2. Verify RED.
3. Implement: in `getEvidenceRange`, before the `git rev-parse --verify '${anchor}^{commit}'`
   call (~`autoheal.ts:370`), branch on `anchor.trim() === ''`. When absent, do NOT run
   the probe; set `lowerBound = null` and fall directly into the existing merge-base
   ladder (fork-point → plain merge-base) that already lives in the `else` branch —
   factor the ladder so both the absent and the genuinely-unreachable paths reuse it
   (no duplicated git calls).
4. Verify GREEN.
5. Commit: "fix(engine): absent evidence anchor skips reachability probe, derives branch base (#510)"

**Files:**
- src/conductor/src/engine/autoheal.ts
- src/conductor/test/engine/autoheal.test.ts

**Dependencies:** none

### Task 2: Emit a distinct "no recorded anchor" line instead of an empty-value warn
**Story:** Story 2 (absence logged distinctly, informational not warn)
**Type:** happy-path

**Steps:**
1. Write failing test: `getEvidenceRange(root, '')` records exactly one informational
   line whose text contains `no recorded anchor` (or equivalent absence wording) and
   does NOT contain the substring `unreachable`, and does NOT render an empty anchor
   value (assert no `/anchor\s\sis/` doubled-space shape). Assert it is surfaced via a
   channel distinct from `result.warnings` (e.g. an info log / not pushed onto
   `warnings`) so it reads as routine, not a fault.
2. Verify RED.
3. Implement: in the absent-anchor branch from Task 1, emit the distinct line via
   `console.info`/`console.log` (mirroring the existing logger seam) — NOT
   `logger.warnings.push` / `console.warn`. Keep the message stable and greppable.
4. Verify GREEN.
5. Commit: "fix(engine): distinct 'no recorded anchor' info line replaces empty-value warn (#510)"

**Files:**
- src/conductor/src/engine/autoheal.ts
- src/conductor/test/engine/autoheal.test.ts

**Dependencies:** 1

### Task 3: Preserve the genuine unreachable-anchor negative path verbatim
**Story:** Story 3 (non-empty unreachable SHA still warns, naming the SHA)
**Type:** negative-path

**Steps:**
1. Write/confirm failing-or-guard test: a NON-EMPTY unreachable SHA
   (`deadbeef…deadbeef`) still yields exactly one warning that matches `/unreachable/`,
   contains the non-empty 7-char short SHA, and contains NO doubled-space/empty-value
   rendering. Also assert the returned range/commits equal the plain merge-base
   fallback (unchanged results).
2. Verify RED (or confirm it stays GREEN if Task 1's factoring preserved this path —
   the test is the regression guard either way).
3. Implement: ensure the non-empty branch retains the existing
   `anchor.slice(0,7)` warn and merge-base ladder; only the empty-sentinel case is
   diverted. No change to the fork-point → plain merge-base sequence or its results.
4. Verify GREEN.
5. Commit: "test(engine): guard non-empty unreachable-anchor warn + unchanged fallback (#510)"

**Files:**
- src/conductor/src/engine/autoheal.ts
- src/conductor/test/engine/autoheal.test.ts

**Dependencies:** 1

### Task 4: Whitespace-only anchor + fail-closed regression coverage
**Story:** Story 2 (whitespace-only treated as absent); Story 3 (fail-closed unchanged)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) `getEvidenceRange(root, '   ')` is treated as absent —
   no `unreachable` warning, range = `<merge-base>..HEAD`; (b) with an UNRESOLVABLE
   origin default (no origin/HEAD, no origin/main, no origin/master) and an absent
   anchor, `getEvidenceRange` fails closed: zero commits + exactly one anomaly,
   exactly as today.
2. Verify RED.
3. Implement: confirm `anchor.trim() === ''` from Task 1 covers whitespace; confirm
   the absent branch still funnels through `resolveOriginRef`/fail-closed (the
   `if (!originRef)` return at `autoheal.ts:359` and the `if (!lowerBound)` return at
   `autoheal.ts:403` remain reachable for the absent path).
4. Verify GREEN.
5. Commit: "test(engine): whitespace-anchor-as-absent + fail-closed absent-anchor guards (#510)"

**Files:**
- src/conductor/src/engine/autoheal.ts
- src/conductor/test/engine/autoheal.test.ts

**Dependencies:** 1

### Task 5: End-to-end gate-path assertion + CHANGELOG
**Story:** Story 2 Done When 3 (production gate path emits zero `unreachable` lines)
**Type:** infrastructure

**Steps:**
1. Write failing test: drive the no-anchor gate form `deriveCompletion(root, planPath)`
   (the real production entry, no anchor arg) against a repo with branch commits and a
   `Task:`-trailered commit; assert the completion map is unchanged from the current
   behavior AND that no `unreachable` line is produced during the call (spy on
   `console.warn` / assert the returned range's warnings). This proves the fix reaches
   the actual production callers (`conductor.ts:1889`, `artifacts.ts:718`,
   `evidence-cli.ts:267/391`), not just the unit seam.
2. Verify RED/GREEN.
3. Add a `## [Unreleased]` → `### Fixed` CHANGELOG entry: absent evidence anchor no
   longer logs a spurious `anchor  is unreachable` warning; distinct "no recorded
   anchor" line; fallback results unchanged (#510).
4. Run the focused suite: `cd src/conductor && npx vitest run test/engine/autoheal.test.ts`.
5. Commit: "test(engine): gate path derives with zero unreachable warns; CHANGELOG (#510)"

**Files:**
- src/conductor/test/engine/autoheal.test.ts
- CHANGELOG.md

**Dependencies:** 1, 2

## Task Dependency Graph

```
T1 ──▶ T2 ──▶ T5
 │
 ├──▶ T3
 └──▶ T4
```

**Dependencies:** T2→T1; T3→T1; T4→T1; T5→T1,T2. Acyclic.

## Verification

- `cd src/conductor && npx vitest run test/engine/autoheal.test.ts` green, including
  the new absent-anchor, whitespace, non-empty-unreachable, fail-closed, and
  gate-path cases.
- Behavioral diff: for a reachable anchor and for a non-empty unreachable anchor, the
  derived range and commit set are byte-identical to pre-fix output (Stories 1 & 3).
- Grep proof: after the fix, a full `deriveCompletion` gate walk produces zero lines
  matching `anchor .* is unreachable` (intake outcome 1); an absent anchor produces
  one `no recorded anchor` line with no empty-value rendering (intake outcome 2).
- `test/test_harness_integrity.sh` green (repo integrity, CHANGELOG `[Unreleased]`
  present).

## Coverage Mapping

| Story | Acceptance focus | Tasks |
|-------|------------------|-------|
| Story 1 — present reachable anchor → `anchor..HEAD`, no warn | reachable-rung unchanged, zero warnings | T1 |
| Story 2 — absent anchor → branch base, distinct "no recorded anchor", no `unreachable` | probe skipped, info-line, whitespace-as-absent, gate-path e2e | T1, T2, T4, T5 |
| Story 3 — non-empty unreachable SHA still falls back naming the SHA; fail-closed unchanged | negative-path warn verbatim, unchanged results, fail-closed | T3, T4 |
