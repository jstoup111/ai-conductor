# ADR 014: Daemon PR labeling — shared gh seam, tracked mergeable watch registry, best-effort sweep

**Date:** 2026-06-29
**Status:** DRAFT
**Deciders:** James Stoup (operator), Claude (architecture-review)

## Context

The daemon opens many PRs. We are adding two labels so a human can triage from GitHub:
`needs-remediation` (on irrecoverable build failure) and `mergeable` (on PRs from fully-shipped
features, kept in sync with CI/merge state). See spec `2026-06-29-daemon-pr-labels.md` (FR-1…FR-16).

Forces / constraints:
- Both behaviors must be **best-effort and non-blocking** — a `gh` failure must never disrupt the
  daemon's core loop, alter HALT/halt-reconciliation semantics (ADR-013), or block worktree teardown.
- `mergeable` must apply **only to PRs from features that reached `done`** (operator constraint) —
  not arbitrary open PRs.
- CI is not finished when `/finish` opens a PR, so mergeability cannot be a one-time check; it must
  be re-evaluated over time.
- `gh` is already the GitHub access mechanism across the codebase (handoff, intake, finish,
  worktree) via an injected runner (`GhRunner` / `makeProductionGh`). The advisory swallow-and-log
  pattern already exists (intake write-back, FR-37).

## Options Considered

### Mergeable evaluation source

**Option A: Stateless `gh pr list --state open` scan each sweep.**
- **Pros:** No persisted state; trivially survives restarts.
- **Cons:** Cannot honor "only `done` features" — it would consider PRs from halted/failed features
  and human-authored PRs, with no provenance signal. Over-broad; would mislabel.

**Option B (chosen): Per-repo tracked watch registry + recurring reconcile sweep.**
- Append `{prUrl, slug, repoCwd}` to a per-repo `.daemon/mergeable-watch.jsonl` when a feature
  ships `done` with a PR. The sweep reads the registry, re-derives each PR's *current* truth from
  GitHub, reconciles the label, and self-prunes merged/closed/gone PRs.
- **Pros:** Honors "only `done`"; bounded + self-pruning; survives restart; the registry tracks only
  *which* PRs to watch — never their state, which is always re-read from GitHub, so a lost/corrupt
  registry degrades to "no labels," never "wrong labels."
- **Cons:** A new persisted per-repo file; enrollment must be wired at the `done` outcome.

**Option C: Reuse the engineer signals store (already records `prUrl` + `outcome`).**
- **Pros:** No new file.
- **Cons:** Cross-project, append-only *history* that grows unbounded; mixes triage state into a
  retro-signal log; awkward to prune. Wrong ownership.

### Boundary / resilience

- All `gh` interaction for both behaviors goes through a single new seam, `pr-labels.ts`, exposing
  injected-runner primitives (`ensureLabel/addLabel/removeLabel/prMergeState/findOrCreatePr/
  comment/setReady`). Every primitive is internally try/caught and non-throwing.
- Cadence: the sweep runs on **daemon startup reconciliation**, **after each feature**, and **once
  per poll/loop tick** — no new timer thread; it piggybacks existing daemon cadence so late-CI
  completion is still caught while idle.

## Decision

Adopt **Option B** for `mergeable`, behind a **single best-effort `gh` seam (`pr-labels.ts`)** shared
by both labels and by FR-16 clear-on-success. Rationale: Option B is the only one that satisfies the
"only `done`" constraint while staying bounded and self-healing; re-deriving label truth from GitHub
each pass (registry = *which*, GitHub = *state*) makes the mechanism idempotent and failure-tolerant.
The single seam isolates the external boundary to one mockable, uniformly-swallowing module,
matching the existing injected-`GhRunner` convention rather than introducing a new integration style.

`needs-remediation` surfacing hooks into `Conductor.run()` **after** the HALT + state writes
(preserving ADR-013 halt classification), and FR-16 clear-on-success runs at the `done` enrollment
point in `daemon-runner.ts` (where outcome + `pr_url` are known), both through the same seam.

## Consequences

### Positive
- Human can filter daemon PRs by `needs-remediation` / `mergeable`; both labels stay truthful.
- One mock point and one swallow policy for all GitHub side effects → simple, well-isolated tests.
- No new external system, container, DB table, or background framework; no new timer.
- A lost/corrupt watch registry fails safe (no labels), never asserts a wrong `mergeable`.

### Negative
- A new per-repo persisted file (`.daemon/mergeable-watch.jsonl`) to maintain and prune.
- `done` PRs that are never merged accumulate in the registry until closed (bounded but non-zero);
  one `gh pr view` per tracked PR per tick is the ongoing cost.
- Three new call sites (Conductor build-failure hook, daemon-runner enroll/clear, daemon-loop sweep)
  must each preserve best-effort semantics.

### Follow-up Actions
- [ ] Implement `pr-labels.ts` with injected runners + non-throwing primitives.
- [ ] Wire `needs-remediation` after HALT/state writes in `Conductor.run()` (auto + build only).
- [ ] Enroll `done` PRs + FR-16 clear-on-success in `daemon-runner.ts`; call the sweep on startup +
      per-feature + per-tick.
- [ ] Self-prune the registry on MERGED/CLOSED/404; keep reconciliation idempotent.
- [ ] (Optional, deferred) cap registry age/size if it grows unexpectedly — log any drop.
