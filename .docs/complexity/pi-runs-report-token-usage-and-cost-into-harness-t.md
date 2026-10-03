# Complexity Assessment: Pi runs report token usage and cost into harness telemetry

**Date:** 2026-10-02
**Tier:** M
**Track:** .docs/track/pi-runs-report-token-usage-and-cost-into-harness-t.md
**Source:** jstoup111/ai-conductor#1889

Tier: M

## Signals

| Signal | Value | Reading |
|---|---|---|
| Models/tables | 0 | Small |
| External integrations | 1 (Pi `--mode json` event stream, verified against Pi 0.84.3 types) | Small/Medium |
| Auth/authz | None | Small |
| Contract surface | Additive optional field on the `TokenUsage` / `provider_attempt` telemetry contract to carry the model the cost was attributed to | Medium |
| Decision logic | Ordered cost-source precedence (Pi-reported → rate card → tokens-only → unmetered) with zero-cost and missing-usage edge cases | Medium |
| Estimated stories | ~4–6 (parser, cost precedence, attribution, rollup, negative paths) | Medium |

## Decision

**Medium.** The adapter fix itself is small, but the change alters what every Pi dispatch writes to
the event spine: it corrects a live defect (real Pi output carries usage on `message.usage`, which
the adapter never reads, so live runs record fabricated zero usage), introduces a cost-source
precedence that metering and the ship-time rollup consume, and adds an attributed-model field to
the shared telemetry contract. That contract touch and the precedence rules warrant a lightweight
architecture review and conflict/coherence checks; no data model or new integration keeps it off
Large.
