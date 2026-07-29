# Architecture Review: Deferred Feature-Worktree Reap (#1091)

**Date:** 2026-07-29
**Mode:** lightweight (Medium tier — Sections 2 and 4 only)
**Input reviewed:** issue #1091 desired outcomes, `.memory/decisions/daemon-reaps-a-feature-worktree-at-pr-open-before-.md`, `.docs/architecture/daemon-reaps-a-feature-worktree-at-pr-open-before-.md` (+ its sequence)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | No new dependency. The gate is one `git fetch` plus one `git cat-file -e` via the existing `execa` usage; PR state already comes from `prMergeState` in `pr-labels.ts`. |
| **Prerequisites** | None. `teardownWorktree` exists and is already injected as a daemon dep; `WatchEntry` already carries `{prUrl, slug, repoCwd}`, so the sweep can resolve `.worktrees/<slug>` with no registry schema change. |
| **Integration surface** | Three modules: `daemon-runner.ts` (delete a call), `mergeable-sweep.ts` (new terminal-state branch + gate), plus the CLI/dashboard surface for reclaim. Under the 3-boundary flag. |
| **Data implications** | None. No schema, no migration. `.daemon/mergeable-watch.jsonl` entries are unchanged in shape. |
| **Performance risk** | One extra `git fetch` + `cat-file` per MERGED watch entry per sweep — bounded by registry size, which is already capped (`mergeable-watch-registry-size-cap`). Negligible. |
| **Worktree isolation** | The change *increases* concurrent worktree count by ~1 per in-flight PR. `.worktrees/resolve-<slug>` stays disjoint by prefix, so no path collision. See the Gate 6 condition below for the non-disk interaction. |

**Feasibility verdict:** feasible. This is a relocation of an existing call plus one new deterministic
check — squarely inside the repo's "deterministic where possible" principle, with no LLM judgement in
the path.

## Alignment

**Against `.docs/decisions/`:**

- `adr-2026-07-03-committed-shipped-record-dispatch-dedup` — **aligned, and reinforced.** The design
  adds a second reader of the same committed record. The runner's PR-head-scoped
  `evaluateShipmentEvidence` is untouched; the new check is main-scoped and lives in the sweep.
- `adr-2026-07-27-ancestry-proven-park-reconciliation` — **not violated** (different flow, parked
  features, its own guarded helper), but see Drift Note 1: its ancestry predicate is measurably
  unreliable for squash-merged branches.
