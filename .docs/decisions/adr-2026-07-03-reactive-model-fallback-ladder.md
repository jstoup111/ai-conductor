# ADR: Reactive model fallback ladder in the invocation seam

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session (intake jstoup111/ai-conductor#186)

## Context

The conductor passes resolved model names as unvalidated strings to `claude --model`
(`src/conductor/src/execution/claude-provider.ts` `buildArgs`). When a configured model is
unavailable on a machine/subscription (Fable not yet enabled, a typo'd name), every
invocation fails identically, the step burns its full `max_retries` budget, and the daemon
HALTs. Model availability is a per-machine/per-subscription runtime property — it cannot be
validated statically.

`ClaudeProvider.invoke()` already pattern-detects two failure classes from captured output
(`rateLimited`, `sessionExpired`) that callers handle specially — including a
retry-without-burning-budget path for `sessionExpired`. Token burn is a first-class concern
in this harness (HARNESS.md optimization targets), so any solution that adds cost to the
happy path needs strong justification.

## Options Considered

### Option A: Reactive ladder — the failed invocation is the probe (chosen)
- **Pros:** Zero happy-path cost (no extra API calls when the configured model works —
  the overwhelmingly common case); catches unavailability wherever it surfaces (CLI arg
  rejection or first API call); reuses the established detection-flag pattern; fails fast
  (model rejection happens before the step does any work).
- **Cons:** First invocation on a dead model spawns one doomed subprocess per process
  lifetime; "probe" semantics are lazy rather than literal.

### Option B: Literal upfront probe per model per process
- **Pros:** Step never starts on a bad model; matches issue #186's text word-for-word.
- **Cons:** Costs a real API call per unique model per process even when everything works;
  a passing probe can still be followed by a failing real call moments later, so reactive
  handling is required anyway — double machinery for no added guarantee.

### Option C: Static known-models validation
- **Cons:** Wrong failure model — the risk is subscription/machine availability, not name
  validity; a maintained table goes stale. Rejected outright.

## Decision

**Option A.** Concretely:

1. **Detection:** `InvokeResult` gains a third detected-failure flag, `modelUnavailable`,
   set by `ClaudeProvider.invoke()` when subprocess output matches a narrow
   model-unavailable signature (e.g. "model not found" / "invalid model" / API
   `not_found_error` naming the model). The regex must be anchored to known CLI/API error
   shapes — a loose match would silently downgrade on unrelated failures.
2. **Ladder + cache:** a new `engine/model-availability.ts` holds a per-process cache
   (model string → dead) and the ladder walk. The ladder is configurable via a top-level
   `model_fallback_ladder` key in `.ai-conductor/config.yml`; default
   `['fable', 'opus', 'sonnet']`. Models are opaque strings (aliases and full IDs both
   pass through; cache keys are exact strings). An empty ladder is valid and means "no
   fallback" — failures surface unchanged.
3. **Walk semantics:** the walk happens **inside one step attempt** at the step-runner
   seam (`runAutonomous`). On `modelUnavailable`: mark the model dead, pick the next
   ladder entry not already dead (starting after the failed model's ladder position; a
   configured model not on the ladder falls to the ladder's first live entry), log the
   downgrade loudly, re-invoke. Ladder exhausted → return the last failure to the normal
   retry/HALT machinery. `conductor.ts` retry logic is untouched; the retry budget is
   structurally incapable of being consumed by downgrades.
4. **Pre-invoke consult:** both `invoke()` and `invokeInteractive()` call sites consult
   the cache first, substituting the first live ladder model when the resolved model is
   already marked dead — so interactive/collaborative steps benefit from earlier
   detection even though their inherited-stdio contract prevents reactive detection.
5. **Loud downgrade log:** every substitution and every reactive downgrade emits a
   warning carrying configured model, actual model, and reason — visible in step output
   (hence daemon.log). Silent downgrades would hide that a gate ran on a weaker model
   than configured.
6. **Cache lifetime:** process lifetime; restart clears it (re-probe by first use).

## Consequences

### Positive
- An unavailable configured model degrades in-attempt instead of HALTing the daemon.
- Zero token/latency cost when configuration is healthy.
- Prerequisite for the Fable rollout (#186–#194) lands without touching retry semantics.

### Negative
- Detection-regex maintenance: if the CLI's error text changes, detection silently stops
  working and the old burn-retries-then-HALT behavior returns (fail-safe direction, but
  the protection quietly lapses).
- Interactive REPL invocations get no reactive detection (inherited stdio) — only the
  pre-invoke cache consult.
- A transient availability blip marks a model dead for the whole process lifetime; a
  long-running daemon stays downgraded until restart. Accepted per issue #186; the loud
  log is the mitigation.

### Follow-up Actions
- [ ] Negative-path tests: unavailable model at every ladder position; fully empty
      ladder; configured model absent from the ladder; regex non-match on ordinary
      failures (no false downgrade).
- [ ] README + HARNESS.md (Model Selection) note the fallback behavior; CHANGELOG entry.
