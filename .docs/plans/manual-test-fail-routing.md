# Implementation Plan: manual-test-fail-routing (ai-conductor#367)

**Date:** 2026-07-06 · **Track:** technical · **Tier:** M
**ADR:** adr-2026-07-06-manual-test-fail-routing.md (APPROVED)
**Stories:** .docs/stories/manual-test-fail-routing.md
**Conflicts:** .docs/conflicts/2026-07-06-manual-test-fail-routing.md (no blocking)

## Summary
Close both manual_test false-ship paths (retry whitewash + advisory auto-skip): flip
manual_test to gating (locked), add a deterministic daemon kickback manual_test→build
carrying FAIL evidence, add a HEAD-sha fix-evidence guard to the completion gate behind an
injectable seam, and make results append-only per attempt. ~10 tasks.

## Tasks

### Task 1: Flip manual_test to gating (Story 1)
RED: topology test asserting `getStepDefinition('manual_test').enforcement === 'gating'` and
`isGatingStep('manual_test')`; assert the auto-mode advisory-skip branch no longer swallows a
manual_test failure (conductor unit test: auto non-daemon, retries exhaust → HALT not skip).
GREEN: `steps.ts:144` `'advisory'` → `'gating'`.
Files: `src/engine/steps.ts`, `test/engine/steps.test.ts` (or equivalent), `test/engine/conductor.test.ts`.

### Task 2: Lock manual_test enforcement (Story 2)
RED: skill-resolver test — project-local manual-test override with `enforcement: advisory`
resolves to `gating`.
GREEN: add `'manual_test'` to `ENFORCEMENT_LOCKED_STEPS` (`skill-resolver.ts:17`).
Also: config test asserting `disabled` manual_test now errors (should already hold via
`config.ts:401` once Task 1 lands — pin it).

### Task 3: `getHeadSha` seam (Story 5)
RED: artifacts test driving the manual_test gate with an injected `getHeadSha`.
GREEN: add optional `getHeadSha?: () => Promise<string | null>` to `CompletionContext`
(`artifacts.ts:245`); wire production impl (execFile `git rev-parse HEAD`, cwd projectRoot,
null on any error) where the conductor builds completion ctx (`conductor.ts:1282-1286` and
the tail's `advanceTail` ctx if separate — grep all `checkStepCompletion` call sites).

### Task 4: Fix-evidence whitewash guard (Story 4)
RED: gate unit tests — FAIL observed writes `.pipeline/manual-test-fail-evidence.json` with
sha+excerpt; FAIL-free + unchanged sha → not-done naming the guard; FAIL-free + moved sha →
done + marker cleared; marker older than session ignored+cleaned; no seam/null sha →
pre-change behavior.
GREEN: extend the `manual_test` predicate (`artifacts.ts:467-491`).

### Task 5: Latest-attempt parsing (Story 6, gate half)
RED: gate tests — attempt-1 FAIL + attempt-2 clean evaluates clean; latest-attempt FAIL
fails; sectionless file scans whole content (back-compat).
GREEN: parse `^## Attempt \d+` sections; evaluate FAIL regex on the last section when
sections exist.

### Task 6: Skill contract — append-only attempts (Story 6 skill half)
Update `skills/manual-test/SKILL.md`: attempts append `## Attempt N — <ISO timestamp>`
sections (never overwrite); document the whitewash guard (a FAIL→PASS flip requires the fix
commits to exist) and the daemon kickback expectation. Keep frontmatter `enforcement: gating`.

### Task 7: Daemon kickback manual_test→build (Story 3)
RED: conductor unit tests — daemon manual_test retries-exhausted with FAIL rows → kickback
event(from manual_test,to build), build re-opened with hint containing FAIL rows, manual_test
restaged stale, loop continues; budget exhausted → HALT naming budget; non-FAIL gate miss
(missing/stale file) → HALT, no kickback; non-daemon → no kickback.
GREEN: in the auto-mode failure block (`conductor.ts` ~1425, beside the prd_audit hook), add
`this.daemon && step.name === 'manual_test'` branch: read results file, extract FAIL rows;
if present and `manualTestSelfHeals < MAX_KICKBACKS_PER_GATE`, mirror the prd_audit fallback
(emit kickback, `pendingRetryHints.set('build', …FAIL rows…)`, `navigateBack`, restage
manual_test `'stale'`, `i = nav.index - 1; continue`); else fall through to HALT.

### Task 8: End-to-end gate-loop spec (Stories 3+4 integration; #302-hazard guard)
Integration test in `test/integration/gate-loop.test.ts`: scripted runner where build ships
a "bug", manual_test attempt records FAIL, kickback re-enters build which commits a fix
(moves HEAD), manual_test re-runs clean → run converges DONE; assert
`.pipeline/task-status.json` present before/after the kickback navigation (conflict
mitigation — assert convergence, not file internals); whitewash variant: clean rewrite with
no commit → gate refuses → retries exhaust → HALT.

### Task 9: Docs (Story 7)
README.md: "Daemon manual-test routing" beside the prd-audit routing section.
`src/conductor/README.md`: gate contract (fresh + latest-attempt FAIL-free + fix evidence),
kickback route, locked enforcement. CHANGELOG `[Unreleased]`: Fixed (whitewash + auto-skip)
/ Changed (gating flip) + `## Migration` note: remove any `steps.manual_test.disabled` from
project config (now a validation error).

### Task 10: Validation
Full `npx vitest run` green; `npx tsc --noEmit` no NEW errors (9 pre-existing on main);
`bash test/test_harness_integrity.sh` green; `conduct-ts render-diagrams --check` green.

## Story→Task coverage
S1→T1(+T7 negative), S2→T2, S3→T7+T8, S4→T4+T8, S5→T3, S6→T5+T6, S7→T9.

## Prerequisites
Worktree `.worktrees/manual-test-fail-routing` on `feat/manual-test-fail-routing`
(origin/main @ 022f156a, includes #365). `npm install` needed in `src/conductor` before
vitest. VERSION stays 0.99.19 (frozen until 1.0 per operator rule) — no bump in this PR.
