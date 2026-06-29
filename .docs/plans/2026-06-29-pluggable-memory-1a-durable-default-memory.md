# Implementation Plan: Pluggable Memory — Slice 1a (Durable Default Memory)

**Date:** 2026-06-29
**Design:** `.docs/specs/2026-06-29-pluggable-memory-source.md` (Phase 1 PRD)
**Stories:** `.docs/stories/pluggable-memory-1a-durable-default-memory.md`
**Umbrella stories:** `.docs/stories/pluggable-memory.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md` (APPROVED, C1–C8)
**ADRs (APPROVED):** 015 (kind + `local`), 016 (selection — default path), 017 (store + symlink), 020 (migration)
**Conflict check:** Clean

## Summary

Slice 1a establishes the `memory_provider` model with a built-in `local` provider, relocates the
default memory to a durable, shared, branch-independent canonical store (`.memory/` → symlink),
migrates existing memory safely and reversibly, and locks the FR-3 invariant via a harness-integrity
check — **with no behavior change** for existing users. 27 TDD tasks. Independently shippable as its
own PR; slice 1b (provider framework) builds on this foundation.

## Technical Approach

- **Model (ADR-015):** add `'memory_provider'` to `PluginKind`/`VALID_PLUGIN_KINDS`
  (`src/conductor/src/types/plugin.ts:13-19`); register a built-in `memory_provider:local` in
  `registerBuiltins()` (`src/conductor/src/engine/plugin-loader.ts:138-149`), mirroring
  `llm_provider:claude`/`ui_renderer:terminal`. `local` is a **real provider object, never a null
  case** (condition **C1**).
- **Selection — default path (ADR-016):** add `memory_provider?: string` to `HarnessConfig`
  (`src/conductor/src/types/config.ts:238-240`) and a **total** run-start resolver in
  `src/conductor/src/engine/config.ts`. In 1a the only installed provider is `local`, so the resolver
  exercises the **absent / empty / malformed / unknown-name → `local`** branches (explicit, no
  catch-all `else`; conditions **C1/C3**). The installed-but-unavailable branch is built minimally but
  fully exercised in 1b with the test-double. The resolved active provider is threaded onto run
  context at the existing provider-resolution point (`daemon-cli.ts:155`).
- **Store (ADR-017):** a branch/worktree-independent **project key**, a canonical store at
  `~/.ai-conductor/memory/<key>/harness/`, and `.memory/` as a **symlink** to it. `.memory/` stays
  gitignored (`.gitignore:5`); the session-start hook (`hooks/claude/session-start-context.sh`) and
  every existing reader keep working through the symlink unchanged. File-per-entry layout + a
  no-clobber `index.md` write protocol handle concurrent dual-worktree writes (conditions **C4/C8**).
- **Migration (ADR-020):** a detect→backup→copy→verify→swap path that converts an existing real
  `.memory/` into the symlink **non-destructively**, with union-into-existing-store and one-time
  reverse (condition **C5**). Fresh/empty/already-migrated → no-op (FR-12).
- **FR-3 invariant (C6):** a grep-based check in `test/test_harness_integrity.sh` asserts no memory
  search/ranking/relevance/embedding logic exists in the harness.

New conductor modules: `src/conductor/src/engine/memory-store.ts` (project key, store/symlink,
concurrent-write protocol) and `src/conductor/src/engine/memory-migrate.ts` (migration). Resolver
lives alongside `config.ts`.

## Prerequisites

- Work on `feat/pluggable-memory-source` (current worktree). `tsc` clean is a gate; integrity suite
  green before each commit. Store/migration tests redirect `HOME` to a tmp dir.

## Tasks

### Task A1: Add `memory_provider` to the plugin-kind union
**Story:** FR-1/FR-3 model — ADR-015 · **Type:** infrastructure
**Steps:** 1. Failing test: `VALID_PLUGIN_KINDS` includes `'memory_provider'`; `PluginKind` accepts it.
2. RED. 3. Add to the union + `VALID_PLUGIN_KINDS`. 4. GREEN. 5. Commit "feat(memory): add memory_provider plugin kind".
**Files:** `src/conductor/src/types/plugin.ts:13-19`; plugin type test. **Deps:** none.

