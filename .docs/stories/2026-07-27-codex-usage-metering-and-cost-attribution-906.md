# Stories — Codex usage metering and cost attribution (#906, absorbs one #1008 facet)

Track: technical. Tier: L. Source: jstoup111/ai-conductor#906 (absorbs the KPI-rendering facet of jstoup111/ai-conductor#1008; that umbrella issue stays open).
Acceptance criteria are the Given/When/Then scenarios below (no PRD on the technical track).

> Note: #906's "Observed" section is stale — `parseCodexJsonl` already parses
> `turn.completed.usage`. These stories target the defects verified in source and against a
> live `codex exec --json` capture. See `.docs/decisions/architecture-review-2026-07-27-codex-usage-metering-and-cost-attribution-906.md` F1.

---

## Story 1 — Codex usage accumulates across every turn of a dispatch

As the engine, I sum Codex token usage over all turns of a step so a multi-turn dispatch is not
undercounted to its final turn.

**Happy path**
- **Given** a `codex exec --json` stdout stream containing three `turn.completed` events with
  `input_tokens` 100/200/300 and `output_tokens` 10/20/30,
- **When** `parseCodexJsonl` parses the stream,
- **Then** the returned `TokenUsage` has `input` 600 (100+200+300) and `output` 60 (10+20+30) —
  the sum across turns, not the last turn's 300/30,
- **And** `numTurns` is 3, derived from the count of `turn.completed` events.

**Happy path — single turn unchanged**
- **Given** a stream with exactly one `turn.completed`,
- **When** it is parsed,
- **Then** the totals equal that turn's values, matching today's behavior exactly.

**Negative path — a malformed turn does not corrupt the total**
- **Given** a stream where one `turn.completed` carries a non-numeric `input_tokens`,
- **When** it is parsed,
- **Then** the well-formed turns are still summed, the malformed turn contributes nothing, and no
  `NaN` reaches `TokenUsage`.

---

## Story 2 — Codex cache-creation and reasoning tokens are captured

As the engine, I record every token class Codex reports so cache and reasoning spend are not
invisible.

**Happy path**
- **Given** a `turn.completed` whose `usage` carries `cached_input_tokens`,
  `cache_write_input_tokens`, and `reasoning_output_tokens`,
- **When** `parseCodexJsonl` parses it,
- **Then** `cacheRead` comes from `cached_input_tokens`, `cacheCreation` from
  `cache_write_input_tokens`, and `reasoningOutput` from `reasoning_output_tokens`.

**Negative path — absent fields stay absent**
- **Given** a `turn.completed` whose `usage` omits `cache_write_input_tokens`,
- **When** it is parsed,
- **Then** `cacheCreation` is absent rather than `0`, so "not reported" is distinguishable from
  "reported as none".

---

## Story 3 — A dispatch with tokens but no cost is classified cost-unmetered

As the engine, I classify metering three ways so absent cost is never recorded as zero cost.

**Happy path**
- **Given** a Codex dispatch whose `TokenUsage` has tokens and no `costUsd`,
- **When** the metering classification helper runs,
- **Then** it returns `cost-unmetered`, and the rollup adds the tokens while adding **nothing** to
  `costUsd` and incrementing `costUnmetered.count`.

**Happy path — Claude unchanged**
- **Given** a Claude dispatch whose `TokenUsage` has tokens and `costUsd: 0.05`,
- **When** the classification runs,
- **Then** it returns `fully-metered`, `costUsd` accumulates `0.05`, and `costUnmetered.count` and
  `unmetered.count` are both unchanged.

**Negative path — no usage at all keeps today's meaning**
- **Given** a `step_completed` event with no `tokenUsage` (a non-LLM step such as `worktree`),
- **When** the rollup runs,
- **Then** it increments `unmetered.count` exactly as it does today, and does **not** increment
  `costUnmetered.count`.

**Negative path — a genuine zero cost is not mistaken for absence**
- **Given** a dispatch reporting `costUsd: 0` explicitly,
- **When** the classification runs,
- **Then** it is `fully-metered` with a real measured zero — not `cost-unmetered`.

---

## Story 4 — The committed `## Cost` block records cost-unmetered, additively

As an operator, I read per-feature cost from the shipped record and can tell a partial total from a
complete one.

**Happy path**
- **Given** a feature with both Claude and Codex dispatches,
- **When** `renderShippedRecordWithCost` writes the record,
- **Then** the `## Cost` block contains a new top-level `cost_unmetered:` line and a
  `cost_unmetered:` field on each affected `providers:` entry,
