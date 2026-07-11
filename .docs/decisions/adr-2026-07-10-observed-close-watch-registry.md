# ADR: Observed-close — watch registry + idle-tick sweep replaces close-on-merge for watched fixes

**Date:** 2026-07-10
**Status:** APPROVED
**Feature:** Issues close on first production observation of the fixed behavior (#492)
**Related:** #462 (wiring gate — spec-time half of the same principle), #482 (merge/engine-vintage race), #452→#477 (trigger never exercised), #460→#461 (partial wiring)

## Context

An issue describes a *behavior*; today it closes on an *artifact* event. The sole close
mechanism is the `Closes owner/repo#N` trailer the daemon injects into the implementation
PR body after `conductor.run()` (`src/daemon-cli.ts` post-run block →
`closeIssueOnImplementationMerge`, `src/engine/engineer/issue-ref.ts`) — GitHub then
auto-closes the issue at merge. Nobody calls `gh issue close` anywhere in the engine
(verified). 2026-07-10 produced three same-day counterexamples where "fixed" was false at
close time (#452/#477, #460/#461, #482): **merged ≠ loaded ≠ exercised**.

Operator-locked decisions (2026-07-10, interactive DECIDE):

- Signature declaration is **mandatory per fix**, with `close-on-merge` as a legal declared
  value (+ one line of rationale) for inherently unobservable fixes.
- **Universal engine machinery, per-fix scoping** — no per-project config gate.
- Approach A (durable registry + sweep) over a live event-bus subscriber (converges to A
  plus coupling: the observation usually lands in a later daemon session) and over an
  external tmux monitor (halt-monitor precedent: dies silently).

## Decision

### 1. Spec-time declaration: `.docs/observation/<plan-stem>.md`

A new committed artifact, authored during DECIDE (engineer flow), sibling to
`.docs/complexity/<plan-stem>.md` and stem-matched to the plan:

```
Signature: <substring or /regex/ the fixed behavior emits>   # or: close-on-merge
Surface: daemon-log                                          # v1 sole surface; field reserved for future surfaces
Window-days: 14                                              # bounded no-show window
Rationale: <required when Signature: close-on-merge>
```

`engineer land` asserts the file exists and is well-formed (parseable `Signature:` line;
`Rationale:` required for close-on-merge) for every spec it lands — same fail-closed
posture as the complexity/tier-artifact gate.

**v1 surface is `daemon-log` only.** `renderDaemonEvent` (`src/daemon-cli.ts`) already tees
every `ConductorEvent` into `.daemon/daemon.log` as a rendered line, and per-worktree
`.pipeline/events.jsonl` files are destroyed at worktree teardown — the repo-durable log is
the only surface that survives to observation time (verified: `daemon-log.ts`,
`event-persister.ts` wiring). Signatures over typed events are expressed as patterns over
their rendered log lines; a structured `events` surface can be added later without schema
change (the `Surface:` field exists from day one).

### 2. Ship-time enrollment: conditional trailer at the existing injection site

At the `daemon-cli.ts` post-run block, `closeIssueOnImplementationMerge` gains the marker as
input (read from the build worktree's `.docs/observation/<plan-stem>.md`):

- Marker absent (legacy specs) or `Signature: close-on-merge` → **unchanged**: inject
  `Closes` (GitHub auto-close on merge).
- Signature declared → inject `Refs` (non-closing link, PR↔issue linkage preserved) and
  **enroll** `.daemon/observation-watch.jsonl` with
  `{v: 1, sourceRef, prUrl, slug, signature, surface, windowDays, enrolledAt}`.

Enrollment reuses the mergeable-watch registry idioms (`src/engine/mergeable-sweep.ts`):
append-only JSONL, `mkdir -p .daemon`, best-effort/non-throwing, malformed lines skipped on
read, registry rewritten with survivors after each sweep. Entries carry an explicit `v: 1`
schema tag (the mergeable registry's silent-normalization lesson applied up front).

### 3. Watch: `sweepObservationWatch` inside `sweepBestEffort`

A third best-effort call in `sweepBestEffort` (`src/engine/daemon.ts`), after
`sweepMergeableLabels` — runs on startup and once per idle tick (~5 s), never throws,
never blocks dispatch. Per-entry state machine:

- **awaiting-merge** — poll PR state via `gh` (same `prMergeState` helper the mergeable
  sweep uses), **throttled to ≥5 minutes per entry** (`lastPollAt` on the entry; the ~5 s
  tick cadence must NOT translate into ~5 s gh calls — GitHub REST budget). PR `MERGED` →
  record `mergedAt`, transition to watching. PR `CLOSED` unmerged → comment on the issue
  ("implementation PR closed unmerged — observation watch cancelled"), prune.
- **watching** — scan `.daemon/daemon.log` **and** `.daemon/daemon.log.1` (single-file
  1 MB rotation, verified `daemon-log.ts`) for the signature, counting only lines whose
  leading ISO timestamp is **after `mergedAt`** — this closes the #482 engine-vintage race
  and neutralizes weak signatures that old code also emitted. Scans are local (no gh
  quota), stateless (full scan of ≤2 MB, no cursor), throttled to ≥60 s per entry.
  - **First match** → `gh issue close <ref>` with a comment quoting the matched line +
    timestamp ("observed in production: `<line>`"), prune. Close failure → entry survives,
    retried next tick (idempotent: already-closed issue → prune).
  - **`enrolledAt + windowDays` exceeded with no match** → comment + add
    `observation:no-show` label (REST via `gh api` — `gh issue edit --add-label` is broken
    against Projects-classic repos, PR #172 precedent), **issue stays OPEN**, prune. The
    no-show is the green-but-unwired alarm (#462) — it must be loud, never a silent close.

### 4. What does NOT change

- Spec PRs keep their non-closing `Refs` (engineer handoff) — untouched.
- Hand-authored specs (no `sourceRef`) — untouched (`no-source-ref` early return).
- Halted builds (no `pr_url`) — untouched (`no-pr-url` early return).
- Filing and merging operator flows — zero new steps; the marker is authored by the
  engineer DECIDE flow, not by the operator.

## Consequences

- Closing an issue now asserts *exercised*, not *merged*; the distinct no-show terminal
  makes "shipped but never fired" visible instead of silently closed (#462's runtime half).
- One more committed artifact per spec + a land-gate check; legacy specs (no marker) are
  grandfathered to close-on-merge, so nothing already in flight breaks.
- The daemon gains its second `.daemon/*.jsonl` watch registry; both follow the same
  best-effort sweep idioms — a future consolidation is possible but not required.
- A daemon that never runs again (repo abandoned) never closes nor flags the issue — the
  watch is only as alive as the daemon; acceptable, since the daemon is production here.
- gh usage is bounded: ≤1 PR-state poll per entry per 5 min while awaiting merge; ≤2 calls
  total at close (close + comment) or no-show (comment + label).

## Alternatives considered

- **Live `ConductorEventEmitter` subscriber** — rejected: observation typically occurs in a
  later daemon session than the ship, so durable registry + replay is needed anyway; also
  misses daemon.log lines that aren't typed events.
- **External tmux monitor** — rejected: halt-monitor precedent dies silently; an invisible
  watcher whose job is "was it observed" is self-defeating; duplicates sweep machinery.
- **Per-worktree `.pipeline/events.jsonl` as a v1 surface** — rejected: destroyed at
  worktree teardown, before observation time for the common case.
- **Per-project config gate** — rejected by operator: per-fix signature already scopes
  naturally; consumer-app fixes declare close-on-merge.