### Task A2: A `memory_provider` plugin.yml validates and loads
**Story:** FR-4 self-describing unit (manifest surface) — ADR-015 · **Type:** happy-path
**Steps:** 1. Failing test: `loadManifestFromFile()` accepts `kind: memory_provider` with `entrypoint`
+ optional `guidance` skill ref. 2. RED. 3. `validateManifest()` accepts the kind + optional `guidance`.
4. GREEN. 5. Commit "feat(memory): accept memory_provider manifests".
**Files:** `src/conductor/src/engine/plugin-manifest.ts:31,91`; manifest test. **Deps:** A1.

### Task A3: Register built-in `memory_provider:local` (C1 — real provider)
**Story:** FR-8/FR-9 — ADR-015 · **Type:** happy-path
**Steps:** 1. Failing test: after `registerBuiltins()`, `registry.get('memory_provider','local')` returns
a real provider (not null). 2. RED. 3. Register `memory_provider:local` (no MCP/service/creds).
4. GREEN. 5. Commit "feat(memory): register built-in local memory provider".
**Files:** `src/conductor/src/engine/plugin-loader.ts:138-149`; loader test. **Deps:** A1.

### Task A4: Add `memory_provider?: string` to HarnessConfig
**Story:** FR-1 — ADR-016 · **Type:** infrastructure
**Steps:** 1. Failing test: config YAML with `memory_provider: local` parses into the field. 2. RED.
3. Add optional field mirroring `llm_provider`/`ui_renderer`. 4. GREEN. 5. Commit "feat(memory): add memory_provider config field".
**Files:** `src/conductor/src/types/config.ts:238-240`; config-load test. **Deps:** none.

### Task A5: Resolver — absent/empty/malformed → `local` (C1/C3)
**Story:** FR-1 happy (no choice → default), FR-2 negative (malformed → default) · **Type:** happy-path
**Steps:** 1. Failing test: `resolveMemoryProvider(config, registry)` returns the `local` provider as a
total value (no throw, ≤1 note) for undefined/`""`/non-string. 2. RED. 3. Implement the explicit
default branch (not a catch-all `else`). 4. GREEN. 5. Commit "feat(memory): resolve absent/malformed selection to local".
**Files:** `src/conductor/src/engine/config.ts` (new `resolveMemoryProvider`); resolver test. **Deps:** A3, A4.

### Task A6: Resolver — `local` selected & available → `local`, no warning
**Story:** FR-1 happy (chosen platform active), FR-2 happy (valid → no warning) · **Type:** happy-path
**Steps:** 1. Failing test: `memory_provider: local` → returns `local`, emits no warning. 2. RED.
3. Implement the "named, installed, available" branch (for `local`). 4. GREEN. 5. Commit "feat(memory): resolve valid local selection without warning".
**Files:** `src/conductor/src/engine/config.ts`; resolver test. **Deps:** A5.

### Task A7: Resolver — unknown provider name → warn + `local` (C3)
**Story:** FR-2 negative (names a platform that does not exist) · **Type:** negative-path
**Steps:** 1. Failing test: `memory_provider: nope` (not installed) → returns `local` + one clear
warning; continues. 2. RED. 3. Explicit "unknown" branch. 4. GREEN. 5. Commit "feat(memory): unknown provider falls back to local with warning".
**Files:** `src/conductor/src/engine/config.ts`; resolver test. **Deps:** A5.

### Task A8: Resolver warnings are bounded (one per run)
**Story:** FR-2/FR-13 negative (clear note, never crash; bounded) · **Type:** negative-path
**Steps:** 1. Failing test: repeated resolution in one run emits ≤1 bad-selection warning. 2. RED.
3. Per-run warning de-dup. 4. GREEN. 5. Commit "feat(memory): bound provider-resolution warnings per run".
**Files:** `src/conductor/src/engine/config.ts`; resolver test. **Deps:** A7.

### Task A9: Thread resolved active provider onto run context
**Story:** FR-10 (one active provider for all steps); FR-1 (exactly one active) · **Type:** infrastructure
**Steps:** 1. Failing test: run context exposes the resolved active provider, computed at run start
parallel to `llm_provider`. 2. RED. 3. Call `resolveMemoryProvider` where `llm_provider` is resolved
(`daemon-cli.ts:155` region) and carry the value on context. 4. GREEN. 5. Commit "feat(memory): expose resolved active memory provider on run context".
**Files:** `src/conductor/src/daemon-cli.ts:155`; context type; test. **Deps:** A5.

