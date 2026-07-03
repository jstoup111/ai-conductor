# Complexity: Surface owner-gated specs in dashboard and status

Tier: M

## Rationale

- Touches four existing modules across a contract boundary: `discoverBacklog` gains a
  gated-entries output consumed by both the startup dashboard (`daemon-dashboard.ts`) and
  the work-source adapter; `daemon-observe-cli.ts` gains a snapshot-reading section; a
  write-back orchestrator reuses the `pr-labels.ts` seam.
- One new persisted artifact (`.daemon/gated.json`, whole-file per-pass rewrite) with
  freshness/atomicity concerns.
- One external integration path (GitHub comment/label write-back, warn-once semantics),
  but on the existing idempotent `upsertComment` marker pattern — no new auth, no new
  external system.
- No new data models, migrations, or state machines; estimated 4–6 stories.

Not S: multi-module contract change + external write-back exceed a single-seam change.
Not L: no new subsystem, auth surface, or model/provider work.
