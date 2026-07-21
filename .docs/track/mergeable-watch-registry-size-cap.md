# Track: cap the mergeable-watch registry size (bounded growth)

Track: technical

## Why technical

This is a bounded-growth hardening of an internal engine module
(`mergeable-sweep.ts`'s watch registry). No user-facing product surface, no PRD-worthy
behavior — the acceptance criteria are mechanical (cap the registry to a max count,
log every drop, stay best-effort/non-blocking). Acceptance criteria live in the
stories, not a PRD.

## Context (verified against `main`)

The per-repo mergeable watch registry `.daemon/mergeable-watch.jsonl` self-prunes only
on merged/closed/gone PRs. A `done` feature whose PR is never merged accrues an entry
indefinitely, and each tracked PR costs one `gh pr view` per sweep tick. Bounded in
practice (solo-dev daemon) but unbounded in principle.

Verified structure in `src/conductor/src/engine/mergeable-sweep.ts`:

- `WatchEntry` interface (lines 64–72): `prUrl`, `slug`, `repoCwd` (required),
  `resolveAttempts?`, `lastResolveAt?`, `ciFixAttempts?`, `lastCiFixAt?` (optional).
- `enrollWatch` (lines 82–89) appends `JSON.stringify(entry)` and stamps **no**
  enrollment timestamp.
- `sweepMergeableLabels` (lines 237–512) builds a `survivors` array, prunes
  merged/closed/gone (lines 265–272, secondary re-check 311–323), then
  `rewriteWatch(projectRoot, survivors)` at line 507.
- Drops are logged via the injected `log?: (msg) => void` callback (`SweepOpts.log`,
  line 223), convention `[mergeable-sweep] pruning …` (line 270).

**Scoping decision (max-COUNT, not max-AGE):** `WatchEntry` has **no enrollment
timestamp** — the only date fields (`lastResolveAt`, `lastCiFixAt`) are *activity*
timestamps, absent for exactly the "done PR never merged, no dispatch" entries this
issue targets. A max-AGE cap keyed on enrollment time would therefore require adding an
`addedAt` field to the schema, stamping it in `enrollWatch`, normalizing it in
`readWatch`, and touching every `enrollWatch` call site — a rippling change that pushes
the work to Medium. A **max-COUNT** cap needs no schema change (it trims `survivors` by
length), stays in one module, and delivers the bounded-growth guarantee. This spec is
scoped to max-COUNT; max-AGE is deferred as a follow-up.

The deferral this closes is recorded in `.docs/decisions/adr-015-daemon-pr-labeling-sweep.md:90`:
"(Optional, deferred) cap registry age/size if it grows unexpectedly — log any drop."
(The issue text says "ADR-014"; that is a mis-reference — ADR-014 is the OTel exporter.
The cap deferral lives in ADR-015.)

## Approaches considered

1. **Max-COUNT cap over `survivors` before `rewriteWatch`, logging each drop
   (chosen).** After the per-entry prune loop and before `rewriteWatch` (line 507),
   if `survivors.length` exceeds a configured max, drop the excess (oldest by file
   order — the JSONL is append-ordered, so the front entries are the oldest enrolled),
   logging each drop via `log?.('[mergeable-sweep] …')`. No schema change, no
   `enrollWatch` ripple, best-effort/non-blocking (a `rewriteWatch` failure is already
   swallowed).

2. **Max-AGE cap keyed on enrollment time.** Rejected for this tier: requires an
   `addedAt` schema addition + stamping + normalization + call-site ripple → Medium.
   `lastResolveAt`/`lastCiFixAt` cannot substitute (absent for the target entries).

3. **No cap; rely on merged/closed/gone self-prune.** Rejected: that is the status quo
   the issue is closing — an unmerged `done` PR is never gone, so it never self-prunes.

Decision: **Approach 1** (max-COUNT, log each drop). Max-AGE noted as a follow-up.
