# Remediation Plan: FR-6, FR-10, FR-11 Implementation Gaps

**Date:** 2026-07-03  
**Triggered by:** PRD audit (prd-audit.md) — 12 acceptance tests failing  
**Status:** PENDING

---

## Overview

Three functional requirements have impl-gap issues preventing the full acceptance test suite from passing:

- **FR-6** — WAITING announce warn-once not emitted on tested path (1 Flow B test failing)
- **FR-10** — `runMigration` orchestrator not implemented (6 Flow D tests failing)
- **FR-11** — Idempotent/additive path unreachable without orchestrator (5 Flow D tests failing)

All remediation routes to BUILD (code changes, no spec/design changes).

---

## Task Breakdown

### FR-6: WAITING Announcement Warn-Once

**Gap:** Announcement lives at the `localWorkSource` seam (`daemon-work-source.ts:128`), but the Flow B test exercises `discoverBacklog` directly, which never reaches that seam. Announcements must emit through `discoverBacklog`'s log callback.

**Solution:** Move announce logic into `discoverBacklog`, use a module-level per-projectRoot registry to track seen verdicts, emit exactly once per state change.

**Tasks:**
1. **rem2-fr6-1** — Add module-level per-projectRoot registry to `daemon-waiting-announce.ts`
2. **rem2-fr6-2** — Call announcer inside `discoverBacklog` after dependency gate
3. **rem2-fr6-3** — Remove duplicate instance announcer from `daemon-work-source.ts`
4. **rem2-fr6-4** — Remove/update tests; add unit coverage for registry function
5. **rem2-fr6-5** — Verify all tests pass (acceptance + unit)

**Files likely touched:**
- `src/engine/daemon-waiting-announce.ts`
- `src/engine/daemon-backlog.ts`
- `src/engine/daemon-work-source.ts`
- `test/engine/daemon-waiting-announce.test.ts`
- `test/engine/daemon-work-source.test.ts`

---

### FR-10: Migration Orchestrator (`runMigration`)

**Gap:** Primitives exist (`parseDependencyProse`, `createDependencyLinks`) and inline CLI handler exists, but no exported `runMigration` function. Acceptance test contract requires this function. Flow D tests cannot run.

**Solution:** Implement `runMigration(deps)` that:
- Orchestrates prose parsing per issue
- Builds proposal, manual-review lists
- Awaits confirm() gate before writing
- Returns summary (proposed, manualReview, created, alreadyPresent, failed)

**Tasks:**
1. **rem2-fr10-1** — Implement + export `runMigration` function
2. **rem2-fr10-2** — Widen task-list classification to catch umbrella checkbox lines
3. **rem2-fr10-3** — Refactor CLI handler to delegate to `runMigration`
4. **rem2-fr10-4** — Verify Flow D tests pass

**Files likely touched:**
- `src/engine/engineer/issue-dep-migration.ts`
- `src/engine/engineer-cli.ts`
- `test/engine/engineer/engineer-cli-migrate-deps.test.ts`

---

### FR-11: Migration Idempotency + Additive-Only Audit

**Gap:** Writer's gh argv (`--method POST` + `owner=/repo=/issue_number=`) and GET parser (requires `repository_url`) do not match acceptance test fake platform contract (`-X POST`, `-f issue=<full-ref>`, GET returns bare `[{number}]`). Idempotency/additive-only behavior unreachable.

**Solution:** 
- Align write argv to match test contract
- Tolerate GET entries without `repository_url`
- Update unit test fakes/assertions
- Add `failing` set to fake platform

**Tasks:**
1. **rem2-fr11-1** — Change write argv to test contract format
2. **rem2-fr11-2** — Handle missing `repository_url` in GET parser
3. **rem2-fr11-3** — Realign unit test fakes/assertions
4. **rem2-fr11-4** — Add `failing` capability to fake platform fixture
5. **rem2-fr11-5** — Verify all tests pass

**Files likely touched:**
- `src/engine/engineer/issue-dep-migration.ts`
- `test/engine/engineer/issue-dep-migration.test.ts`
- `test/acceptance/dependency-ordered-intake-and-dispatch.test.ts`

---

## Execution Order

**Batch 1 (FR-6):** rem2-fr6-1 → rem2-fr6-2 → rem2-fr6-3 → rem2-fr6-4 → rem2-fr6-5  
**Batch 2 (FR-10):** rem2-fr10-1 → rem2-fr10-2 → rem2-fr10-3 → rem2-fr10-4  
**Batch 3 (FR-11):** rem2-fr11-1 → rem2-fr11-2 → rem2-fr11-3 → rem2-fr11-4 → rem2-fr11-5

Tasks within each batch are sequential (file dependencies). No parallelism across batches until prior batch is green.

---

## Verification

**Green gate per batch:** Full acceptance test suite must pass:
```bash
cd src/conductor && npx vitest run test/acceptance/dependency-ordered-intake-and-dispatch.test.ts
```

**Per-task:** Unit test files for modified modules must pass:
- Batch 1: `test/engine/daemon-waiting-announce.test.ts`, `test/engine/daemon-work-source.test.ts`
- Batch 2: `test/engine/engineer/engineer-cli-migrate-deps.test.ts`
- Batch 3: `test/engine/engineer/issue-dep-migration.test.ts`

**Acceptance criteria:** 39/39 tests green (currently 27/39).
