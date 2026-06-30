# Implementation Plan: Pluggable Memory — Slice 1b (Provider Framework)

**Date:** 2026-06-29
**Design:** `.docs/specs/2026-06-29-pluggable-memory-source.md` (Phase 1 PRD)
**Stories:** `.docs/stories/pluggable-memory-1b-provider-framework.md`
**Umbrella stories:** `.docs/stories/pluggable-memory.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md` (APPROVED, C1–C8)
**ADRs (APPROVED):** adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration (non-default =
agent-queried MCP), adr-2026-06-29-per-project-memory-provider-selection (selection — non-default),
adr-2026-06-29-platform-adoption-and-removal-surface (`conduct memory add|remove|status`),
adr-2026-06-29-per-provider-retrieval-guidance-location (guidance-skill selection),
adr-2026-06-29-memory-resilience-write-fallback-and-reconcile (write-fallback + reconcile)
**Delivery split:** `.docs/decisions/2026-06-29-delivery-split-pluggable-memory.md`
**Conflict check:** Clean

> **Build-order dependency (READ FIRST).** This slice builds on **1a's landed code** — the
> `memory_provider` plugin kind (1a A1), the built-in `local` provider (1a A3), the
> `resolveMemoryProvider` resolver (1a A5–A9), and `src/conductor/src/engine/memory-store.ts`
> (1a A11–A16). **This branch is now reset onto landed 1a (`origin/main`), so those anchors resolve.**
> Anchors below that say "(from 1a)" reference code that is present on main.

## Summary

Slice 1b adds the *pluggable surface* on top of 1a: selecting/adopting/removing a **non-default**
memory platform, activating its agent-facing guidance, and best-effort **write-fallback + reconcile**
resilience — all exercised against a **test-double provider** (Phase 1 ships no concrete external
platform). 25 TDD tasks. Independently shippable as its own PR.

## Technical Approach

