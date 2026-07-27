# Conflict Check — Codex usage metering and cost attribution (#906, absorbs #1008)

Status: Accepted
Date: 2026-07-27
Feature: 2026-07-27-codex-usage-metering-and-cost-attribution-906

Checked for contradictions, overlaps, state conflicts, and resource contention — between the
eight stories, and against prior committed work in this subsystem.

## Internal consistency (Story ↔ Story)

No contradictions found.

- **S1/S2 vs S3.** S1 and S2 change what `parseCodexJsonl` produces; S3 changes how a produced
  `TokenUsage` is classified. Distinct seams (`codex-provider.ts` vs `cost-rollup.ts`), no
  overlap.
- **S2 vs S3 on absence semantics.** S2 requires an absent Codex field to stay absent rather than
  become `0`; S3 requires absent `costUsd` to mean cost-unmetered rather than zero cost. These are
  the same rule applied to different fields — consistent, mutually reinforcing.
- **S4 vs S5/S6.** S4 owns the writer, S5/S6 own the reader. They share one contract, which is
  why C1 below is managed rather than ignored.
- **S3 vs S5 on exclusion.** S3 defines the classification; S5 defines what a report does with it.
  S5's rule ("cost-unmetered excludes cost only") depends on S3 landing first — a **dependency**,
  not a conflict, and it is reflected in the plan's task ordering.

## Managed conflicts

### C1 — `## Cost` writer and reader must change atomically (highest)
`shipped-record.ts:146-172` writes the block; `kpi-report.ts:37-67` reads it back by regex. S4
changes the writer and S5/S6 change the reader. Landing either alone produces records the other
side misreads.

**Managed by:** ADR 2026-07-27-b's additive-only rule makes each side independently tolerant
(new reader defaults a missing field; old reader ignores an unknown line), so even a partial
landing degrades rather than breaks. The plan additionally sequences writer and reader into the
same batch, and S4 requires a round-trip test.

### C2 — Widening `unmetered` would empty the KPI aggregate
`kpi-report.ts:125-136` drops any feature with `unmeteredCount > 0` from **all** aggregates.
Since this repo builds on Codex, folding Codex into the existing counter would silently reduce
`conduct kpi` to aggregating across zero features while still printing a plausible-looking
report.

**Managed by:** `unmetered` keeps its exact current meaning (S3 negative path); the new state is
a separate counter; S5 splits the exclusion. S5's third negative path explicitly pins that the
aggregate is never silently empty.

### C3 — Shipped-record frontmatter is load-bearing for daemon dedup
`.docs/conflicts/per-feature-token-accounting.md` recorded that the Cost block must be additive
and the frontmatter byte-stable, because `parseShippedRecord` feeds discovery dedup and
`daemon-backlog.ts`. This feature modifies the same file's rendering.

**Managed by:** all changes are confined to the body **after** the closing `---` fence, which
`parseShippedRecord` never reads (documented at `shipped-record.ts:140-145`). S4's fourth
negative path pins that dedup parsing is unaffected.

### C4 — Scope overlap with #1008 (resolved by absorption)
#1008 owns "`conduct kpi` cannot render the `providers:` sub-block or six recorded fields"
(`docs/reference/artifacts.md:534-540`). S6 implements exactly that.

**Managed by:** the operator explicitly chose to absorb #1008 rather than fence it out. S6
requires removing the limitation note; #1008 closes as covered by this PR. Without absorption
this feature would ship a per-provider metering state no surface could display.

### C5 — Overlap with the #904/#905/#907 codex family (no contention)
Those features repeatedly fenced usage accounting **out** and into #906
(`.docs/specs/2026-07-25-first-class-codex-harness-parity-904.md:41,150`;
`.docs/specs/2026-07-25-codex-safety-and-self-host-parity-907.md:53`;
`.docs/conflicts/2026-07-25-first-class-codex-harness-parity-904.md:152` states "#905 and #906
can build independently").

**Managed by:** the fence points this way, so there is no contradiction — this feature is the
intended landing site. All of that family is already shipped (`.docs/shipped/`), so there is no
concurrent edit contention on `codex-provider.ts`.

### C6 — Claude's metering path must not regress
S3 touches shared classification logic used by Claude dispatches.

**Managed by:** S3's second happy path pins Claude's behavior as unchanged
(`fully-metered`, cost accumulates, neither new nor old unmetered counter moves). ADR-a's
consequence note requires one shared helper rather than four inline re-derivations, which is
what keeps Claude and Codex from diverging again.

## State conflicts

None. This feature introduces no lifecycle, no persisted mutable state, and no new concurrency.
The rollup is computed once at ship from an append-only per-worktree `events.jsonl`, and
`.pipeline/` is per-worktree, so there is no cross-feature contention.

## Resource contention

None. No new external service, no auth surface, no shared mutable file outside the feature's own
worktree. `conduct kpi` is read-only over committed records.

## Out-of-scope boundaries reaffirmed

- **D5 — interactive-dispatch metering** (`codex-provider.ts:192-215`,
  `claude-provider.ts:561`): both providers are unmetered in `invokeInteractive`. Real defect,
  deliberately excluded; it touches Claude's dispatch path and warrants its own issue.
- **Price-table cost derivation:** rejected in ADR 2026-07-27-a.
- **#759** persistent-session work: unaffected; it consumes usage rather than producing it.

## Verdict

**Accepted.** Six managed conflicts, no unresolved contradiction. C1 and C2 are the two that
would cause silent, plausible-looking wrong output, and both are pinned by named story
scenarios.
