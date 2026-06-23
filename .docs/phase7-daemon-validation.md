# Phase 7 — Gate-Loop & Daemon Validation Runbook

End-to-end validation of the gate-driven loop + daemon (PRs #73–#75). This is the one
part that must be **run for real** — it spawns Claude sessions, creates worktrees, and
opens PRs. Run A→E in order; only flip the daemon to **continuous** after all pass.

## Prereqs

```bash
cd src/conductor && npm run build && cd ../..
./bin/install            # refresh the conduct-ts symlink
```

- Be in a git repo (the target project) with at least one feature that has BOTH
  `.docs/stories/<slug>.md` and `.docs/plans/<slug>.md` authored. For a parallel test,
  have two.
- `gh` authenticated (the daemon opens PRs).

> Note: `verifyArtifacts` is **on by default** for `conduct-ts`, so the gate loop already
> engages at `build` on a normal run — no flag needed for A/B.

---

## A. Single-feature convergence (no daemon)

```bash
conduct-ts --auto "<your feature>"
```

**Expect:**
- The tail runs `build → manual_test → retro → finish` driven by the selector.
- A `✓ gate loop converged` line (TerminalRenderer) and `.pipeline/DONE` written.
- `.pipeline/gates/build.json`, `manual_test.json`, … exist as `{ "satisfied": true, … }`.
- `feature_complete` fires; a PR exists (`gh pr view`).

**Red flags:** loop never converges (a gate's verdict stays false → check the predicate);
the run marks complete without `.pipeline/DONE`.

---

## B. Kickback routing

Contrive a plan that is missing a task for a story's **negative** path (so the `plan` gate
fails when the loop re-checks), or inject a kickback verdict mid-run:

```bash
# Inject a kickback from build → plan (simulating the build agent finding the plan wrong)
cat > .pipeline/gates/plan.json <<'JSON'
{ "satisfied": false, "checkedAt": 1, "kickback": { "from": "build", "evidence": "AC negative path missing" } }
JSON
```

**Expect:**
- A `↩ kickback: build re-opened plan — … (×1)` line (a `kickback` event).
- The loop routes back to `plan` (state → pending, downstream → stale), re-runs it, then
  rebuilds and continues.
- If the plan genuinely can't cover, the loop stops with `.pipeline/HALT` (a `loop_halt`
  event), capped — it does **not** spin forever.

---

## C. Daemon, single worker

Ensure the feature isn't already shipped (`ls .daemon/processed/`):

```bash
conduct-ts --daemon --concurrency 1 --max-items 1
```

**Expect:**
- `[daemon] ▶ start <slug>` … `[daemon] ✓ <slug> shipped → <PR url>`.
- A worktree was created under `.worktrees/<slug>`, specs were materialized + committed
  there, the loop ran, a PR was **opened (never merged)**, the worktree was **removed**,
  and `.daemon/processed/<slug>` was written.
- Final: `finished: 1 feature(s) (max_items)` with status `done`.

**Halt case:** if the feature can't converge, status is `halted`, the worktree is **kept**
under `.worktrees/<slug>` with `.pipeline/HALT`, and `.daemon/processed/` is NOT written
(so it can be retried after a human fixes it).

---

## D. Daemon, parallel

With two+ eligible features:

```bash
conduct-ts --daemon --concurrency 2
```

**Expect:** two worktrees run concurrently, each with its own `.pipeline/` (verdicts/state/
session) — no cross-interference; PRs **queue** for your manual merge; the run reports each
feature's outcome.

---

## E. Ceilings & isolation

- `--max-items 1` stops after one feature (`stoppedReason: max_items`).
- A feature whose `runFeature` throws is recorded as `error` and the pool **continues** to
  the next (don't let one bad feature stop the batch).
- Confirm no PR was auto-merged anywhere (finish opens PRs only — never merges).

---

## After A–E pass: enable continuous

The daemon currently runs in `once` mode (`runDaemonMode` passes `once: true`). To enable
continuous (idle-poll for new backlog), add a `--continuous` flag:

1. In `cli.ts`: add `--continuous` + `--idle-poll <ms>` options.
2. In `daemon-cli.ts` `runDaemonMode`: when `continuous`, pass `once: false`,
   `idlePollMs`, and a sane `maxIdlePolls` (or omit for indefinite) to `runDaemon`.
3. Guard with a global cost/wall-clock ceiling so an unattended daemon can't run away.

Only do this once A–E are green — an idle-polling daemon on un-validated gates will churn.

---

## Followup (Phase 8) — custom steps/phases as gates

Custom config steps **run** today (the conductor drives `buildStepRegistry`), but they are
not first-class in the gate loop:

- `LOOP_GATE_STEPS` and `KICKBACK_TARGETS` (`engine/conductor.ts`) are **hardcoded** sets.
  A custom step placed in the looped region (after `build`) gets no verdict computed, so
  the selector treats it via step-state only — it runs once, with no re-check or kickback.
- A custom step can't declare itself a **gate** (with a verdict predicate) or a **kickback
  target** (which upstream gates it may re-open).
- There is no notion of a custom **phase** — a custom step inherits its `after` target's
  phase; the four built-in phases (UNDERSTAND/DECIDE/BUILD/SHIP) are fixed.

**Proposed Phase 8 scope:**

1. Let `.ai-conductor/config.yml` mark a step as a gate, e.g.
   `steps.<name>: { after, skill, gate: { check: <cmd|predicate>, kickback_targets: [...] } }`.
2. Derive `LOOP_GATE_STEPS` / `KICKBACK_TARGETS` / the gate-verdict predicate map from the
   resolved config instead of hardcoding them.
3. Optionally allow custom phase labels (display + grouping only, not new gate semantics).
4. Tests: a custom gate step computes a verdict, participates in selection, and can be
   kicked back to.

This is additive and opt-in; the built-in gate set stays the default.
