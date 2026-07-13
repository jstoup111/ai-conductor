# Operator park blocks every dispatch entry point — backlog scan included (#651)

Status: Accepted

## Context

The operator-park marker (`.daemon/parked/<slug>`) is an emergency-stop: while present, no dispatch path
may start that slug. The re-kick sweep (`daemon-rekick.ts:114-130`) and re-kick resume
(`daemon-cli.ts:822-847`) check `isOperatorParked` FIRST, immediately before acting. The pool
fresh-dispatch path does not: its only park check is at *selection* (`pickEligible`, `daemon.ts:137`,
called from `daemon.ts:856`/`:875`), while the actual start — `dispatch(next)` (`daemon.ts:896`) →
`deps.runFeature(item)` (`daemon.ts:652`) — has none, and is separated from selection by
`await rebuildAndMaybeRestartForStaleEngine()` (`daemon.ts:890`). A park marker written into the main-repo
store in that window is dispatched anyway (2026-07-13 20:43Z incident,
`rebase-orphans-every-sha-anchored-evidence-citatio`).

Fix: `guardedDispatch(item)` awaits the single-source park predicate (`deps.isParked`, wired to
`isOperatorParked(projectRoot, …)`) immediately before `runFeature`; a parked slug is skipped, logged, and
never started. Intake: jstoup111/ai-conductor#651.

## Story 1 — the pool never starts a parked slug, even when parked after selection

As the daemon pool, when a slug carries a live operator-park marker at start time, I must not call
`runFeature` for it — even if the marker appeared after `pickEligible` selected it.

### Happy Path — unparked slug dispatches normally

- **Given** the pool selects an eligible slug `S` and `deps.isParked(S)` returns `false` at both
  selection and immediately before dispatch,
- **When** `guardedDispatch(S)` runs,
- **Then** it delegates to the existing `dispatch` body, `deps.runFeature(S)` is called exactly once, and
  `S` is added to `started`.

### Negative Path — marker written in the selection→dispatch window (the race)

- **Given** `deps.isParked(S)` returns `false` when `pickEligible` selects `S`, but returns `true` when
  `guardedDispatch(S)` re-checks immediately before dispatch (an operator wrote `.daemon/parked/S` during
  the intervening `rebuildAndMaybeRestartForStaleEngine` await),
- **When** `guardedDispatch(S)` runs,
- **Then** `deps.runFeature(S)` is **never** called, `S` is not added to `started`, and one log line names
  the marker path (`.daemon/parked/S`).

## Story 2 — a slug parked before selection is never started

As the pool, a slug already parked when the scan runs must be skipped and stay skipped.

### Happy Path

- **Given** `deps.isParked(S)` returns `true` at selection time,
- **When** `pickEligible` evaluates the backlog,
- **Then** `S` is skipped at selection (`daemon.ts:137`) and never reaches `guardedDispatch`; `runFeature`
  is not called for `S`.

### Negative Path — even if selection is bypassed, dispatch still blocks

- **Given** `S` reaches `guardedDispatch` directly (selection filter bypassed, simulating any future
  entry point) and `deps.isParked(S)` returns `true`,
- **When** `guardedDispatch(S)` runs,
- **Then** `runFeature` is never called — the immediately-before-dispatch check is authoritative, not the
  selection-time filter.

## Story 3 — every build-start entry point consults the same predicate (grep-enumerated)

As the regression suite, I mechanically enumerate every build-start call site so a new one cannot silently
skip the park check.

### Happy Path

- **Given** the set of build-start call sites derived by grepping the daemon source for `\.runFeature(`
  and the re-kick resume dispatch (`resumeRebaseFirst`),
- **When** the enumeration test runs,
- **Then** the derived set equals the known-guarded set {pool `guardedDispatch`, rekick sweep, rekick
  resume}, and each is asserted to be preceded by an `isOperatorParked`/`deps.isParked` check.

### Negative Path — an unguarded new call site fails the test

- **Given** a hypothetical new `deps.runFeature(` call site outside `guardedDispatch` (simulated in the
  test fixture / asserted by the grep count),
- **When** the enumeration test runs,
- **Then** the test FAILS, forcing the new entry point to funnel through the shared predicate.

## Story 4 — behavior is unchanged when park is unwired

As the pure daemon core, absence of the park predicate must preserve today's behavior exactly.

### Happy Path

- **Given** `deps.isParked` is `undefined` (pure-core default / legacy),
- **When** `guardedDispatch(S)` runs for an eligible `S`,
- **Then** it delegates straight to `dispatch` and `runFeature(S)` is called — byte-for-byte the
  pre-change loop.

### Negative Path — predicate error fails closed (toward the emergency-stop)

- **Given** `deps.isParked(S)` throws,
- **When** `guardedDispatch(S)` runs,
- **Then** the slug is treated as parked, `runFeature` is not called, and the anomaly is logged — an
  emergency-stop must not be defeated by a read error (mirrors `isOperatorParked`'s own fail-toward-parked
  contract).
