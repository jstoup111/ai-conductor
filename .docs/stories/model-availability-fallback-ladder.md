**Status:** Accepted

# Stories: Model Availability Probe + Fallback Ladder

**Source:** intake jstoup111/ai-conductor#186 (technical track — no PRD)
**Design:** adr-2026-07-03-reactive-model-fallback-ladder (APPROVED)
**Tier:** M

---

## Story: Detect model-unavailable as a distinct failure class

**Requirement:** TS-1 (#186 — "probe availability"; ADR §Decision 1)

As the conductor engine, I want `ClaudeProvider.invoke()` to flag model-unavailable
failures distinctly so that callers can degrade instead of retrying identically.

### Acceptance Criteria

#### Happy Path
- Given a `claude` subprocess that exits non-zero with output matching a known
  model-unavailable signature (e.g. `model not found`, `invalid model`, an API
  `not_found_error` naming the requested model), when `invoke()` returns, then
  `InvokeResult.modelUnavailable` is `true` and `success` is `false`.

#### Negative Paths
- Given a subprocess failure whose output is an ordinary error (e.g. a stack trace, a
  permission error, or prose that merely contains the word "model" outside the anchored
  signature), when `invoke()` returns, then `modelUnavailable` is undefined/absent — no
  false downgrade trigger.
- Given output matching the rate-limit signature (`rate limit`, `429`, `overloaded`),
  when `invoke()` returns, then `rateLimited` is set and `modelUnavailable` is NOT set
  (rate limits must never be misread as unavailability — that would permanently
  downgrade a healthy model).
- Given a missing `claude` binary (exit 127 / ENOENT), when `invoke()` returns, then the
  existing "provider not found" result is returned unchanged with `modelUnavailable`
  NOT set.

### Done When
- [ ] `InvokeResult` type carries optional `modelUnavailable?: boolean`.
- [ ] Unit tests cover the signature match, the ordinary-failure non-match, the
      rate-limit precedence case, and the missing-binary case.
- [ ] A real-binary smoke test (guarded, like existing ones) asserts the actual
      `claude` CLI's error text for a bogus `--model` value matches the detection
      regex — argv-only tests are insufficient per harness feedback.

---

## Story: In-attempt ladder walk on unavailable model

**Requirement:** TS-2 (#186 — "step runs on next available ladder model instead of HALTing"; ADR §Decision 3)

As the daemon operator, I want a step whose configured model is unavailable to complete
on the next ladder model within the same attempt so that the retry budget and HALT path
are never exercised by a misconfigured model.

### Acceptance Criteria

#### Happy Path
- Given ladder `fable → opus → sonnet` and a provider where `fable` returns
  `modelUnavailable` and `opus` succeeds, when an autonomous step runs, then the step
  result is success, exactly one attempt was consumed, and the invocation sequence was
  `fable` then `opus`.
- Given the configured model succeeds, when an autonomous step runs, then exactly one
  invocation occurs with the configured model — zero behavior change, no extra calls,
  no log lines (#186 acceptance criterion).

#### Negative Paths
- Given the ladder's FIRST model is the configured model and it is unavailable, when the
  step runs, then the walk proceeds to position 2 (and if needed 3) within the same
  attempt — verified for an unavailable model at EVERY ladder position (#186 mandated
  negative path).
- Given ALL ladder models return `modelUnavailable`, when the step runs, then the step
  returns an ordinary failure carrying the last failure output, and the existing
  retry/HALT machinery proceeds unchanged (no crash, no infinite loop, retry budget
  consumed only by whole-ladder attempts).
- Given a configured model NOT present on the ladder (e.g. a full model ID) that returns
  `modelUnavailable`, when the step runs, then the walk falls to the ladder's first
  live entry rather than erroring.
- Given the walk downgraded to `opus` and `opus` returns a rate-limit failure, when the
  step returns, then the result is the existing rate-limited result (wait-and-retry),
  NOT a further ladder downgrade — only `modelUnavailable` advances the walk.

### Done When
- [ ] Ladder walk implemented in `engine/model-availability.ts`, invoked from the
      autonomous step-runner path; `conductor.ts` retry logic diff is empty.
- [ ] Injected-provider tests assert invocation sequences for: success-first,
      downgrade-at-each-position, full exhaustion, off-ladder configured model,
      and rate-limit-after-downgrade.
- [ ] Exhausted-ladder failure flows into the existing retry path in an integration
      test (no HALT special-casing added or removed).

---

## Story: Per-process availability cache

**Requirement:** TS-3 (#186 — "cache the probe result for the process lifetime"; ADR §Decision 4/6)

As the daemon operator, I want a model marked unavailable to be skipped for the rest of
the process so that every subsequent step starts directly on the best live model.

### Acceptance Criteria

#### Happy Path
- Given `fable` was marked unavailable during an earlier step in this process, when a
  later step resolves to `fable`, then the invocation starts directly on the next live
  ladder model with no doomed `fable` subprocess spawned.
- Given a fresh process (restart), when the first step resolves to `fable`, then `fable`
  is attempted again (cache is process-scoped; restart re-probes).

#### Negative Paths
- Given `fable` is marked dead and the next step is a COLLABORATIVE step (dispatched via
  `invokeInteractive`, where reactive detection is impossible), when the step is
  dispatched, then the model argument passed to the provider is the substituted live
  model — the cache consult applies to both invoke paths.
- Given two different model strings that alias the same underlying model (e.g. `opus`
  and a full opus model ID), when one is marked dead, then the other is NOT implicitly
  marked dead — cache keys are exact opaque strings (no alias resolution guessing).

### Done When
- [ ] Cache is a per-process singleton in `engine/model-availability.ts`; no disk state,
      no cross-worktree state.
- [ ] Tests assert: no second spawn of a dead model, interactive-path substitution,
      exact-string keying, and fresh-instance behavior (constructing a new cache
      re-allows all models — the restart semantics).

---

## Story: Loud downgrade logging

**Requirement:** TS-4 (#186 — "downgrade is logged with configured model, actual model, and reason")

As the daemon operator, I want every downgrade visibly logged so that I know a gate ran
on a weaker model than configured.

### Acceptance Criteria

#### Happy Path
- Given a reactive downgrade from `fable` to `opus`, when the walk advances, then a
  warning line is emitted to the step output stream (hence captured in daemon.log)
  containing all three of: configured model (`fable`), actual model (`opus`), and the
  reason (model-unavailable detection).
- Given a cache-consult substitution (dead model skipped pre-invoke), when the step is
  dispatched, then the same three-field warning is emitted — silent substitution is a
  bug even when no new probe failed.

#### Negative Paths
- Given the configured model is available and used, when the step runs, then NO
  downgrade warning is emitted (zero noise in the healthy path).
- Given the ladder is fully exhausted, when the step fails, then the failure output
  names every model tried, so the HALT (if retries also exhaust) is diagnosable from
  daemon.log alone.

### Done When
- [ ] Warning format includes configured model, actual model, reason; asserted verbatim
      in a test.
- [ ] Happy-path test asserts zero downgrade output.
- [ ] Exhaustion failure output lists all attempted models; asserted in a test.

---

## Story: Configurable ladder in .ai-conductor/config.yml

**Requirement:** TS-5 (#186 — "ladder is configurable; default fable → opus → sonnet")

As a harness consumer, I want to configure the fallback ladder per project so that a
repo can pin its own degradation policy.

### Acceptance Criteria

#### Happy Path
- Given no `model_fallback_ladder` key in config, when the engine resolves the ladder,
  then it is `['fable', 'opus', 'sonnet']`.
- Given `model_fallback_ladder: [opus, sonnet, haiku]`, when the engine resolves the
  ladder, then that exact ordered list is used.

#### Negative Paths
- Given `model_fallback_ladder: []` (fully empty ladder — #186 mandated negative path),
  when a model returns `modelUnavailable`, then NO fallback occurs: the failure
  surfaces to the normal retry/HALT machinery exactly as today, and config validation
  accepts the empty list as a deliberate "no fallback" setting.
- Given a malformed value (a string instead of a list, a list containing a non-string
  or empty-string entry), when config loads, then `validateConfig` reports a clear
  per-path error (existing config-error shape) and the config is rejected — never a
  silent fallback to defaults on a malformed key.

### Done When
- [ ] `HarnessConfig` gains optional `model_fallback_ladder?: string[]`; validation
      wired into `validateConfig` alongside the existing block validators.
- [ ] Tests cover: default resolution, explicit override, empty list (accepted +
      no-fallback behavior), malformed shapes (rejected with path-specific error).

---

## Story: Documentation reflects the fallback behavior

**Requirement:** TS-6 (#186 — Docs section; harness "Docs track features" rule)

As a harness consumer, I want the fallback behavior documented where model selection is
documented so that a downgraded gate is never a surprise.

### Acceptance Criteria

#### Happy Path
- Given the feature lands, when reading `README.md` and HARNESS.md's Model Selection
  section, then both describe: reactive detection, the ladder default, the config key,
  the per-process cache/restart semantics, and where downgrades are logged.
- Given the feature lands, when reading `CHANGELOG.md`, then an `[Unreleased]` Added
  entry describes the fallback ladder.
- Given #189's interim-fallback note in HARNESS.md ("until #186's availability ladder
  lands, override per-run with `--model`"), when this feature's docs land, then that
  interim note is REPLACED by the ladder documentation (the `--model` override remains
  documented as an override, not as the unavailability escape hatch) — the three sync
  points (model table, HARNESS.md note, README) must not disagree.

#### Negative Paths
- Given the docs claim a config key or default, when compared against the shipped
  `resolved-config.ts` / `config.ts` values, then they match exactly (no doc drift at
  ship time — checked in prd-audit/as-built review).

### Done When
- [ ] `README.md`, `src/conductor/README.md` (daemon options surface), and HARNESS.md
      Model Selection updated in the same PR.
- [ ] CHANGELOG `[Unreleased]` entry present.
