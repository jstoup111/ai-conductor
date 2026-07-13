# Complexity: Operator park blocks every dispatch entry point (#651)

Tier: S

## Rationale

Small. One deterministic mechanism (consult an existing predicate immediately before the existing
build-start primitive) at one seam, reusing a wired dep the engine already ships. No new store, no new
config, no cross-run state, no scheduler rewrite.

- **The predicate already exists and is already wired.** `isOperatorParked(root, slug)`
  (`park-marker.ts`) is the single source of truth; production already injects it as `deps.isParked`
  (`daemon-cli.ts:1176`) and `pickEligible` already calls it (`daemon.ts:137`). The work is *moving the
  final authoritative check* from selection time to immediately-before-dispatch, not building machinery.
- **One build-start primitive.** The pool's only build start is `deps.runFeature(item)` inside
  `dispatch` (`daemon.ts:652`). Guarding that one call — via an async `guardedDispatch` wrapper that
  awaits `deps.isParked` before delegating to the existing sync `dispatch` body — covers the whole pool
  path. The re-kick and re-kick-resume paths already check park first (`daemon-rekick.ts:118-130`,
  `daemon-cli.ts:825`), so no change there beyond the enumeration test asserting they stay guarded.
- **Additive and backward-compatible.** `deps.isParked` is optional in the pure core; absent → the guard
  is a no-op and behavior is byte-for-byte the pre-change loop (matches today's pure-core default where
  `isParked` is undefined). Production always wires it.
- **Regression surface is a grep-enumeration + a race test**, both unit-level against `daemon.ts`'s
  injected deps — no real fs/git.
- **Breaking-surface check:** no `bin/conduct` CLI, `settings.json` schema, hook wiring, or skill-symlink
  change. Plain `### Fixed`; no CHANGELOG Migration block.

Not M: no new step, no new store or persisted state, no scheduler/priority change, and the
completion-derivation / evidence core is untouched. The change is confined to `daemon.ts`'s dispatch
seam plus tests.

## Kill-switch (issue scope item 4) — omitted, justified

Park enforcement is a **safety invariant** (operator emergency-stop), not a behavior toggle. A config
that could DISABLE the check would reintroduce the exact hole this fixes — an operator emergency-stop
that can be silently turned off is not an emergency-stop. No repo precedent gates a *tightening of a
safety guard* behind an opt-in: the existing `pickEligible` park check (`daemon.ts:137`), the rekick
park check (`daemon-rekick.ts:118`), and halt-marker enforcement all ship unconditionally with no
kill-switch. The daemon-wide `.daemon/PAUSED` pause and `daemon park`/`unpark` CLI already give the
operator the only two levers that belong here (pause all, or unpark a specific slug). Omitting the
kill-switch is therefore the correct call, recorded in the ADR (D4).

## Orthogonality

Independent of #534/#486 (marker-store cwd/split — this spec reuses the existing `projectRoot` predicate
untouched) and of the in-flight custom-step framework (PR #603): if/when that lands a scheduler, its
build-start must funnel through `guardedDispatch`, and the grep-enumeration test (Task 3) fails loudly if
a new `runFeature`/build-start call site bypasses the guard. Only file overlap with concurrent specs is
`CHANGELOG.md` `[Unreleased]` (textual).
