# Track: suppress other-owner gate-writeback log noise unless verbose

Track: technical

Daemon log hygiene: the gate-writeback skip notices that name a gated (always
`other-owner`) spec are suppressed at default verbosity and surfaced only under a verbose
mode. No product-facing capability — this is internal daemon logging behavior; acceptance
criteria live in stories, no PRD. Source: issue jstoup111/ai-conductor#840.
