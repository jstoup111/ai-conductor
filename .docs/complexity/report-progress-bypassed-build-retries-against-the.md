# Complexity: Report progress-bypassed build retries against their own allowance

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one retry emit in the build step's completion-miss decision, two additive optional fields on an existing event union member, one new pure formatting helper in the module that already owns retry-line formatting, its three existing call sites, two attributes on an existing span event, and one runbook paragraph. Every edit is a few lines at a site that already exists; no control flow, budget, ceiling, halt classification, configuration key, CLI surface, hook, or schema changes. It introduces no service, no storage, no new telemetry channel, and no new consumer. Small-tier architecture, conflict-check, and coherence artifacts are not required. Seven production files are touched only because the retry line is rendered from three separate call sites plus a span recorder; the work is one mechanical change repeated at known seams, not several designs.
