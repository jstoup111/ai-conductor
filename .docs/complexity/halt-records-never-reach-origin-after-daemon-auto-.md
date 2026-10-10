# Complexity: Halt records never reach origin after daemon auto-rebase

Tier: S

Source: jstoup111/ai-conductor#2891

## Rationale

One argument added at one existing seam. `publishHaltRecord` (`src/conductor/src/engine/halt-record.ts:184-208`) is the single push used by both the halt-record write and its supersede; adding `--force-with-lease` follows a precedent already shipped twice (`ship-draft-pr.ts:397`, `autoresolve.ts:772`) through the same guarded `executeRemoteGit` boundary, and the engine's `pre-push` guard already admits exactly this lease shape. Failure reporting (`pushFailed` → `halt_record_push_failed`) is unchanged. No new module, event, state, config, schema, CLI, or hook surface; the work is the argument plus real-git tests against a local bare remote.

## Not larger because

- No architecture change: ADR `adr-2026-08-23-committed-halt-record` decision 5 is amended (lease push) rather than replaced, and every other decision stands.
- No new failure surface: a stale lease is one more reason string on the existing pushFailed path.
