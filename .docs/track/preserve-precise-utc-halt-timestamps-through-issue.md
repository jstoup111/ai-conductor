# Track: Preserve precise UTC halt timestamps through issue resolution

Track: technical

Scope boundary: Complete #2176's UTC millisecond precision and strict shipping-evidence freshness outcomes, including existing imprecise ledger entries. Operator-approved 2026-09-05: recover the precise original timestamp from the monitor log; if it cannot be recovered, do not automatically close the legacy issue. Preserve the approved newest-halt-per-slug association, existing issue stamping/closure policy, and dry-run no-write behavior.

This is a bounded correction to the existing parser, local ledger merge, and closure guard. No new telemetry source, tracker API, ledger schema, daemon phase, or timestamp inference is introduced.

Scope check: harness-repo-only existing halt-monitor/daemon recovery machinery; catalog n/a; provider agnostic. Registration: none.