- **And** every pre-existing line (`input`, `output`, `cache_read`, `cache_creation`, `cost_usd`,
  `dispatches`, `retries`, `halts`, `unmetered`) keeps its current name, order, and format.

**Negative path — records written before this change still parse**
- **Given** a `## Cost` block captured from a record already committed on main, with no
  `cost_unmetered` line,
- **When** `parseCostBlock` reads it,
- **Then** parsing succeeds and `costUnmetered` defaults to `0`, with all other fields unchanged.

**Negative path — round trip is stable**
- **Given** a rollup rendered to markdown and parsed back,
- **When** it is rendered again,
- **Then** the output is byte-identical to the first rendering.

**Negative path — frontmatter and dedup are untouched**
- **Given** the new block content,
- **When** `parseShippedRecord` reads the record for discovery dedup,
- **Then** its frontmatter parsing is unaffected, preserving the constraint from
  `.docs/conflicts/per-feature-token-accounting.md`.

---

## Story 5 — Cost-unmetered work still contributes to token aggregates

As an operator, I keep a meaningful KPI aggregate even though this repo builds on Codex.

**Happy path**
- **Given** a shipped feature whose Cost block has `cost_unmetered: count: 3` and `unmetered: count: 0`,
- **When** `conduct kpi` runs,
- **Then** the feature's input and output tokens **are** included in the aggregate token totals,
- **And** its cost is excluded from the aggregate cost total,
- **And** its line is marked as cost-partial, naming that cost is unavailable rather than zero.

**Negative path — a truly unmetered feature is still excluded from both**
- **Given** a feature with `unmetered: count: 1`,
- **When** `conduct kpi` runs,
- **Then** it is excluded from token **and** cost aggregates, exactly as today.

**Negative path — the aggregate is never silently empty**
- **Given** every shipped feature is cost-unmetered,
- **When** `conduct kpi` runs,
- **Then** a non-zero token aggregate is still reported and the cost total is shown as
  unavailable — never `0` presented as a measured total.

---

## Story 6 — `conduct kpi` renders per-provider and previously-hidden fields (one #1008 facet)

As an operator, I can see per-provider attribution and cache spend from the KPI command instead of
reading the markdown by hand.

**Happy path**
- **Given** a shipped record whose Cost block includes a `providers:` sub-block,
- **When** `conduct kpi` runs,
- **Then** each provider's tokens, cost, cost-unmetered count, and dispatches are rendered,
  attributed by provider name.

**Happy path — the six hidden fields surface**
- **Given** a Cost block with non-zero `cache_read`, `cache_creation`, `dispatches`, `retries`,
  `halts`, and `unmetered duration_ms`,
- **When** `conduct kpi` runs,
- **Then** all six are rendered, and the "Known limitation" note at
  `docs/reference/artifacts.md:534-540` is removed as no longer true.

**Negative path — records with no providers block**
- **Given** an older record with no `providers:` sub-block,
- **When** `conduct kpi` runs,
- **Then** it renders the feature's top-level totals without error and omits the per-provider
  section for that feature.

---

## Story 7 — The parser is pinned against a real captured Codex stream

As a maintainer, I detect Codex CLI schema drift instead of discovering it through wrong numbers.

**Happy path**
- **Given** a fixture file containing a real `codex exec --json` transcript captured from the CLI
  (not hand-authored),
- **When** it is replayed through the exported `parseCodexJsonl` helper,
- **Then** the parsed `TokenUsage` matches the usage values in the captured `turn.completed` event,
- **And** the test runs in the ordinary suite without invoking the `codex` binary, per
  `.agents/skills/write-tests/SKILL.md`.

**Negative path — unrecognized schema degrades, never zeroes**
- **Given** a stream whose `turn.completed` carries an unrecognized usage shape,
- **When** it is parsed,
- **Then** `tokenUsage` is absent and the dispatch is classified `unmetered` — it is never recorded
  as `0` tokens or `0` cost.

---

## Story 8 — Documentation reflects the new metering states

As a reader, the documented cost contract matches what the code writes.

**Happy path**
- **Given** the `## Cost` block gains a field and `conduct kpi` gains output,
- **When** the PR lands,
- **Then** `docs/reference/artifacts.md` documents `cost_unmetered` and drops **only** the KPI
  limitation note at lines 534-540 (the other three #1008 notes stay, and the PR does not close
  #1008), and `docs/reference/cli.md`'s `conduct-ts kpi` entry reflects the new output,
- **And** per this repo's documentation rule, the change ships in the same PR.

---

Status: Accepted
