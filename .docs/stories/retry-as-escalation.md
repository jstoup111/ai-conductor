# Stories: retry-as-escalation

Status: Accepted

Technical-track stories. Acceptance criteria are Given/When/Then over the retry
loop's observable behavior. Every ladder boundary carries an explicit negative path
(adversarial input at each call site).

> **Provider-aware amendment (#902, approved 2026-07-23):** The concrete
> `haiku → sonnet → opus → fable` examples below are the built-in **Claude**
> policy. Their provider-neutral invariants remain authoritative: attempt 2
> raises effort, attempt 3+ cumulatively raises the model from the base, both
> ladders cap, non-consuming retries stay on the same rung, and opt-out pins the
> base. Codex applies those same invariants to
> `gpt-5.6-luna → gpt-5.6-terra → gpt-5.6-sol` as specified in
> `model-and-effort-resolution-provider-aware-902.md`.

---

## Story 1 — Attempt 2 escalates effort one level (happy)

As the engine, when a step's first attempt fails, I re-run the retry at one higher
effort level so the retry changes the odds.

- **Given** a step configured at model `sonnet`, effort `medium`, with `escalate`
  unset (default true) and `max_retries` 3,
- **When** attempt 1 fails and the loop begins attempt 2,
- **Then** attempt 2 dispatches at model `sonnet`, effort `high` (base effort bumped
  one level), and the model is unchanged.

## Story 2 — Attempt 3 escalates model one tier, composed with availability (happy)

As the engine, when the effort bump did not succeed, I re-run at the next model tier,
letting the availability ladder pick a live model.

- **Given** the same step after attempt 2 (effort already bumped to `high`) fails,
- **When** the loop begins attempt 3,
- **Then** attempt 3 targets model `opus` (base `sonnet` bumped one tier), effort stays
  `high`,
- **And** the target model is routed through `ModelAvailability.effectiveModel`, so if
  `opus` is live it runs on `opus`, honoring the #186 fallback ladder.

## Story 3 — Deep-step budgets reduced to 3 (happy)

As the operator, I want deep steps to stop burning five identical retries now that a
retry escalates.

- **Given** default configuration with no per-step `max_retries` override,
- **When** the engine resolves the retry budget for `explore`, `prd`, `plan`, and
  `build`,
- **Then** each resolves to `max_retries` 3 (reduced from 5),
- **And** 3 is sufficient to reach the attempt-3 model-bump rung.

## Story 4 — Escalation is logged for retro Part C (happy)

As the retro, I want to measure escalation from persisted events.

- **Given** a step that fails attempt 1 and retries,
- **When** the loop emits the `step_retry` event for the upcoming attempt,
- **Then** the event carries `escalatedModel` and `escalatedEffort` equal to the
  values the next attempt will use,
- **And** the event is persisted to `.pipeline/events.jsonl`,
- **And** `aggregateRetryHotspots` surfaces the escalation so retro Part C can report
  how far up the ladder the step climbed.

## Story 5 — Per-step opt-out pins the base config (happy + config)

As the operator, I want to keep identical retries for a step where escalation is not
wanted.

- **Given** a step configured with `escalate: false` at model `sonnet`, effort
  `medium`, `max_retries` 3,
- **When** attempts 1, 2, and 3 all fail,
- **Then** every attempt dispatches at model `sonnet`, effort `medium` (base, no bump),
- **And** no `escalatedModel`/`escalatedEffort` movement is recorded for the step.

## Story 6 — Effort already at the top of the ladder (negative)

As the engine, I must not crash or produce an invalid effort when there is nowhere to
bump.

- **Given** a step configured at effort `max`,
- **When** attempt 2 begins,
- **Then** the effort bump is a no-op — attempt 2 runs at effort `max` (still valid),
  no error is raised,
- **And** attempt 3 still proceeds to the model bump normally.

## Story 7 — Model already at the top tier (negative)

As the engine, I must not produce an invalid model when there is no higher tier.

- **Given** a step configured at model `fable`,
- **When** attempt 3 (and any later attempt) begins,
- **Then** the model bump is a no-op — the attempt runs at `fable`, no error is raised,
- **And** the effort bump from attempt 2 is still applied.

## Story 8 — Escalation target tier is unavailable (negative, composition)

As the engine, when I bump to a tier that is dead, the availability ladder must
substitute a live model.

- **Given** a step at base model `sonnet` whose attempt 3 targets `opus`, and `opus`
  has been marked unavailable this process,
- **When** attempt 3 dispatches,
- **Then** `ModelAvailability.effectiveModel` substitutes the next live model from the
  availability ladder (e.g. `sonnet` or `fable` per liveness),
- **And** the attempt runs on a live model rather than failing on the dead tier.

## Story 9 — Exhausted retries still HALT correctly (negative)

As the engine, escalation must not defeat the terminal HALT.

- **Given** a gating step in auto/daemon mode at `max_retries` 3, where every attempt
  (base → effort-bumped → model-bumped) fails,
- **When** the final rung (attempt 3) fails,
- **Then** the loop exits with `succeeded=false`, writes `LOOP_HALT_MARKER`, and emits
  `loop_halt` exactly as before escalation existed,
- **And** the ladder introduced no extra attempts beyond `max_retries`.

## Story 10 — Non-consuming retries do not advance escalation (negative)

As the engine, a transient infra retry must not spuriously climb the ladder.

- **Given** a step on attempt 2 (effort bumped),
- **When** the attempt hits a rate-limit / stale-session / auth park-and-poll path that
  does `attempt--; continue`,
- **Then** the re-run occurs at the **same** rung (attempt 2, same effort/model),
  because escalation derives from `attempt`,
- **And** no model bump is triggered by the transient retry.

## Story 11 — Invalid `escalate` config value is rejected (negative, config)

As the operator, a malformed opt-out must fail fast, not be silently ignored.

- **Given** a step config with `escalate: "no"` (a non-boolean) or an unknown sibling
  key,
- **When** the engine validates configuration at startup,
- **Then** validation fails with a clear error naming `steps.<name>.escalate` (boolean
  expected) or the unknown key,
- **And** the engine does not start with an ambiguous escalation setting.
