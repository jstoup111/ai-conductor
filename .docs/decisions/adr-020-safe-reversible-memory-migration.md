# ADR 020: Safe, Reversible Migration of Existing Memory

**Date:** 2026-06-29
**Status:** DRAFT
**Deciders:** James (operator), Claude (architecture-review)

## Context

FR-11 requires moving an existing project to the new memory model to **preserve all existing memory
entries** and be **reversible** — where reversibility is a **one-time rollback to the pre-migration
state** (a safety net), not a perpetual two-way sync. If entries cannot first be safely preserved, the
move must make **no destructive change**. FR-12 requires a brand-new project to need **no migration**.
Open Question 4 asks *how an existing project's memory is migrated safely*.

The concrete change being migrated (ADR-017): today's in-tree `.memory/` (real directory, gitignored)
becomes a **symlink** to the canonical per-project store `~/.ai-conductor/memory/<key>/harness/`. The
risk is that turning a real directory into a symlink could destroy entries if done naively.

Forces:
- Migration must be **non-destructive on failure** (FR-11): never delete the original until the copy
  is verified complete.
- Migration must be **idempotent** (already-migrated → no-op) and **re-runnable after interruption**
  with no loss.
- Reversibility is **one-time rollback**, not ongoing sync — so a single pre-migration backup suffices.
- A fresh project has no `.memory/` real content → migration must **detect and skip** (FR-12).

## Options Considered

### Option A: Copy-verify-swap with a one-time pre-migration backup
- **How:**
  1. **Detect:** if `.memory/` is absent, empty, or already a symlink to the canonical store →
     **no-op** (covers fresh projects FR-12 and already-migrated FR-11).
  2. **Backup:** move the original real `.memory/` aside to a one-time rollback location
     (e.g. `.memory.pre-migrate.bak/`), or snapshot it, before any swap.
  3. **Copy:** copy all entries into the canonical store `~/.ai-conductor/memory/<key>/harness/`
     (merging if the canonical store already has entries from a sibling worktree — union, no overwrite).
  4. **Verify:** confirm every source entry exists in the canonical store (count + per-file check).
     **If verification fails → abort, restore the original, make no destructive change** (FR-11).
  5. **Swap:** only after verification, replace in-tree `.memory/` with a symlink to the canonical
     store.
  6. **Reverse (one-time):** restore `.memory.pre-migrate.bak/` over the symlink to return to the
     pre-migration state; ongoing memory thereafter accrues in the new model (FR-11).
- **Pros:** Non-destructive by construction (original kept until verified); idempotent (detect step);
  interrupt-safe (re-run resumes; backup persists); reversible once (the backup is the rollback).
- **Cons:** Temporary double storage during migration; backup must be retained until the operator is
  confident (cleanup is a separate, explicit step).

### Option B: In-place move (rename real dir into canonical, then symlink)
- **Cons:** A failure mid-move can leave entries split/lost; no clean rollback; violates
  "no destructive change on failure." Rejected.

### Option C: Lazy migration (migrate entries on first access)
- **Cons:** Spreads migration across runs, complicates reasoning about "all preserved," and makes
  reversibility ill-defined. Rejected.

## Decision

Adopt **Option A**: **copy-verify-swap with a one-time pre-migration backup**, gated by a detect step.

- **Detect → skip** for fresh/empty/already-migrated projects (FR-12, idempotent FR-11).
- **Preserve-before-destroy:** the original is backed up and the symlink swap happens **only after**
  the canonical copy is verified complete; a failed verify **aborts with no destructive change** and
  restores the original (FR-11).
- **Merge, don't overwrite:** if the canonical store already holds entries (e.g. a sibling worktree
  already migrated), the copy is a **union** — no entry is overwritten or lost (consistent with ADR-017
  shared store + FR-5).
- **Reverse = one-time rollback:** restoring the pre-migration backup returns the project to its prior
  state; after a successful migration, ongoing memory accrues in the new model only (FR-11, explicitly
  not a two-way sync).
- **Re-run safe:** an interrupted migration re-runs to completion (detect resumes from the current
  state; the backup persists), losing no entries.

Why: copy-verify-swap is the standard non-destructive migration shape and maps one-to-one onto FR-11's
"preserve all, no destructive change on failure, one-time reversible," while the detect step delivers
FR-12 and idempotency for free.

## Consequences

### Positive
- No memory can be lost: the original survives until a verified copy exists (FR-11).
- Idempotent and interrupt-safe; fresh projects skip entirely (FR-12).
- One-time rollback gives a clear safety net without perpetual-sync complexity.

### Negative
- Temporary double storage and a retained backup directory until explicit cleanup.
- Merge-on-existing-store needs a defined union/dedup rule (by entry filename/content) to avoid
  duplicate index lines.
- Operator must eventually clean up `.memory.pre-migrate.bak/` (a separate explicit step; not
  auto-deleted, to preserve reversibility).

### Follow-up Actions
- [ ] Implement detect → backup → copy → verify → swap, with abort-and-restore on verify failure.
- [ ] Define the union/dedup rule when the canonical store already has entries (ADR-017 / FR-5).
- [ ] Provide the one-time `reverse` operation (restore backup) and document that post-migration memory
      accrues only in the new model.
- [ ] Negative-path coverage: verify-failure makes no destructive change; interrupted re-run loses
      nothing; already-migrated is a no-op; fresh project performs no migration (FR-12).
- [ ] Wire migration into adoption/bootstrap so it triggers when an existing real `.memory/` is found
      (ADR-017, ADR-018), and document in `README.md`.
