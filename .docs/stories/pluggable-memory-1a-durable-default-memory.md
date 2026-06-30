**Status:** Accepted

# Stories: Pluggable Memory — Slice 1a (Durable Default Memory)

**Umbrella:** `pluggable-memory.md` · **PRD:** `.docs/specs/2026-06-29-pluggable-memory-source.md`
**ADRs:** 015 (kind + `local` provider), 016 (selection — default path), 017 (store + symlink),
020 (migration), + FR-3 invariant (C6).

**Scope of 1a:** establish the `memory_provider` model with `local` as the built-in default, relocate
the default store to a durable, shared, branch-independent canonical store (`.memory/` → symlink),
migrate existing memory safely, and lock the FR-3 invariant — **with no behavior change** for
existing users. The *pluggable surface* (adopting external platforms, per-provider guidance,
write-fallback/reconcile) is slice **1b**.

**Stories in 1a (full):** FR-3, FR-5, FR-8, FR-9, FR-11, FR-12.
**Stories in 1a (default-path subset; full behavior completed in 1b):** FR-1 (default selection +
per-project isolation + exactly-one), FR-2 (absent/malformed/unknown → default), FR-10 (existing
steps work under the **default** provider).

The story text for each FR is the umbrella file's corresponding section — not duplicated here to
avoid drift. This slice file is the **build scope contract**: the tasks in
`.docs/plans/2026-06-29-pluggable-memory-1a-durable-default-memory.md` must cover the criteria below.

## Coverage contract (criteria 1a must satisfy)

| FR | Criteria 1a owns | Deferred to 1b |
|----|------------------|----------------|
| FR-1 | No selection → `local` active; two projects independent; exactly one active; per-project, no cross-project leakage | A non-default platform being the active one |
| FR-2 | Absent/empty/malformed → `local` (clear note, no crash); unknown name → warn + `local` + run continues; bounded warning | Installed-but-unavailable → fallback (needs a non-default provider) |
| FR-3 | The harness contains **no** search/ranking/relevance/embedding logic (integrity check); recall is the agent reading and judging | — |
| FR-5 | Memory in worktree A visible in sibling B; survives A's removal; branch-independent one-set-per-project; concurrent dual-worktree writes both persist; worktree removal deletes no shared memory; cross-project writes isolated | — |
| FR-8 | Fresh project → `local` active, recall/persist work with no service, no network, no credentials | — |
| FR-9 | `local` exposes the same categories as today; recall returns the same relevant entries; no category/entry semantics lost | — |
| FR-10 | The memory step, a recall-using design step, and project setup all work under the **default** provider | Same behaviors under an **alternative** provider; switching providers |
| FR-11 | Migration preserves all entries; reversible (one-time); verify-failure makes no destructive change; interrupted re-run loses nothing; already-migrated is a no-op | — |
| FR-12 | New project uses `local` with no migration and no destructive memory action | — |

## Done When (slice 1a)

- [ ] A fresh project recalls/persists via `local` with zero setup (no service/network/creds).
- [ ] Memory written in one worktree is observable in a sibling; survives the writer's removal;
      concurrent writes both persist; cross-project writes stay isolated.
- [ ] Migrating an existing project preserves every entry and is reversible; verify-failure is
      non-destructive; a fresh project performs no migration.
- [ ] `local` behavior is byte-identical to today (categories + recall).
- [ ] The harness-integrity suite asserts no harness-side memory retrieval logic exists (FR-3).
- [ ] Existing memory-using steps work unchanged under `local`.
</content>
