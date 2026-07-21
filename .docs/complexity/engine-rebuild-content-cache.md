# Complexity: engine-rebuild-content-cache

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — one `.engine-source-key` sidecar file per version dir (mirrors the existing `.publish-incomplete` sentinel) |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None |
| Story count | 3 (happy: unchanged source skips build; negative: changed source rebuilds; negative: absent/corrupt cache rebuilds) |
| Files touched | `scripts/publish-engine.mjs`, `src/engine/engine-store.ts` (+ their tests) — all in one package |
| New runtime code | A pre-build source-key check inside the existing `publish()` flow + one small exported source-hash helper reusing the existing `computeContentStamp` pattern |

## Rationale

The fix lives entirely inside the one function that already owns the build/skip decision —
`publish()` in `scripts/publish-engine.mjs` — and the content-hashing helper it needs already
exists in `engine-store.ts` (`computeContentStamp` over a directory). The change is: compute a
key over the engine build **inputs** before invoking tsup, persist it as a sidecar alongside the
finalized version (the `.publish-incomplete` sentinel already sets the precedent for extra dotfiles
in a version dir), and short-circuit when the current version's recorded key matches. No new
models, no integrations, no auth, no state machine, no layout change; the existing post-build
output-SHA guard and the atomic finalize/flip stay exactly as they are.

- **Not L / not M:** no external services, no schema/config-format change, no new auth or
  lifecycle; a single-package change with ~3 stories. No cross-cutting seams to reconcile — the
  daemon, GC, and engine-identity paths are untouched (engine-identity hashes a single artifact
  file, not the version directory, so a sidecar dotfile is invisible to it).
- **Why still S despite the #625/#598 correctness sensitivity:** correctness is carried entirely by
  a conservative, fail-open key design (superset of tsup inputs; rebuild on any doubt), which is a
  design constraint on the same small change — not additional surface area. → **Small.**
  Architecture-diagram, architecture-review, and conflict-check are skipped for this tier.
