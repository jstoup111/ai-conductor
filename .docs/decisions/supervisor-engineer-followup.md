# Phase 9 — Supervisor / Engineer (followup design)

**Date:** 2026-06-25
**Status:** Proposed (design only — no implementation in this doc)
**Predecessor:** Phases 0–7 (gate-driven loop + daemon, validated end-to-end in
`.docs/phase7-daemon-validation.md` — scenarios C single-feature and D concurrent
both passed). Phase 8 (custom steps/phases as gates) is a separate followup.

---

## 1. Vision

A centralized, **non-autonomous** planning "engineer" that authors specs and spins up
projects, with a per-project daemon shipping each project's backlog. The engineer is
the **backlog producer** the daemon was deliberately built to receive (the daemon
*consumes* specs, never authors them — locked decision). A retro→engineer feedback
loop turns the system into a **self-improvement flywheel**: ship → retro → engineer
learns → better plans → cleaner ships.

```
                ┌────────────────── ENGINEER (supervisor) ──────────────────┐
                │  PLAN phase (human-gated)   cross-project governor      │
   human ◄──────┤  project registry + creation   retro aggregation/memory │
   review gate  └───────┬───────────────┬───────────────┬─────────────────┘
                        │ specs+project  │ specs+project │ specs+project
                   ┌────▼────┐      ┌────▼────┐     ┌────▼────┐
                   │ daemon  │      │ daemon  │     │ daemon  │   (per project)
                   │ worktrees│     │ worktrees│    │ worktrees│
                   └────┬────┘      └────┬────┘     └────┬────┘
                        └── retro signals ┴── up to engineer ┘  (the flywheel)
```

## 2. Non-negotiables (carried from prior decisions)

- **Engineer is NOT fully autonomous.** A human approval gate sits between
  "engineer authored a PRD/plan" and "daemon starts building." The engineer proposes;
  a human approves the spec before any daemon touches it. (Highest-judgment phase;
  gates protect execution correctness, not requirements correctness.)
- **Daemon consumes, never authors.** Unchanged.
- **Never auto-merge.** The daemon hands humans clean, rebased, still-green PRs.
- **Harness self-edits are gated.** See §5 — retro→engineer may *propose* harness
  changes (as PRs through the existing validation/PR/no-auto-merge gates), never
  auto-apply them.

## 3. Near-term, independently shippable: rebase-on-latest + conflict handling (Phase 9.0)

This is a **daemon-correctness** issue independent of the engineer — it bites the
moment two real features touch overlapping code (scenario D passed only because
its two features were disjoint). Ship this first, on its own.

**Problem.** A worktree forks from `main` at spin-up and never reconciles. A long
build races a `main` that other merged PRs have advanced, so the branch goes stale
and its PR conflicts at human-merge time (or built against a base missing a
dependency).

**Design — reuse the loop's existing machinery. "`main` advanced" is just an
external invalidation, the same shape as a kickback:**

- Before `finish` (after build + manual_test are green), `git fetch` + rebase the
  worktree branch onto latest `main`.
- **Clean rebase** → re-run build/manual_test against the new base (a rebase can
  change files and break green) — the loop already re-verifies on a kickback —
  then open the PR.
- **Conflict, or post-rebase gates fail** → write `.pipeline/HALT` for a human,
  worktree kept (the validated park-for-human pattern). Never auto-resolve a
  non-trivial merge.
- Keeps **never-auto-merge** intact: the daemon's job becomes "always hand the
  human a clean, rebased, still-green PR."

**Insertion point:** the loop tail (around `finish`) / `daemon-runner`. Testable in
isolation — no engineer, no UI, no registry.

## 4. Followup: engineer stack (Phases 9.1–9.4)

These hang together and are a genuinely separate, larger effort.

### 9.1 Structured retro signal + engineer memory (the flywheel plumbing)
Partly buildable now — the hard signals already exist per-feature.
- Daemon completion (done **or** halted) emits a **structured** retro signal up to
  the engineer (not project-local prose): kickbacks (with reason/evidence), HALTs
  (gate + why), retry hotspots, `conduct --report` telemetry (durations, token
  spend) — plus the retro's human-judgment narrative as the interpretation layer.
- Engineer accumulates these into a **cross-project memory store** (the `.memory/`
  concept lifted to engineer level).
- Engineer **reads that memory at PLAN time** for the next project. This closes the
  loop — a retro that never re-enters a future plan is just a diary.
- **Measurability:** track whether kickback/halt/retry rates fall across successive
  projects. If they don't, the engineer is accumulating noise, not learning.

### 9.2 Project registry + creation
- A manifest (project path, repo/remote, status, budget, daemon state, last retro
  signal) the supervisor reads/writes.
- "Create a new project" lives here: scaffold (git init, bootstrap `CLAUDE.md`,
  set remote, seed `.gitignore` with `.pipeline/`/`.daemon/`/`.worktrees/`) →
  register → enqueue.

### 9.3 Supervisor mode + cross-project governor
- New run mode (`--supervisor` / a `engineer` entry) alongside `--daemon`.
- Runs DECIDE-with-human-gate; spawns and feeds per-project daemons.
- **Owns the cross-project rate-limit + token-budget governor.** The Claude rate
  limit is account-global; N independent daemons would contend blindly. Centralize
  it here — a shared broker all daemons defer to. (Strong argument for **one
  supervisor process with project-scoped workers** over N independent OS daemons;
  worktree-level isolation, already validated, gives the isolation without the
  coordination tax. Choose N independent processes only for hard fault domains or
  multi-host scale.)

### 9.4 Multi-project UI
- Lift the existing event/dashboard system from one feature to N projects × N
  features. Biggest single chunk and most deferrable — the registry + structured
  logs give a CLI view long before a UI is worth it.

## 5. Retro→engineer: two targets, asymmetric risk

| Target | What it improves | Risk | Loop |
|--------|------------------|------|------|
| **Engineer's planning** | "plans shaped like X kick back / halt / rework" | Low — just context the engineer reads at PLAN time | Autonomous |
| **The harness itself** | gates, skills, model tiers | **High — propagates to every project at once** | **Propose-only:** open a harness PR through existing validation + PR + no-auto-merge gates; human approves |

## 6. Sequencing

1. **9.0 Rebase-on-latest + conflict→HALT** — near-term daemon PR; land before
   running daemons on real overlapping features.
2. **9.1 Structured retro signal + engineer memory** — flywheel plumbing (signals
   already exist).
3. **9.2 Registry + project creation.**
4. **9.3 Supervisor mode + cross-project governor.**
5. **9.4 UI.**

## 7. Open questions

- **Spec approval UX** — how does the human gate present a PRD/plan for approval
  (CLI diff? UI? PR-style review on the spec itself)?
- **Engineer memory schema** — minimal structured fields for a retro signal so it's
  aggregable, not prose. (Candidate: `{project, feature, outcome, kickbacks[],
  halts[], retryHotspots[], tokens, durationByStep, narrative}`.)
- **One supervisor process vs N daemons** — default to one supervisor + worktree
  workers; revisit only for multi-host scale.
- **Rebase cadence** — once before `finish`, or also opportunistically mid-build
  when `main` advances? (Start with once-before-finish.)
- **Project isolation boundary** — separate repos per project, or a monorepo with
  per-project subtrees? Affects registry + worktree forking.
- **Self-improvement guardrail** — what regression in kickback/halt rate triggers
  a human review of the engineer's accumulated memory?

## 8. Out of scope for Phase 9

Fully autonomous planning (no human spec gate); auto-merge; auto-applied harness
self-edits; backlog sources beyond engineer-authored + existing-artifact features.
