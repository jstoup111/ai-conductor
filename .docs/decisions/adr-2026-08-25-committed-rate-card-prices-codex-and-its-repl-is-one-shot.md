# ADR: A committed rate card prices codex dispatches, and the codex REPL is a bounded one-shot

**Date:** 2026-08-25
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1857
**Supersedes (in part):**
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state` — its rejected alternative
  "Derive Codex cost from a per-model price table". The three-valued metering model itself
  (`metered` / `cost-unmetered` / `unmetered`) is retained unchanged.
- `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` — decision 5's clause that a
  dispatch carrying tokens without provider-reported cost stays `cost-unmetered`, and decision 4's
  clause that the REPL path uses inherited stdio for its prompt.

## Context

Two APPROVED rules describe a system that no longer exists, and the as-built compliance gate for
#1857 correctly refuses to let shipped code disagree with them silently.

**1. Codex cost.** `adr-2026-07-27` rejected pricing codex from a price table on the grounds that
under a Pro subscription the marginal USD cost of a run is not `tokens x rate`, so the figure would
be fiction rendered with the authority of a measurement. PR #1858 then landed exactly that
mechanism — `.ai-conductor/rate-card.json`, applied at dispatch time in
`codex-provider.ts:479` — against measured evidence: on one real feature, 30 claude dispatches
reported $5.63 while 17 codex dispatches reported $0.00 against 2.25M fresh input, 58M cache reads
and 148k output, a true ~$18.97. The reported total was 4.4x understated with nothing on the line
saying so. #1857 inherited that behavior; it did not introduce it. No ADR was authored at the time,
which is the gap this decision closes.

The old rejection weighed a fabricated number against no number. The measured comparison is
different: a rate-card figure is wrong about *marginal subscription cost* but approximately right
about *resource cost*, while `$0.00` is wrong about both and silently poisons every aggregate that
sums across providers.

**2. The codex REPL.** `adr-2026-08-24-...machine-envelope` decision 4 requires the REPL path to
keep inherited stdio. The codex adapter has no REPL: `buildArgs` always emits `codex exec`
(`codex-provider.ts:903`), a one-shot whose prompt is piped on stdin while stdout/stderr inherit
the operator's terminal (`codex-provider.ts:295-301`). There is no interactive session for a human
to type into, so inherited *stdin* would attach a terminal to a process that never reads it. The
ADR clause described claude's REPL and generalized to a provider that has none.

## Decision

1. **A committed rate card is an authoritative cost source for codex, applied at dispatch time.**
   `TokenUsage.costUsd` set from `.ai-conductor/rate-card.json` makes the dispatch `metered`. The
   card is durable committed state carrying `as_of` and `source`; pricing happens when the run
   happens, and history is never re-priced by a later card revision.
2. **The three-valued metering model is unchanged.** A dispatch whose envelope carries no usage is
   still `unmetered`; tokens with neither provider-reported nor rate-card cost are still
   `cost-unmetered`. No dispatch acquires an *estimated* cost — a rate-card price is a committed,
   auditable input, not an inference from the run.
3. **The codex REPL is a bounded one-shot with a piped plain-text prompt.** `interactive: true` on
   codex means `codex exec` with plain text and inherited stdout/stderr; its prompt arrives on
   stdin. Claude's REPL is unaffected and keeps inherited stdio.
4. **No dispatch on any provider supplies a stream consumer when `interactive: true`.** This half
   of the REPL rule is retained verbatim and is now enforced at the attachment point in
   `provider-execution.ts`, not merely left inert in each adapter.

## Consequences

- KPI and cost rollups report a comparable dollar figure across providers. The figure is a
  resource-cost estimate for a subscription deployment, and the rate card's `as_of`/`source` fields
  are what make that auditable.
- The rate card is standing maintenance: a stale card silently misprices new models. A model absent
  from the card leaves `costUsd` undefined, so the dispatch degrades to `cost-unmetered` rather
  than to a wrong number.
- If an API-key (per-token) codex deployment is adopted, its provider-reported cost takes
  precedence over the card, exactly as claude's `total_cost_usd` does today.