### Task A10: Per-project isolation of selection (no leakage)
**Story:** FR-1 negative (unrelated project unchanged) · **Type:** negative-path
**Steps:** 1. Failing test: two configs with different `memory_provider` resolve independently;
resolving one doesn't mutate the other. 2. RED. 3. Confirm resolver is pure over its config arg.
4. GREEN. 5. Commit "test(memory): provider selection is per-project, no leakage".
**Files:** resolver test. **Deps:** A6.

### Task A11: Project-key derivation is branch/worktree-independent (C4)
**Story:** FR-5 happy (one set per project, branch-independent) · **Type:** infrastructure
**Steps:** 1. Failing test: `projectKey()` returns the **same** key for two worktree paths of the same
project (different branches), from stable project identity (origin/main-repo), not branch/worktree
path. 2. RED. 3. Implement `projectKey()`. 4. GREEN. 5. Commit "feat(memory): branch-independent project key".
**Files:** `src/conductor/src/engine/memory-store.ts` (new); test. **Deps:** none.

### Task A12: Project-key cross-project isolation (C4 negative)
**Story:** FR-5 negative (different project's memory does not appear) · **Type:** negative-path
**Steps:** 1. Failing test: two **different** projects derive **different** keys → distinct canonical
dirs. 2. RED. 3. Ensure derivation distinguishes projects. 4. GREEN. 5. Commit "test(memory): cross-project key isolation".
**Files:** `memory-store.ts`; test. **Deps:** A11.

### Task A13: Ensure canonical store dir + `.memory/` symlink (fresh)
**Story:** FR-5 happy; FR-8 — ADR-017 · **Type:** happy-path
**Steps:** 1. Failing test: `ensureMemoryStore()` creates `~/.ai-conductor/memory/<key>/harness/`
(category subdirs + `index.md`) and makes `.memory/` a symlink to it; idempotent. 2. RED. 3. Implement.
4. GREEN. 5. Commit "feat(memory): canonical store + .memory symlink".
**Files:** `memory-store.ts`; test (HOME→tmp). **Deps:** A11.

### Task A14: Bootstrap/`bin/conduct` memory setup uses the symlink path
**Story:** FR-8/FR-10 — ADR-017 · **Type:** infrastructure
**Steps:** 1. Failing test: bootstrap memory creation invokes `ensureMemoryStore` (symlink), not a
plain in-tree dir; if real `.memory/` content exists, it defers to migration (A17) instead of creating.
2. RED. 3. Update the bootstrap memory-setup path (`bin/conduct:1082` region + `skills/bootstrap/SKILL.md`).
4. GREEN. 5. Commit "feat(memory): bootstrap creates canonical store + symlink".
**Files:** `bin/conduct`; `skills/bootstrap/SKILL.md`; test. **Deps:** A13, A17.

### Task A15: Worktree removal preserves the canonical store (C8/FR-5 negative)
**Story:** FR-5 negative (removal preserves; no shared memory deleted) · **Type:** negative-path
**Steps:** 1. Failing test: removing a worktree (unlinking its `.memory/` symlink) leaves the canonical
store + entries intact; a sibling still reads them. 2. RED. 3. Ensure removal only unlinks the symlink,
never `rm -rf` the target. 4. GREEN. 5. Commit "test(memory): worktree removal preserves shared store".
**Files:** `memory-store.ts` / worktree-removal path; test. **Deps:** A13.

### Task A16: Concurrent dual-worktree writes both persist; index no-clobber (C8)
**Story:** FR-5 negative (two worktrees write → both persist, no clobber) · **Type:** negative-path
**Steps:** 1. Failing test: two near-simultaneous writes from siblings produce two distinct entry files
**and** both index lines survive (file-per-entry + read-modify-write / per-entry index fragments).
2. RED. 3. Implement the no-clobber index write protocol. 4. GREEN. 5. Commit "feat(memory): no-clobber concurrent index write protocol".
**Files:** `memory-store.ts` (index write); concurrency test. **Deps:** A13.

### Task A17: Migration detect → no-op for fresh/empty/already-migrated (FR-12)
**Story:** FR-12 happy+negative; FR-11 negative (already-migrated → no-op) · **Type:** negative-path
**Steps:** 1. Failing test: `migrateMemory()` is a no-op when `.memory/` is absent, empty, or already a
symlink to the canonical store — **no** destructive action. 2. RED. 3. Implement detect step. 4. GREEN.
5. Commit "feat(memory): migration detect/skip for fresh and migrated projects".
**Files:** `src/conductor/src/engine/memory-migrate.ts` (new); test. **Deps:** A13.

### Task A18: Migration copy-verify-swap preserves all entries (FR-11)
**Story:** FR-11 happy (all preserved, reversible) · **Type:** happy-path
**Steps:** 1. Failing test: real `.memory/` with N entries → backup, copy into canonical store, verify
(count + per-file), swap `.memory/` to symlink — all N present/recallable; backup retained. 2. RED.
3. Implement detect→backup→copy→verify→swap. 4. GREEN. 5. Commit "feat(memory): copy-verify-swap migration".
**Files:** `memory-migrate.ts`; test. **Deps:** A17.

### Task A19: Migration aborts non-destructively on verify failure (C5/FR-11 negative)
**Story:** FR-11 negative (cannot preserve → NO destructive change) · **Type:** negative-path
**Steps:** 1. Failing test: forced verify failure → abort, restore original `.memory/`, no swap, no loss.
2. RED. 3. Implement abort-and-restore. 4. GREEN. 5. Commit "feat(memory): migration aborts and restores on verify failure".
**Files:** `memory-migrate.ts`; test. **Deps:** A18.

### Task A20: Interrupted migration re-run loses nothing (FR-11 negative)
**Story:** FR-11 negative (interrupted → re-run, no loss) · **Type:** negative-path
**Steps:** 1. Failing test: interruption after backup/before swap → re-run resumes (detect), completes,
loses no entry. 2. RED. 3. Ensure re-entrancy (backup persists; detect resumes). 4. GREEN. 5. Commit "test(memory): interrupted migration re-runs cleanly".
**Files:** `memory-migrate.ts`; test. **Deps:** A18.

### Task A21: Migration unions into an existing canonical store (FR-5/FR-11)
**Story:** FR-11 happy under ADR-017 shared store (sibling already migrated) · **Type:** negative-path
**Steps:** 1. Failing test: canonical store already holds sibling entries → migration **unions** (no
overwrite, no duplicate index lines) by entry filename/content. 2. RED. 3. Implement union/dedup rule.
4. GREEN. 5. Commit "feat(memory): migration unions into existing canonical store".
**Files:** `memory-migrate.ts`; test. **Deps:** A18, A16.

### Task A22: One-time reverse restores pre-migration state (FR-11)
**Story:** FR-11 negative (reverse restores prior state) · **Type:** negative-path
**Steps:** 1. Failing test: `migrateMemory({reverse:true})` restores the retained backup over the
symlink → project matches pre-migration state. 2. RED. 3. Implement one-time reverse. 4. GREEN.
5. Commit "feat(memory): one-time migration reverse".
**Files:** `memory-migrate.ts`; test. **Deps:** A18.

### Task A23: FR-3 invariant grep check in harness integrity suite (C6)
**Story:** FR-3 negative (no harness-side search/ranking/relevance/embedding) · **Type:** negative-path
**Steps:** 1. Add a new numbered section to `test/test_harness_integrity.sh` that greps the harness
(excluding tests/docs) for memory search/ranking/relevance/embedding logic and `assert`s none exists,
using the existing `assert`/counter framework. 2. Verify it passes now; prove it would fail by planting
a temporary match, then remove. 3. Commit "test(memory): integrity check asserts no harness-side retrieval logic (FR-3)".
**Files:** `test/test_harness_integrity.sh` (new section before release-artifacts). **Deps:** none.

### Task A24: Default parity — categories & recall unchanged (FR-9)
**Story:** FR-9 happy+negative (same categories; no semantics lost; same entries) · **Type:** negative-path
**Steps:** 1. Failing test: under `local`, the categories (`decisions/patterns/gotchas/context` +
`index.md`) and the read-and-judge recall match today's behavior (golden comparison). 2. RED. 3. Confirm
no behavior change from the relocation. 4. GREEN. 5. Commit "test(memory): default provider preserves today's experience".
**Files:** test; `skills/memory/SKILL.md` (one-line "this is the `local` provider's skill" note). **Deps:** A13.

### Task A25: Existing memory steps work under the default provider (FR-10)
**Story:** FR-10 happy (memory step / recall-using step / project setup under default) · **Type:** happy-path
**Steps:** 1. Failing test: the session-start hook + a recall-using step read through the resolved
active provider (`local` via the symlinked `.memory/`) without breakage. 2. RED. 3. Confirm hook/steps
consume the symlinked store transparently. 4. GREEN. 5. Commit "test(memory): existing steps work under default provider".
**Files:** `hooks/claude/session-start-context.sh` (only if surfacing provider name); test. **Deps:** A9, A13.

### Task A26: Docs + CHANGELOG (store relocation; config field)
**Story:** Docs-track-features; ADR-016/017 · **Type:** infrastructure
**Steps:** 1. Document the `memory_provider` config field and the canonical-store/symlink layout in
`README.md` and `src/conductor/README.md`; add a `## [Unreleased]` CHANGELOG entry and a `## Migration`
block (the `.memory/` relocation is an auto-applied migration for consumers — A17–A22). 2. Verify the
integrity suite's CHANGELOG/migration gates pass. 3. Commit "docs(memory): document default-store relocation + config field; CHANGELOG migration block".
**Files:** `README.md`; `src/conductor/README.md`; `CHANGELOG.md`. **Deps:** A4, A18.

### Task A27: VERSION bump (operator-approved) + final integrity sweep
**Story:** Release Gate #4 — present semver before PR · **Type:** infrastructure
**Steps:** 1. Run `test/test_harness_integrity.sh` (expect all pass). 2. Present the proposed VERSION
bump (MINOR — new plugin kind/config field/gate, additive) to the operator for approval per CLAUDE.md;
do not edit VERSION until confirmed. 3. Commit only on approval.
**Files:** `VERSION` (on approval). **Deps:** all prior 1a tasks.

## Task Dependency Graph

```
A1 ─► A2, A3
A3 ─► A5 ; A4 ─► A5 ─► A6 ─► A7 ─► A8 ; A5 ─► A9 ; A6 ─► A10
A11 ─► A12, A13
A13 ─► A14(+A17), A15, A16, A17 ─► A18 ─► A19, A20, A21(+A16), A22 ; A13 ─► A24, A25(+A9)
A23 [independent]
A4,A18 ─► A26 ─► A27 ◄── (all)
```
Acyclic.

## Integration Points

- **After A13:** smoke-test end-to-end — write in one worktree, read in a sibling via the symlink.
- **After A18–A22:** an existing project migrates (and reverses) safely, end-to-end.
- **After A23:** FR-3 invariant machine-verified — 1a is independently shippable (durable memory,
  parity, no behavior change).

## Next step

`/writing-system-tests` for 1a (failing acceptance specs from the 1a story slice), then `/pipeline`.
After 1a ships (its own PR), author the **1b** plan grounded in 1a's landed code, then build 1b.

## Verification

- [x] Preconditions: 1a story slice + umbrella exist with happy+negative paths; conflict-check clean; ADRs APPROVED.
- [x] Every 1a criterion maps to ≥1 task (see Coverage Map).
- [x] Negative paths are explicit tasks (A7, A8, A10, A12, A15, A16, A17, A19–A22, A23, A24).
- [x] Dependencies declared and acyclic; tasks at 2–5 min granularity.
- [x] Conditions carried: C1 (A3/A5), C3 (A5/A7), C4 (A11/A12), C5 (A18/A19/A22), C6 (A23), C8 (A15/A16).
- [x] 27 tasks (< 40) — within single-plan scope.

## Coverage Map (1a criterion → task)

| FR (1a scope) | Happy-path | Negative-path |
|---|---|---|
| FR-1 (default) | A5, A6, A9 | A7 (unknown→default), A10 (no leakage), A5 (no choice→default) |
| FR-2 (default) | A6 | A7 (unknown), A5 (malformed), A8 (bounded) |
| FR-3 | (agent-reads design) | A23 (integrity: no harness retrieval logic) |
| FR-5 | A13 | A12 (cross-project), A15 (removal preserves), A16 (concurrent no-clobber) |
| FR-8 | A3, A13 | A3 (`local` no MCP/creds) |
| FR-9 | A24 | A24 (no semantics lost; same entries) |
| FR-10 (default) | A25 | A25 (recall from active source) |
| FR-11 | A18, A22 | A19 (no destructive on fail), A20 (interrupted), A21 (union), A17 (already-migrated) |
| FR-12 | A17 | A17 (no destructive action) |
</content>
