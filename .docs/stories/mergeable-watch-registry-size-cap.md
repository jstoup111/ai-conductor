# Stories: cap the mergeable-watch registry size (bounded growth)

Status: Accepted

Source issue: jstoup111/ai-conductor#149

These stories specify the behavior of `sweepMergeableLabels` in
`src/conductor/src/engine/mergeable-sweep.ts` when the watch registry exceeds a maximum
entry count. Acceptance criteria are Given/When/Then and are the authority for this
technical-track fix (no PRD).

---

## Story 1 — An over-cap registry is trimmed, with each drop logged (happy path)

**As** the daemon's mergeable sweep
**I want** the watch registry bounded to a maximum entry count
**So that** an unmerged `done` PR that never self-prunes cannot make the registry grow
without bound (and each entry cost one `gh pr view` per tick).

### Scenario 1a: survivors beyond the cap are dropped

- **Given** after the normal merged/closed/gone prune the `survivors` list still holds
  more entries than the configured maximum,
- **When** the sweep finalizes before `rewriteWatch`,
- **Then** the registry is trimmed to the maximum count, dropping the excess **oldest**
  entries (the append-ordered front of the JSONL),
- **And** the persisted `.daemon/mergeable-watch.jsonl` contains at most the maximum
  number of entries.

### Scenario 1b: every drop is logged (no silent caps)

- **Given** the cap drops N entries,
- **When** each is dropped,
- **Then** the sweep logs one line per drop via the injected `log` callback, using the
  existing `[mergeable-sweep] …` prefix and naming the dropped PR (slug/prUrl) and the
  reason (registry cap) — no silent truncation, per the harness "no silent caps"
  convention.

---

## Story 2 — An under-cap registry is unchanged (negative path)

**As** an operator with a small registry
**I want** the cap to be inert when the registry is within bounds
**So that** normal operation is unaffected.

### Scenario 2a: at or below the cap → no drops

- **Given** the post-prune `survivors` count is at or below the maximum,
- **When** the sweep finalizes,
- **Then** no entries are dropped, no cap-drop log lines are emitted, and every survivor
  is written back by `rewriteWatch` unchanged.

---

## Story 3 — The cap runs after the normal self-prune, and stays best-effort (negative path)

**As** the sweep
**I want** the cap to compose with the existing prune and remain non-blocking
**So that** correctness (merged/closed/gone still self-prune) and resilience (a write
failure never crashes the sweep) are preserved.

### Scenario 3a: merged/closed/gone still self-prune first

- **Given** a registry containing both gone PRs and a surplus of live-but-unmerged
  entries,
- **When** the sweep runs,
- **Then** the gone PRs are pruned by the existing merged/closed/NOTFOUND logic first,
  and the cap applies only to whatever survives — the cap never overrides or bypasses
  the state-based prune.

### Scenario 3b: cap is best-effort/non-blocking

- **Given** the cap trims the registry and `rewriteWatch` fails to persist,
- **When** that write error occurs,
- **Then** it is swallowed like today's `rewriteWatch` failures (C3) — the sweep does
  not throw, and the next tick retries — the cap adds no new failure mode.
