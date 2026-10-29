# Complexity: Repo-wide diagnostic for plans whose Stories reference cannot resolve (#1442)

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One in-memory report row (plan path, raw reference, attempted path, resolution kind, lifecycle state); nothing persisted |
| External integrations | None — local Git reads of the committed tree and local `.daemon/` / `.worktrees/` file reads only |
| Auth / permission surface | None — read-only operator verb |
| State machines | None — a single pass with a fixed classification precedence |
| Story count | 5 |
| Files touched | Engine: `plan-stories-reference.ts` (raw reference text through the existing regex), `daemon-backlog.ts` (behavior-preserving extraction of discovery's candidate listing and Stories resolution), `daemon-deps.ts` (base ref and SHA from one resolution), `daemon-dashboard.ts` (export the DONE marker constant), one new scan module, `daemon-observe-cli.ts` and `daemon-command.ts` (detect + dispatch), `cli.ts` (help declaration). Docs are left to the pre-finish documentation gate |
| New runtime code | Yes — one read-only scan that composes existing production predicates |

## Rationale

Every piece already exists in production and is reused, not re-derived. Discovery's candidate
listing and per-candidate Stories resolution (legacy `resolveStoriesRef` over `gitTreeSource`, and
the manifest-backed path that `adr-2026-10-24-per-feature-artifact-manifest` decisions 5 and 8 added)
are extracted from `discoverBacklog` into exported functions that discovery and the diagnostic both
call, guarded by the existing discovery tests passing unchanged. The base commit comes from the
resolution discovery pins, and the lifecycle predicates are `isProcessed`, shipped-by-stem via
`listShippedRecords`, `isOperatorParked`, and the dashboard's live-HALT rule. The new code is a
composition plus one CLI verb beside `daemon status` / `daemon logs`, following their hand-rolled
detect/dispatch pattern. Signals: one in-memory row model, no external integration, no auth, no
state machine, five stories — Small on every signal. No new step, gate, persisted format, ADR, or
migration; the extraction conforms to the manifest ADR's reader routing rather than amending it, and
the change does not touch the blocked channel governed by
`adr-2026-08-05-blocked-classification-after-dedup` or
`adr-2026-08-05-blocked-is-a-distinct-state-from-halted`. → **Small.**
