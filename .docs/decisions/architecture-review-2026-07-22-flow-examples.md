# Architecture Review: flow-examples (#786)

Date: 2026-07-22
Tier: M (lightweight review)
Verdict: APPROVED for stories/plan

## Scope reviewed

The examples-only deliverable: an `examples/` directory with one script per flow, a shared
`lib/common.sh`, tiered `.md` prompts, and fixtures for the daemon/engineer flows. The
eval/regression runner is explicitly out of scope (#807).

## Feasibility

- **Grounded entrypoints.** Every flow's command, headless capability, and completion
  checkpoint is confirmed in source (see architecture doc table). No guesswork about how a
  script reaches a checkpoint.
- **Isolation seams already exist.** `AI_CONDUCTOR_REGISTRY`, `AI_CONDUCTOR_ENGINEER_DIR`,
  and repo-relative `.daemon/`/`.worktrees/`/`.pipeline/` under a throwaway root cover all
  shared state without new production code. `AI_CONDUCTOR_NO_REAL_EXEC` exists but is a
  test-only block; examples use real `conduct-ts`, so they must NOT set it.
- **Fixtures are bounded.** The daemon example needs a merged-spec fixture (stories+plan);
  the engineer example needs a `.docs/` set to land. Both are static committed fixtures.

## Risks & mitigations

- **R1 — an example mutates real state.** Mitigated by ADR examples-state-isolation
  (throwaway HOME/registry/engineer-dir + `git init` root, `EXIT`-trap teardown scoped to
  one path, never a glob — aligns with the repo's no-bulk-delete safety rule).
- **R2 — a headless example wedges (daemon `no_task_progress`, `git worktree add` 128).**
  Mitigated by a per-example timeout in `common.sh`; on timeout the script prints
  `FAIL <flow>/<tier>: timeout` and tears down — the wedge is captured, not hung.
- **R3 — interactive examples can't self-verify.** Accepted by ADR headless-vs-guided:
  they are guided launchers, not asserted.
- **R4 — GitHub side effects from daemon/engineer.** Examples target the sandbox store /
  a `--repo` fixture and never push to the real remote; the no-remote `local-commit`
  fallback (`engineer-cli.ts:891`) is an acceptable engineer checkpoint for a demo.

## Alignment

Consistent with the harness Design Principle (deterministic where possible): the examples
drive real CLIs and assert real checkpoint artifacts rather than trusting self-reports. No
conflict with existing skills or CLI surface (adds files under a new `examples/` dir only).

## ADRs (all APPROVED)

- `adr-2026-07-22-examples-state-isolation.md`
- `adr-2026-07-22-headless-vs-guided-examples.md`