- **Non-default provider model (adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration):** a `memory_provider` manifest may declare an **MCP server**
  (+ optional `guidance` skill ref). 1a's `plugin-manifest.ts` already accepts the kind (A2); 1b loads
  such a manifest into an **agent-queried MCP-backed provider** distinct from the `local` file store.
  The harness only **selects, wires, and exposes** the MCP server — it performs **no** retrieval (FR-3
  stays locked by 1a's C6 integrity check).
- **Resolver — non-default branches (adr-2026-06-29-per-project-memory-provider-selection):** 1a's `resolveMemoryProvider` (in `config.ts`) built
  and tested the absent/empty/malformed/unknown/`local` branches. 1b completes and exercises the two
  remaining **explicit** branches (C3, no catch-all): *named + installed + available* → that provider;
  *named + installed + unavailable at run start* → warn + fall back to `local` + continue. Per-project,
  pure over its config arg (no cross-project leakage).
- **Adopt/remove/status CLI (adr-2026-06-29-platform-adoption-and-removal-surface, C7):** a new `conduct memory` command group in
  `src/conductor/src/cli.ts` (alongside `engineer`/`projects`/`land`), with `add <provider>`,
  `remove`, `status`. `add` writes `memory_provider` to `.ai-conductor/config.yml` and wires the MCP
  server **idempotently** via `claude mcp add` / `claude mcp get` (Serena is the reference shape).
  Credentials are **never** committed; missing creds → a notice, never a half-written config.
- **Guidance-skill selection (adr-2026-06-29-per-provider-retrieval-guidance-location):** the memory step resolves its guidance skill from the
  **active provider** by extending `skill-resolver.ts:62-92` (which already supports a per-step
  `config.steps.<name>.skill` override). Default provider → today's `skills/memory/SKILL.md`. Missing /
  incomplete guidance → **safe degrade to `local` semantics + warning** (Phase-1 minimal resolver; the
  `.harness/skills/<name>/` filesystem override is out of scope and not depended on).
- **Resilience (adr-2026-06-29-memory-resilience-write-fallback-and-reconcile, C2):** when the active platform is unavailable or rejects a write, the entry
  is persisted to the **`local` store** (1a's `recordMemoryEntry`) with an explicit
  **pending-reconcile tag**, plus a bounded warning — never lost, never aborts (FR-13/13a). On
  reconnect, a **one-directional, idempotent** reconcile pushes pending entries into the active
  platform; they are **not surfaced** from the active platform until reconciled (FR-13b).

New conductor modules: `src/conductor/src/engine/memory-adopt.ts` (CLI add/remove/status +
idempotent MCP wiring), `src/conductor/src/engine/memory-fallback.ts` (pending-reconcile tag + reconcile).
Test fixture: a configurable **test-double memory provider** under `src/conductor/test/`.

## Prerequisites

- **Rebase onto landed 1a first** (see build-order note). `tsc --noEmit` clean is a gate; harness
  integrity suite green before each commit. Adoption/CLI tests must **stub `claude mcp`** at the
  process boundary (never call a real MCP server or write real credentials). Resolver/fallback tests
  redirect `HOME` to a tmp dir and reuse 1a's store helpers.

## Tasks

### Task B0: Reusable test-double memory provider fixture
**Story:** 1b is built against a test double (no concrete platform in Phase 1) · **Type:** infrastructure
**Steps:** 1. Failing test: a `makeTestDoubleProvider()` fixture yields a `memory_provider` instance
whose availability, write-accept/reject, and reconnect state are togglable, with an in-memory entry log.
2. RED. 3. Implement the fixture. 4. GREEN. 5. Commit "test(memory): test-double memory provider fixture".
**Files:** `src/conductor/test/fixtures/test-double-provider.ts` (new); fixture self-test. **Deps:** A1 (from 1a).

### Task B1: A non-default `memory_provider` manifest loads as an MCP-backed provider
**Story:** FR-4 (non-default provider is agent-queried) — adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration · **Type:** happy-path
**Steps:** 1. Failing test: `loadManifestFromFile()` of a `memory_provider` manifest declaring an MCP
server (+ optional `guidance`) instantiates an agent-queried, MCP-backed provider (NOT the `local`
file store). 2. RED. 3. Add the non-default load path. 4. GREEN. 5. Commit "feat(memory): load non-default memory provider as MCP-backed".
**Files:** `src/conductor/src/engine/plugin-loader.ts`; `plugin-manifest.ts`; test. **Deps:** A1, A2 (from 1a), B0.

### Task B2: A registered non-default provider is discoverable via the registry
**Story:** FR-1 (a chosen alternative platform can be the active one) · **Type:** happy-path
**Steps:** 1. Failing test: after registering the test double, `registry.get('memory_provider', name)`
returns it and `list('memory_provider')` includes both `local` and the double. 2. RED. 3. Wire
registration. 4. GREEN. 5. Commit "feat(memory): register and list non-default memory providers".
**Files:** `src/conductor/src/engine/plugin-registry.ts` (if needed); test. **Deps:** B0, A3 (from 1a).

### Task B3: Resolver — named + installed + available → that provider, no warning
**Story:** FR-1 happy (chosen alternative active) · **Type:** happy-path
**Steps:** 1. Failing test: `resolveMemoryProvider({memory_provider: 'double'}, registry, ctx)` with an
available test double returns the **double** (not `local`), zero warnings. 2. RED. 3. Implement the
"named, installed, available (non-local)" branch. 4. GREEN. 5. Commit "feat(memory): resolve available non-default provider".
**Files:** `src/conductor/src/engine/config.ts` (extend `resolveMemoryProvider`); test. **Deps:** A5, A6 (from 1a), B0.

### Task B4: Resolver — installed but unavailable at run start → warn + `local` (C3)
**Story:** FR-2 negative (selected platform exists but unavailable → fallback) · **Type:** negative-path
**Steps:** 1. Failing test: an installed-but-unavailable double → returns `local` + exactly one clear
warning; run continues. 2. RED. 3. Implement the explicit "installed/unavailable" branch (no catch-all
`else`). 4. GREEN. 5. Commit "feat(memory): unavailable provider falls back to local with warning".
**Files:** `src/conductor/src/engine/config.ts`; test. **Deps:** B3.

### Task B5: Resolver — per-project, no cross-project leakage (non-default)
**Story:** FR-1 negative (resolves independently of other projects) · **Type:** negative-path
**Steps:** 1. Failing test: project A config → double, project B config → `local`; resolving one does
not change the other. 2. RED. 3. Confirm purity over the config arg. 4. GREEN. 5. Commit "test(memory): non-default selection is per-project".
**Files:** test. **Deps:** B3.

### Task B6: `conduct memory status` reports the active provider
**Story:** FR-7/operability (know the current platform) — adr-2026-06-29-platform-adoption-and-removal-surface · **Type:** happy-path
**Steps:** 1. Failing test: `conduct memory status` prints the active provider name and its source
(config vs default) for the project, via the resolver. 2. RED. 3. Add the `memory` command group +
`status`. 4. GREEN. 5. Commit "feat(memory): conduct memory status".
**Files:** `src/conductor/src/cli.ts`; `src/conductor/src/engine/memory-adopt.ts` (new); test. **Deps:** A5 (from 1a).

### Task B7: `conduct memory add <provider>` — adopt in one action (idempotent MCP wiring)
**Story:** FR-6 happy (adopt a platform in one action) · **Type:** happy-path
**Steps:** 1. Failing test (with `claude mcp` stubbed): `add double` writes `memory_provider: double` to
`.ai-conductor/config.yml` AND wires the MCP server via `claude mcp add`; other config keys untouched.
2. RED. 3. Implement `add` (config write + idempotent `claude mcp get`→`add`). 4. GREEN. 5. Commit "feat(memory): conduct memory add adopts a provider".
**Files:** `cli.ts`; `memory-adopt.ts`; test. **Deps:** B1, B6.

### Task B8: `add` is idempotent — re-add does not clobber or duplicate
**Story:** FR-6 (idempotent re-add; no clobber of existing config) · **Type:** negative-path
**Steps:** 1. Failing test: a second `add double` (MCP already present per stubbed `claude mcp get`) →
no-op, no duplicate MCP entry, config unchanged. 2. RED. 3. Guard via `claude mcp get`. 4. GREEN.
5. Commit "feat(memory): conduct memory add is idempotent".
**Files:** `memory-adopt.ts`; test. **Deps:** B7.

### Task B9: `add` with missing credentials → notice, not half-config
**Story:** FR-6 (missing-credentials notice, not half-config) · **Type:** negative-path
**Steps:** 1. Failing test: `add` when required creds are absent → a clear notice; the config is **not**
left half-written (atomic: fully adopted or not at all); credentials never written to a tracked file.
2. RED. 3. Implement pre-flight creds check + atomic apply. 4. GREEN. 5. Commit "feat(memory): conduct memory add reports missing credentials without half-config".
**Files:** `memory-adopt.ts`; test. **Deps:** B7.

### Task B10: Interrupted `add` re-runs cleanly
**Story:** FR-6 (interrupted add re-runs cleanly) · **Type:** negative-path
**Steps:** 1. Failing test: an `add` interrupted after config write but before MCP wiring → re-run
completes to a consistent adopted state (idempotent), no duplicate, no dangling half-state. 2. RED.
3. Ensure re-entrancy. 4. GREEN. 5. Commit "test(memory): interrupted add re-runs cleanly".
**Files:** `memory-adopt.ts`; test. **Deps:** B8, B9.

### Task B11: `conduct memory remove` → project returns to `local`
**Story:** FR-7 happy (remove/disable a platform) · **Type:** happy-path
**Steps:** 1. Failing test: `remove` clears `memory_provider` from `.ai-conductor/config.yml` (→ `local`
resolves) and unwires/leaves the MCP per adr-2026-06-29-platform-adoption-and-removal-surface; other config untouched. 2. RED. 3. Implement `remove`.
4. GREEN. 5. Commit "feat(memory): conduct memory remove returns project to local".
**Files:** `cli.ts`; `memory-adopt.ts`; test. **Deps:** B7.

### Task B12: `remove` is idempotent — re-remove is a no-op
**Story:** FR-7 (idempotent re-remove; other config untouched) · **Type:** negative-path
**Steps:** 1. Failing test: a second `remove` (already `local`) → no-op, no error, config unchanged.
2. RED. 3. Guard. 4. GREEN. 5. Commit "feat(memory): conduct memory remove is idempotent".
**Files:** `memory-adopt.ts`; test. **Deps:** B11.

### Task B13: Removed active provider → next run cleanly uses `local`, no dangling ref
**Story:** FR-7 negative (removed active provider → next run cleanly uses local) · **Type:** negative-path
**Steps:** 1. Failing test: after removing the active provider, the next `resolveMemoryProvider` returns
`local` with no error and no dangling MCP reference. 2. RED. 3. Confirm resolver + remove leave no stale
state. 4. GREEN. 5. Commit "test(memory): removed active provider resolves to local next run".
**Files:** test. **Deps:** B11, A5 (from 1a).

### Task B14: Guidance-skill selection follows the active provider
**Story:** FR-4 happy (provider's guidance in effect when active) — adr-2026-06-29-per-provider-retrieval-guidance-location · **Type:** happy-path
**Steps:** 1. Failing test: with the double active (its manifest names a `guidance` skill), the memory
step resolves THAT skill; with `local` active, it resolves `skills/memory/SKILL.md`. 2. RED. 3. Extend
`resolveSkill` to consult the active provider's guidance. 4. GREEN. 5. Commit "feat(memory): select guidance skill by active provider".
**Files:** `src/conductor/src/engine/skill-resolver.ts:62-92`; test. **Deps:** B1, A5 (from 1a).

### Task B15: Missing/incomplete guidance → safe degrade to `local` + warning
**Story:** FR-4 negative (missing guidance → defined safe degradation, not silent misbehavior) · **Type:** negative-path
**Steps:** 1. Failing test: active provider with absent/incomplete guidance → resolves `local` guidance
semantics + one warning (not silent, not crash). 2. RED. 3. Implement safe-degrade branch. 4. GREEN.
5. Commit "feat(memory): degrade to local guidance on missing provider guidance".
**Files:** `skill-resolver.ts`; test. **Deps:** B14.

### Task B16: Misconfigured/unavailable platform → warning + run completes (FR-13)
**Story:** FR-13 (never abort) · **Type:** negative-path
**Steps:** 1. Failing test: a run whose active platform is unavailable warns and **completes** (no throw
escapes to abort the run). 2. RED. 3. Wrap provider use in best-effort handling. 4. GREEN. 5. Commit "feat(memory): unavailable platform warns but never aborts the run".
**Files:** `src/conductor/src/engine/memory-fallback.ts` (new); test. **Deps:** B4.

### Task B17: Rejected write → saved to `local` with pending-reconcile tag (C2/FR-13a)
**Story:** FR-13a (rejected write → local store + pending-reconcile tag + warning; not lost) · **Type:** negative-path
**Steps:** 1. Failing test: when the active double rejects a write, the entry is persisted to the
`local` store (1a `recordMemoryEntry`) carrying an explicit **`pending-reconcile`** tag + a warning;
nothing is lost. 2. RED. 3. Implement the fallback sink. 4. GREEN. 5. Commit "feat(memory): write-fallback to local with pending-reconcile tag".
**Files:** `memory-fallback.ts`; `memory-store.ts` (tag support, from 1a); test. **Deps:** B0, A16 (from 1a).

### Task B18: Reconcile pending entries on reconnect — idempotent, one-directional (FR-13b)
**Story:** FR-13b (reconciled into active platform on reconnect; idempotent) · **Type:** negative-path
**Steps:** 1. Failing test: on reconnect, pending-reconcile entries are pushed into the active double
exactly once; re-running reconcile does not duplicate; reconcile never pulls FROM the platform
(one-directional). 2. RED. 3. Implement idempotent reconcile (tag-driven). 4. GREEN. 5. Commit "feat(memory): one-directional idempotent reconcile on reconnect".
**Files:** `memory-fallback.ts`; test. **Deps:** B17.

### Task B19: Pending entries not surfaced from the platform until reconciled (FR-13b)
**Story:** FR-13b (not surfaced from the active platform until reconcile) · **Type:** negative-path
**Steps:** 1. Failing test: before reconcile, a pending fallback entry is NOT returned as if it lived in
the active platform (no phantom read); after reconcile it is. 2. RED. 3. Keep pending entries
local-only until reconcile. 4. GREEN. 5. Commit "test(memory): pending fallback entries are not surfaced pre-reconcile".
**Files:** `memory-fallback.ts`; test. **Deps:** B17.

### Task B20: Bounded warnings under repeated failure; never aborts (FR-13b)
**Story:** FR-13b (bounded warnings under repeated failure) · **Type:** negative-path
**Steps:** 1. Failing test: repeated write failures in one run emit a bounded number of warnings
(≤1 / deduped) and never abort. 2. RED. 3. Per-run warning de-dup (reuse 1a A8 bounding). 4. GREEN.
5. Commit "feat(memory): bound write-fallback warnings per run".
**Files:** `memory-fallback.ts`; test. **Deps:** B17, A8 (from 1a).

### Task B21: Memory step / recall-using step / project setup work under the alternative provider
**Story:** FR-10 happy (behaviors under an alternative provider) · **Type:** happy-path
**Steps:** 1. Failing test: with the double active, the memory step + a recall-using step + project
setup operate through the active provider (recall = agent querying the MCP double; persist routes to
it). 2. RED. 3. Thread the active provider through these steps. 4. GREEN. 5. Commit "test(memory): steps operate under an alternative provider".
**Files:** test; step wiring as needed. **Deps:** B3, B14.

### Task B22: Switching providers breaks nothing; reads from the active source
**Story:** FR-10 negative (switching platforms breaks nothing) · **Type:** negative-path
**Steps:** 1. Failing test: `add A` → `remove` → `add B` leaves each run reading from the then-active
source; no stale wiring or lost recall across switches. 2. RED. 3. Confirm switch path is clean. 4. GREEN.
5. Commit "test(memory): switching providers reads from the active source".
**Files:** test. **Deps:** B7, B11.

### Task B23: Docs + CHANGELOG + Migration block (new CLI — C7)
**Story:** Docs-track-features; adr-2026-06-29-platform-adoption-and-removal-surface · **Type:** infrastructure
**Steps:** 1. Document `conduct memory add|remove|status`, non-default selection, guidance selection,
and write-fallback/reconcile in `README.md` + `src/conductor/README.md`; add a `## [Unreleased]`
CHANGELOG entry **and** a `## Migration` block for the new `conduct memory` CLI (C7). 2. Verify the
integrity suite's CHANGELOG/migration gates pass. 3. Commit "docs(memory): document provider framework + memory CLI; CHANGELOG migration block".
**Files:** `README.md`; `src/conductor/README.md`; `CHANGELOG.md`. **Deps:** B7, B11.

### Task B24: VERSION bump (operator-approved) + final integrity & test sweep
**Story:** Release Gate #4 — present semver before PR · **Type:** infrastructure
**Steps:** 1. Run `test/test_harness_integrity.sh` (expect all pass) + full `npm test` (all green).
2. Present the proposed VERSION bump (MINOR — new CLI + plugin behavior, additive) to the operator per
CLAUDE.md; do not edit VERSION until confirmed. 3. Commit only on approval.
**Files:** `VERSION` (on approval). **Deps:** all prior 1b tasks.

## Task Dependency Graph

```
A1,A2,A3,A5,A6,A8,A16 (from 1a) ─► everything below
B0 ─► B1, B2, B3, B17
B1 ─► B2(+A3), B7, B14
B3 ─► B4, B5, B16, B21 ; A5 ─► B3, B6, B13
B6 ─► B7 ─► B8, B9, B11 ; (B8,B9) ─► B10
B7 ─► B11 ─► B12, B13, B22
B14 ─► B15, B21 ; B1 ─► B14
B16 ; B17 ─► B18, B19, B20
B7,B11 ─► B23 ─► B24 ◄── (all)
```
Acyclic.

## Integration Points

- **After B7/B11:** end-to-end adopt → status → remove round-trip against a stubbed `claude mcp`.
- **After B14:** active provider drives both selection AND its guidance skill.
- **After B18–B20:** a full reject → fallback-to-local → reconnect → reconcile cycle is verified.
- **After B24:** 1b is independently shippable (pluggable surface complete on the 1a foundation).

## Next step

`/writing-system-tests` for 1b (failing acceptance specs from the 1b story slice) — **after** rebasing
this branch onto landed 1a — then `/pipeline`.

## Verification

- [x] Preconditions: 1b story slice + umbrella exist with happy+negative paths; conflict-check clean; ADRs APPROVED.
- [x] Every 1b criterion maps to ≥1 task (see Coverage Map).
- [x] Negative paths are explicit tasks (B4, B5, B8, B9, B10, B12, B13, B15, B16–B20, B22).
- [x] Dependencies declared and acyclic; tasks at 2–5 min granularity.
- [x] Conditions carried: C2 (B17), C3 (B4), C7 (B23). (C1/C4/C5/C6/C8 are 1a's.)
- [x] 25 tasks (< 40) — within single-plan scope.
- [x] Build-order dependency on 1a documented; rebase-before-pipeline called out.

## Coverage Map (1b criterion → task)

| FR (1b scope) | Happy-path | Negative-path |
|---|---|---|
| FR-1 (non-default) | B2, B3 | B5 (per-project, no leakage) |
| FR-2 (non-default) | — | B4 (unavailable→fallback), B16 (run completes) |
| FR-4 | B1, B14 | B15 (missing guidance → degrade) |
| FR-6 | B7 | B8 (idempotent), B9 (missing creds), B10 (interrupted) |
| FR-7 | B6, B11 | B12 (idempotent), B13 (removed active → local) |
| FR-10 (non-default) | B21 | B22 (switching) |
| FR-13 | — | B16 (warn + complete) |
| FR-13a | — | B17 (fallback + pending-reconcile tag) |
| FR-13b | — | B18 (reconcile), B19 (not surfaced pre-reconcile), B20 (bounded) |
