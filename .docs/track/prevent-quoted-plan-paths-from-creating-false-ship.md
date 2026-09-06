# Track: Correct shipment association for PR checks

Track: technical

Scope boundary: Small fix for #1461, approved by the operator on 2026-09-06. Use explicit plan declarations for the required premerge check, identify the binding basis, and trigger a fresh check when the PR body changes. Preserve strict shipment evidence for declared implementations. Historical audit/backfill, postmerge reconciliation policy, shipment record format, and daemon completion are outside this slice.

This is a repository CI and internal tooling correction; acceptance criteria live in technical stories rather than a PRD.

The operator approved explicit declaration over section-scoped free-text scanning with “aligned” on 2026-09-06. Declaration distinguishes ownership from discussion; section scanning could still mistake a quotation for ownership.

Scope check: A — harness-repo-only (repository CI and shipped-record gate); B — n/a (no new skill); C — provider-agnostic. No catalog registration is required.

Verified foundation: shipment-evidence-cli.ts extracts plan paths throughout the body; shipment-association.ts requires one existing stem plus an implementation diff; shipped-record.yml omits edited and reads event metadata. The approved durable-shipment ADR requires immutable event-head validation. A new edited event supplies corrected body text without changing that contract.
