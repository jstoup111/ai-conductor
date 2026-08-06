# Complexity: Annotated Stories line makes a merged spec silently undispatchable

Tier: M

## Rationale

- Touches three modules across a contract boundary: `plan-stories-reference.ts` (pure
  resolver), `daemon-backlog.ts` (`discoverBacklog` gains a `blocked` output and its per-plan
  gauntlet is reordered), and `daemon-observe-cli.ts` (snapshot-reading section).
  `land-spec.ts` gains an error-message change only. `daemon-dashboard.ts` is deliberately
  untouched — rendering was cut from scope and deferred to #1332.
- One new persisted artifact (`.daemon/blocked.json`, whole-file atomic per-pass rewrite),
  reusing the `.daemon/gated.json` pattern verbatim — freshness and torn-read concerns are
  already solved by that precedent.
- A behaviour-preserving reorder of an existing discovery gauntlet is the riskiest part: the
  eligible `items` set must be byte-identical apart from newly-resolvable plans, and the
  legacy-plan flood (82 plans here) must be suppressed by running dedup first.
- No external integration, no new auth, no migrations, no new state machine. 5 stories /
  13 tasks.

Not S: multi-module contract change plus a new persisted artifact exceed a single-seam
change; the filer's `size: S` label predates the discovery that the operator wants a blocking
state rather than a log line. The dashboard cut removed roughly two tasks but not the tier —
the gauntlet reorder and the snapshot are what make this M.

Not L: no new subsystem, provider, model, or auth surface; the snapshot pattern is copied
from an already-shipped feature in the same files.
