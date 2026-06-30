# Retro: Daemon PR Labeling

**Date:** 2026-06-29 | **Stats:** 20 tasks, 2 rework cycles, 0 build-time human interventions, 2019 tests passing

## Part A: Harness

- **H-1 (HIGH):** An **orphaned-primitive wiring gap** shipped past per-task TDD AND the intermediate
  evaluator: `mergeable` enroll/sweep were defined + green-unit-tested, but the production builders
  (`daemon-deps.ts makeFeatureRunnerDeps` lacked `projectRoot`/`runGh`; `daemon-cli.ts runDaemon`
  lacked `sweepMergeableLabels`) never wired them — so the whole `mergeable` half would have no-op'd
  in production. Caught only by a manual live-wiring trace before the final gate. This is a
  *recurring* class in this repo (see [[feedback_orphaned_primitives]]). The plan's tasks asserted
  *injected* deps; nothing forced a test that the PRODUCTION builder sets the dep.
- **H-2 (MED):** `/architecture-diagram` emitted a Mermaid block that failed to render on GitHub
  (parens in node labels, `[(...)]` cylinder, unicode `→`, `<branch>`, bracket-labeled `subgraph new`).
  The operator caught it, not the skill — the skill has no Mermaid-safety lint.
- **H-3 (note):** Gates that worked — `conflict-check` surfaced the genuine re-kick→stale-needs-remediation
  state conflict (→ FR-16); the intermediate Sonnet evaluator caught a real FR-13 not-found-pruning bug
  + a truthfulness gap (timed-out checks treated as green); the final Opus evaluator caught a DNS-transient
  mislabel. No calibration change needed — these fired correctly.

**Proposed changes:**
- [ ] H-1: Add a standing rule to `/plan` + `/pipeline`: any feature that introduces an **injected
  dependency** must include a task asserting the **production builder** wires it (a real-entry-point
  test) AND a pipeline grep-gate that the new primitive has a non-test caller on the live path. Mirror
  the existing superseded-symbol grep gate. (Strengthens [[feedback_orphaned_primitives]] from advice
  into a gate.)
- [ ] H-2: Add a Mermaid-safety checklist to `skills/architecture-diagram/SKILL.md` (quote all labels;
  no parens/`()`/unicode-arrows/`<...>` in labels; avoid `[(...)]`; `subgraph id["Title"]` with a
  non-reserved id) + a grep self-check before presenting.

## Part B: Application

- **A-1 (MED):** Not-found vs transient classification (`pr-labels.ts` `NOT_FOUND_PATTERNS`) relies on
  **substring-matching `gh` stderr** — brittle across gh versions/locales. The DNS case is fixed, but a
  future gh message change could mis-prune. Fix → new story: prefer `gh`'s structured error/exit-code
  signal (or `--json` error surface) over English substring matching.
- **A-2 (LOW):** `.daemon/mergeable-watch.jsonl` has **no size/age cap** — unmerged `done` PRs accrue
  until merged/closed (deferred in ADR-015). Fix → new story: add a max-age/size cap with logged drops.
- **A-3 (LOW):** No end-to-end test actually shells `gh` against a scratch repo; all coverage uses fakes.
  Acceptable for unit confidence, but the orphaned-wiring class (H-1) is exactly what a thin e2e smoke
  would have caught. Fix → optional story: one gated smoke test that runs the daemon sweep against a
  throwaway local PR.

**Proposed changes:**
- [ ] A-1 → story: structured gh-error detection for not-found.
- [ ] A-2 → story: watch-registry age/size cap.
- [ ] A-3 → story (optional): daemon-sweep e2e smoke against a scratch repo.

## Part C: Context Efficiency

- **C-1 (LOW):** Verification overlapped — the final Opus evaluator already did an FR-by-FR live-path
  trace (`criteria_uncovered: []`), then `prd-audit` re-traced the same FRs with 2 more agents. When the
  pipeline's final evaluator already covers live-path FR coverage, `prd-audit` could run as a 1-agent
  confirmation. Saves ~1 dispatch per Medium feature.
- **C-2 (LOW):** Full vitest suite (~2019 tests, ~50s) was run at every batch boundary; intermediate
  boundaries could scope to the changed test files and reserve the full suite for the final gate.

**Proposed changes:**
- [ ] C-1: Note in `skills/prd-audit/SKILL.md` that when a pipeline final-evaluator live-path trace
  exists, prd-audit may run as a single confirmation dispatch.
- [ ] C-2: Note in `skills/pipeline/SKILL.md` that intermediate-boundary verification may scope to
  changed test files; full suite at final boundary only.

## Trends
- Orphaned-primitive wiring escape recurs (this repo, multiple Phase-9 features) — still caught, still
  *late*. H-1 proposes converting the standing advice into an actual gate. This is the highest-value
  harness change from this run.
