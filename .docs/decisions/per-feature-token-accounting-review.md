# Architecture Review — Per-feature token accounting (#537)

Tier: M (lightweight review). Track: technical. Approach: A (operator-selected; C/OTel deferred).

## Scope reviewed

Wire the already-scaffolded token-usage pipeline end-to-end, attribute usage per feature via the
per-worktree event ledger, persist a committed per-feature cost rollup at ship, and expose a
tokens-per-shipped-feature KPI/trend — without metering human operator sessions (recorded as
unmetered).

## Feasibility findings (grounded)

- **Capture is a small, verified change.** `claude -p --output-format json` (stdin-delivered prompt,
  no E2BIG regression — verified against CLI v2.1.218) returns `result` (text), `usage`,
  `total_cost_usd`, `num_turns`, `duration_ms` in one payload. `parseTokenUsage` currently only
  matches a stream-json `{type:'usage'}` line that `--output-format text` never emits — the fix is to
  parse the json result object. **Confidence: high (verified).**
- **Per-invocation usage semantics.** Usage is reported per invocation, not cumulative across
  `--resume`. The engine emits one `step_completed` per invocation into the per-worktree
  `events.jsonl`, so accumulation is a sum over events — no cumulative-usage query needed.
  **Confidence: high (verified).**
- **Attribution needs no event-bus change.** `.pipeline/` is per-worktree and each feature builds in
  its own worktree, so `events.jsonl` is already per-feature. The shared in-memory event bus's
  "no slug" limitation (daemon-cli.ts:738-740) does not affect the persisted per-worktree ledger.
  **Confidence: high (verified by exploration).**
- **Downstream is ready.** `report-renderer.ts aggregateTokens` + "Token Spend" table and the OTel
  `conductor.step.tokens` counter already consume `step_completed.tokenUsage`; they are dormant only
  because the emit omits the field. **Confidence: high (verified).**

## Decisions (see ADRs)

- **ADR-2026-07-22-a** — Build dispatch captures usage via `--output-format json` (not stream-json);
  parse `.result` for text, `.usage`/`.total_cost_usd`/`.num_turns`/`.duration_ms` for cost.
- **ADR-2026-07-22-b** — The per-feature cost rollup is a committed `Cost:` block in
  `.docs/shipped/<slug>.md`; attribution reads the per-worktree `events.jsonl`; `unmetered` is a
  first-class field, and the emitted event carries `model` so the OTel path (deferred C) is fed.

## Risks & mitigations

- **R1: a step invocation whose json parse fails yields no usage.** Mitigation: count it as
  `unmetered{count,duration}` (never drop it) — a partial total is visibly partial. (Design Principle:
  fail-visible, not fail-silent.)
- **R2: cache tokens (`cache_read`/`cache_creation`) materially change "cost".** Mitigation: persist
  all four token classes separately in the rollup; the KPI headline uses input+output, cache retained
  for later cost modeling. Avoids baking a lossy definition into the ledger.
- **R3: an output-format change could regress the text tail the engine already consumes.** Mitigation:
  extract the tail from `.result`; an acceptance spec pins that autonomous steps still receive their
  text output unchanged.
- **R4: OTel-later (C) drift.** Mitigation: emit `model` + `tokenUsage` on the event now so C is a
  consumer swap; ADR-b records this as a forward-compat constraint.

## Out of scope (documented follow-ups)

- Human operator/babysit session metering (deferred Approach B).
- OTel-first KPI + dashboard cleanup post-OTel integration (deferred Approach C, operator-requested
  as a later fast-follow).

Status: APPROVED
