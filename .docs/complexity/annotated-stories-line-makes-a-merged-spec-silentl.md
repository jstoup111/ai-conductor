# Complexity: Annotated Stories line makes a merged spec silently undispatchable

Tier: M

## Rationale

- Touches four modules across a contract boundary: `plan-stories-reference.ts` (pure
  resolver), `daemon-backlog.ts` (`discoverBacklog` gains a `blocked` output and its per-plan
  gauntlet is reordered), `daemon-dashboard.ts` (new BLOCKED group + precedence), and
  `daemon-observe-cli.ts` (snapshot-reading section). `land-spec.ts` gains an error-message
  change only.
- One new persisted artifact (`.daemon/blocked.json`, whole-file atomic per-pass rewrite),
  reusing the `.daemon/gated.json` pattern verbatim — freshness and torn-read concerns are
  already solved by that precedent.
- A behaviour-preserving reorder of an existing discovery gauntlet is the riskiest part: the
  eligible `items` set must be byte-identical apart from newly-resolvable plans, and the
  legacy-plan flood (82 plans here) must be suppressed by running dedup first.
- No external integration, no new auth, no migrations, no new state machine. Estimated 6
  stories / ~14 tasks.

Not S: multi-module contract change plus a new persisted artifact and a new dashboard bucket
exceed a single-seam change; the filer's `size: S` label predates the discovery that the
operator wants a blocking state rather than a log line.

Not L: no new subsystem, provider, model, or auth surface; the snapshot and bucket patterns
are copied from an already-shipped feature in the same files.
