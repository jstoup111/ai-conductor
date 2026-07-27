# Complexity: 2026-07-26-rebased-features-stale-protected-artifact-seal-976

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | Additive seal schema change — `version: 2` with a `rebaselines[]` lineage record; v1 seals must still read |
| External integrations | None new (one additional read-only `git merge-base --is-ancestor` / `git ls-tree` call) |
| Auth / permission surface | **Yes — this is a safety boundary.** The change introduces the first legitimate replacement of an existing seal; getting the predicate wrong silently disables a self-host guardrail |
| State machines | **Yes** — the seal lifecycle moves from create-once-immutable to create + conditionally-rebaseline, and gains a new interaction with the SHIP-phase `rebase` step |
| Story count | 4 (rebase-time rotation; resume-time recovery; real-mutation still blocks; observability) |
| Files touched | `protected-artifact-seal.ts` (core), `conductor.ts` (call site), `rebase.ts`/`rebase-translate.ts` (rotation hook), telemetry, ~4 test files, `docs/daemon-operations.md`, `CHANGELOG.md` |
| New runtime code | ~150 lines across one new exported predicate, one rotation path, and the lineage record |

## Rationale

This is not a one-predicate tweak. Three things push it above Small:

1. **It is a security-boundary relaxation.** The seal exists to stop a BUILD/SHIP agent from
   editing DECIDE artifacts. Any new path that replaces a seal is a potential bypass, so the
   permitted-rotation predicate needs to be argued explicitly and reviewed, not just implemented.
   An over-broad rule ("re-seal whenever verification fails") would defeat the boundary entirely.
2. **It spans two subsystems.** The seal module owns the predicate, but the trustworthy rotation
   trigger lives in the rebase path (`performRebase` → `translateAfterRebase`), which already
   rewrites sibling `.pipeline` state. Coordinating those without making the seal depend on the
   rebase module requires a deliberate seam.
3. **It changes a pinned invariant.** `protected-artifact-seal.test.ts` explicitly pins
   "reuses the original durable baseline instead of resealing a later commit". That test must be
   narrowed rather than deleted — same-history resealing stays forbidden — which is exactly the
   kind of distinction an architecture review exists to lock down.

Against that, the blast radius is bounded: no step topology change, no new dispatch, no config
key, no CLI surface, and the artifact stays gitignored per-worktree state.

→ **Medium.** Architecture-diagram, architecture-review (lightweight), conflict-check, and
coherence-check all run; nothing is skipped.
