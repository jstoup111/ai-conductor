# Stories — Per-feature token accounting (#537)

Track: technical. Tier: M. Source: jstoup111/ai-conductor#537.
Acceptance criteria are the Given/When/Then scenarios below (no PRD on the technical track).

---

## Story 1 — Build dispatch captures per-invocation token usage

As the engine, I capture token usage from each autonomous build session so cost can be attributed.

**Happy path**
- **Given** an autonomous step dispatched via `claude-provider.ts invoke()` with the prompt on stdin,
- **When** the session completes with `--output-format json`,
- **Then** `InvokeResult.tokenUsage` is populated from the result object's
  `usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`,
  `total_cost_usd`, and `duration_ms`.

**Negative path — text output preserved (R3)**
- **Given** a step whose caller consumes the model's textual output,
- **When** the dispatch switches from `--output-format text` to `json`,
- **Then** the caller still receives the same text (sourced from `.result`), byte-equivalent to the
  prior behavior, and no E2BIG regression occurs (prompt remains on stdin).

**Negative path — unparseable result**
- **Given** a session whose stdout is not valid result json (truncation, crash),
- **When** usage parsing runs,
- **Then** `tokenUsage` is absent and the invocation is flagged unmetered (with any known duration),
  never silently treated as zero-cost.

---

## Story 2 — tokenUsage + model reach the step_completed event

As the engine, I thread captured usage through to the per-feature event ledger.

**Happy path**
- **Given** an autonomous step that returned `tokenUsage`,
- **When** `runAutonomous` returns and the conductor emits `step_completed`,
- **Then** the emitted event includes `tokenUsage` **and** the resolved `model`, and one such event is
  appended to the worktree's `.pipeline/events.jsonl`.

**Negative path — unmetered step still emits**
- **Given** a step with no capturable usage (Story 1 negative, or an interactive step),
- **When** `step_completed` is emitted,
- **Then** the event is still written with an explicit unmetered marker (and duration if known), so the
  step is counted, never omitted from the ledger.

---

## Story 3 — Per-feature cost rollup is committed at ship

As an operator, I get one committed per-feature cost record so the KPI is readable after ship.

**Happy path**
- **Given** a feature whose `.pipeline/events.jsonl` holds metered `step_completed` events,
- **When** the shipped record `.docs/shipped/<slug>.md` is written at ship,
- **Then** it contains a `Cost:` block summing tokens (input/output/cache_read/cache_creation),
  `cost_usd`, and counts of `dispatches`, `retries`, `halts`, plus `unmetered {count, duration_ms}`.

**Negative path — partial ledger never blocks ship**
- **Given** a feature whose `events.jsonl` is missing or partial,
- **When** the rollup is written,
- **Then** the Cost block is written with whatever is available, the gap is reflected in `unmetered`,
  and ship is **not** blocked or failed by the accounting step.

---

## Story 4 — tokens-per-shipped-feature KPI is computable across features

As an operator, I read the KPI and its trend from a single command.

**Happy path**
- **Given** two or more shipped records with Cost blocks,
- **When** I run `conduct kpi` (reads committed `.docs/shipped/*.md`),
- **Then** it prints tokens-per-shipped-feature per feature and an aggregate/trend across them, without
  reading raw daemon logs.

**Negative path — incomplete totals are visibly incomplete**
- **Given** a shipped feature whose Cost block has `unmetered.count > 0`,
- **When** `conduct kpi` renders it,
- **Then** that feature is marked incomplete/partial (not silently folded into a clean average), so a
  reader can tell the number understates true burn.

---

## Story 5 — Retro reports real cost, not an estimate

As the retro step, I cite real per-feature cost instead of estimating.

**Happy path**
- **Given** a shipped feature with a Cost block,
- **When** the retro step runs its context-efficiency section,
- **Then** it reports the real token/cost/dispatch numbers from the record.

**Negative path**
- **Given** a feature with no Cost block or an all-unmetered rollup,
- **When** retro runs,
- **Then** it reports the cost as unmetered/absent rather than fabricating a figure.

---

## Story 6 — OTel path stays fed for the deferred KPI work

As a maintainer, I keep the OTel token counter fed so Approach C is a later consumer swap.

**Happy path**
- **Given** the `step_completed` event now carries `tokenUsage` + `model`,
- **When** OTel metrics recording runs,
- **Then** `conductor.step.tokens` is recorded with the token counts (and model attribute available),
  with no new wiring required by the future OTel-first work.

**Negative path**
- **Given** OTel export is disabled/unconfigured,
- **When** a metered step completes,
- **Then** ship-time rollup and `conduct kpi` still work fully (OTel is an optional consumer, never a
  dependency of the committed-record KPI).

---

Status: Accepted