- `adr-2026-07-04-resolution-worktree-lifecycle` rule 3 — **conflict.** Escalated and resolved by
  operator decision; see Conditions.
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep` — aligned; the sweep taking on one more
  terminal-state responsibility follows the same consolidation direction.

**Against `CLAUDE.md`:**

- Design Principle (deterministic over prose) — **satisfied, and this is the point of the feature.**
  Daemon Operations Safety rule 3 is currently enforced only as operator prose; this converts the
  PR-open-to-merge window of it into machinery.
- Daemon Operations Safety rule 1 (never bulk-delete worktrees) — **satisfied.** The reclaim verb is
  single-slug, prints the path, and accepts no glob or computed set.

**Pattern consistency:** the reap gate follows the established shape of the repo's other
record-on-main preconditions (cf. `adr-2026-07-27-…` rule 4, which likewise requires
`.docs/shipped/<slug>.md` on the base branch before any destructive step). The new operator verb
follows `daemon park|unpark|reconcile-parked` precedent, including the `bin/conduct`
known-subcommand forwarding requirement.

**State management:** terminal PR state moves from a two-valued treatment (MERGED|CLOSED → prune) to
three distinct dispositions (MERGED-with-record → reap; MERGED-without-record → retain and recheck;
CLOSED-unmerged/NOTFOUND → retain and mark reclaimable). This makes a previously conflated state
explicit rather than adding a boolean flag — the right direction.

**Security boundaries:** no new endpoint, no new user input. The one destructive capability
(`reclaim-worktree`) is operator-invoked, single-slug, and reuses the existing teardown primitive.

**Diagram accuracy:** `.docs/architecture/daemon-reaps-a-feature-worktree-at-pr-open-before-.md` and
its sequence were corrected during this review — both originally claimed retained worktrees do not
collide with remediation. That claim was false for rebase-resolution and now carries the Gate 6
caveat.

## Wiring Surface

| New/changed production surface | Where it is called from in production |
|---|---|
| Shipped-record-on-main gate (new helper, e.g. `shippedRecordOnMain(repoCwd, slug)`) | Invoked from `sweepMergeableLabels`' per-entry loop in `mergeable-sweep.ts`, on the `state === 'MERGED'` branch, before any teardown. |
| Reap call `teardownWorktree(wt, false)` | Moves from `daemon-runner.ts` `outcome.done` to the same `mergeable-sweep.ts` MERGED branch. Reached in production via the daemon loop's existing `maybeSweep()` and the idle-tick sweep — no new scheduler. |
| Retain/reap log lines (`retained <slug> — reason: …`, `reaped <slug> — reason: shipped-record-on-main`) | Emitted through the sweep's existing injected `log?.()` and the runner's `featureLog`, both already routed to `daemon.log`. |
| Retained-worktree category on the daemon dashboard | Rendered by `daemon-dashboard.ts`, called from the daemon's startup dashboard and `conduct daemon status`. |
| `conduct daemon reclaim-worktree <slug>` | Dispatched from `conduct-ts`'s daemon subcommand table, detected pre-boot beside `daemon park|unpark|reconcile-parked`, and added to the `bin/conduct` known-subcommand forwarding list (per the unknown-subcommand guard stories). |

## Early Overlap Scan

`conduct-ts overlap-scan` over the Wiring Surface paths — advisory, non-blocking. Known unmerged
work touching this feature area, carried forward from DECIDE research:

- **PR #1146** — dispatch preflight refusing dispatch into a missing working directory, plus
  shipped-record-on-feature-branch dedup, in `daemon-backlog.ts` / `daemon-work-source.ts`.
  Complementary: it does not change reap timing. The plan must not duplicate its preflight nor
  re-edit those two files.
- **#564 / PR #770** — relocate run-state out of the worktree (size L, spec PR unmerged). Orthogonal
  remedy for the same loss class; considered and rejected as a substitute (see the ADR's option B).
- **#1116** — `conduct-state` recovery, v1.0. Adjacent to the retained-artifact list; no file overlap
  expected.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Rebase-resolution suppressed on all open PRs by Gate 6 | Integration | **Certain** | High | Descoped to #1150 by operator decision; CI-fix remediation unaffected; conflicted PRs resolved manually in the interim |
| Transient `git fetch` / `gh` failure defers a reap indefinitely | Technical | Low | Low | Gate re-evaluated every sweep; failure retains rather than deletes (fail-open toward safety); log line names the reason |
| Retained worktrees accumulate faster than operators reclaim them | Data | Medium | Low | Dashboard category makes them visible; measured baseline (68 dirs / 105 registered) shows this is not the dominant driver; deliberately no cap |
| Shipped record legitimately absent on main after squash-merge (record never committed by finish) | Data | Low | Medium | Falls through to retain, not reap — degrades to today's manual state, never to silent evidence loss |
| Reclaim verb misused against a live feature | Technical | Low | High | Single-slug only, path printed before removal; plan should add an in-flight `.pipeline` run guard mirroring `adr-2026-07-27-…` rule 5 |

## Drift Notes

1. **`adr-2026-07-27-ancestry-proven-park-reconciliation` rule 3** makes
   `git merge-base --is-ancestor` the sole deletion authority for parked-feature reconciliation. The
   #1138 measurement in this feature's ADR shows that predicate returns false for squash-merged
   branches, so that sweep likely never classifies anything as `merged`. Not in scope for #1091 and
   not repaired by it; recorded here so it is not lost.

## ADRs Created

- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md` — `Status: APPROVED`
  (operator-confirmed 2026-07-29; approach A selected, B and C rejected with rationale).

None superseded.

## Conditions

1. **#1150 must be tracked as the paired repair.** Shipping #1091 knowingly suppresses automatic
   rebase-resolution via `isEligibleForResolve` Gate 6 (`autoresolve.ts:216-226`), which implements
   rule 3 of APPROVED `adr-2026-07-04-resolution-worktree-lifecycle`. The operator was presented
   with retire-the-gate / replace-with-liveness-check / descope options on 2026-07-29 and chose
   descope. #1150 owns superseding or amending that ADR. **This ADR does not amend it** — until
   #1150 lands, an APPROVED ADR asserts a rule whose intent the code no longer serves.
   **#1150 is milestoned v1.1 while #1091 is v1.0** (operator decision, 2026-07-29), so v1.0 ships
   with automatic rebase-resolution suppressed on open implementation PRs and conflicted PRs
   resolved by hand. That is the accepted trade, recorded here so it is not later read as a defect.
2. **The reclaim verb must carry an in-flight guard.** `/plan` must include a task refusing
   reclamation of a slug whose `.pipeline/` belongs to an in-progress run, mirroring
   `adr-2026-07-27-ancestry-proven-park-reconciliation` rule 5 and the `mid-loop-pipeline-wipe-549`
   audit ("parked ≠ no live run").
3. **No duplication of PR #1146's dispatch preflight.** If #1146 merges first, `/plan`'s tasks
   touching `daemon-backlog.ts` / `daemon-work-source.ts` must be rebased onto it rather than
   re-implementing the missing-working-directory check.
4. **Documentation upkeep in the same PR.** New daemon operational behavior →
   `docs/guides/running-the-daemon.md`; new CLI verb → `docs/reference/cli.md`; the recovery change
   → the affected runbook under `docs/runbooks/`.

## Blocking Issues

None outstanding. One conflict was found (Condition 1), escalated to the operator per §9 rather than
auto-resolved, and closed by explicit decision.
