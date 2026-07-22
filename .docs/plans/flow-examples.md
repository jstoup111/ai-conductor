# Implementation Plan: Runnable example scripts for every conduct-ts flow (#786)

Track: technical · Tier: M · Stories: `.docs/stories/flow-examples.md`
Scope: examples-only. Eval/regression runner is #807 (out of scope).

All new files live under a new top-level `examples/` directory. Scripts are bash; no new
TypeScript engine code. Examples drive the real `conduct-ts` CLI and MUST NOT set
`AI_CONDUCTOR_NO_REAL_EXEC` (a test-only block).

## Task Dependency Graph

```
T1 ─┬─ T2 ─┬─ T3 ─┬─ T6, T7, T9, T11, T13
    │       └─ T4 ┘
    ├─ T5 ───────── (T6, T7)
    ├─ T8 ───────── T9
    ├─ T10 ──────── T11
    └─ T12 ──────── T13
T6,T7,T9,T11,T13 ─ T14 ─ T15
T16 (independent)
```

---

### T1 — Scaffold `examples/` + placeholder README
Create `examples/` with a placeholder `README.md` (title + "scenarios listed below").
**Dependencies:** none.
**Acceptance:** `examples/README.md` exists; `git status` shows the new dir.

### T2 — `lib/common.sh`: `sandbox_up` / `sandbox_down`
Implement sandbox bootstrap: `mktemp -d` root; export `HOME`, `AI_CONDUCTOR_REGISTRY`,
`AI_CONDUCTOR_ENGINEER_DIR` under it; `git init` a `<tmp>/repo` project root; register an
`EXIT` trap calling `sandbox_down`, which `rm -rf`s exactly the single captured path
(never a glob).
**Dependencies:** T1.
**Acceptance:** sourcing the lib and calling `sandbox_up` then `sandbox_down` in a scratch
shell leaves no residue and never touches `~/.ai-conductor`.

### T3 — `lib/common.sh`: `resolve_prompt`
Given `$1` tier (`s|m|l` / `small|medium|large`) → echo path `prompts/<tier>.md`. No arg +
TTY → prompt `Which prompt? [s/m/l]`. No arg + no TTY → print usage, return non-zero.
Reject unknown tiers with usage.
**Dependencies:** T2.
**Acceptance:** covers all three resolution paths; unknown tier exits non-zero.

### T4 — `lib/common.sh`: `assert_checkpoint`, `run_with_timeout`, PASS/FAIL printer
`run_with_timeout <secs> <cmd...>` kills a wedged flow; `assert_checkpoint` checks a
predicate (file exists / marker present) and prints `PASS <flow>/<tier>` (exit 0) or
`FAIL <flow>/<tier>: <reason>` (exit non-zero); timeout maps to `FAIL ...: timeout`.
**Dependencies:** T2.
**Acceptance:** a passing predicate prints PASS/exit 0; a failing one and a timeout print
FAIL/exit non-zero.

### T5 — Tiered prompt fixtures `prompts/{small,medium,large}.md`
Author three self-contained feature/idea prompts sized S/M/L (e.g. small = a one-function
utility; large = a multi-story feature). Plain markdown, usable as either a "feature"
(inline/daemon) or an "idea" (engineer).
**Dependencies:** T1.
**Acceptance:** three files exist, non-empty, tier-appropriate.

### T6 — `inline.sh` (headless self-asserting)
Source lib; `sandbox_up`; `resolve_prompt`; run `conduct-ts inline "<prompt>" --auto`;
`assert_checkpoint` on the DONE marker.
**Dependencies:** T3, T4, T5.
**Acceptance:** Story 4 happy + negative paths hold.

### T7 — `interactive.sh` (guided launcher)
Source lib; `sandbox_up`; `resolve_prompt`; print the DONE checkpoint to watch for; guard
`conduct-ts` on PATH; `exec conduct-ts inline "<prompt>" --interactive` (stdio inherited).
**Dependencies:** T3, T5.
**Acceptance:** Story 5 happy + negative (missing `conduct-ts`) paths hold.

### T8 — Daemon fixture spec `examples/fixtures/daemon/`
Commit a minimal fixture spec (a `.docs/stories/*.md` + `.docs/plans/*.md`, tier S) the
daemon can drain in the sandbox.
**Dependencies:** T1.
**Acceptance:** fixture has an accepted story + a plan with a dependency line.

### T9 — `daemon.sh` (headless self-asserting)
Source lib; `sandbox_up`; copy the T8 fixture into the sandbox repo; run `conduct-ts
daemon` (drain once) under `run_with_timeout`; `assert_checkpoint` on DONE + recorded
`pr_url`/`local-commit`.
**Dependencies:** T3, T4, T8.
**Acceptance:** Story 6 happy + negative paths hold; no PR opened on the real remote.

### T10 — Engineer fixture `examples/fixtures/engineer/`
Commit a complete landable `.docs/` set (track=technical, complexity, stories Accepted,
plan; ADRs APPROVED if non-S) for `land` to accept.
**Dependencies:** T1.
**Acceptance:** fixture passes the `land` guards by inspection (no DRAFT, stories Accepted).

### T11 — `engineer.sh` (headless primitives + `--interactive` guided)
Default: `sandbox_up`; `engineer worktree`; seed the T10 fixture into the worktree; `land`;
`handoff`; `assert_checkpoint` on `pr-opened`/`local-commit`. With `--interactive`: guided
launch of the full `conduct-ts engineer` loop.
**Dependencies:** T3, T4, T10.
**Acceptance:** Story 7 happy (headless + guided) + negative (land rejected) paths hold.

### T12 — Intake-loop fixture queue `examples/fixtures/intake/`
Provide a seeded intake input for the sandbox engineer store (or a fixture issue list) so
`intake-loop --once` has something to process.
**Dependencies:** T1.
**Acceptance:** seeding the fixture populates the sandbox engineer store.

### T13 — `intake-loop.sh` (headless self-asserting)
Source lib; `sandbox_up`; seed T12; run `conduct-ts intake-loop --once` under
`run_with_timeout`; `assert_checkpoint` on `intake-status.json` written in the sandbox
engineer dir.
**Dependencies:** T3, T4, T12.
**Acceptance:** Story 8 happy + negative paths hold; no `claude` spawned.

### T14 — Finalize `examples/README.md`
Fill the README: per-scenario table (command, mode, checkpoint, `./<flow>.sh [s|m|l]`),
the state-isolation note, and the pointer to #807 for the eval.
**Dependencies:** T6, T7, T9, T11, T13.
**Acceptance:** Story 1 happy path holds; every scenario documented.

### T15 — Repo doc upkeep
Add an `examples/` pointer to root `README.md` and `src/conductor/README.md` (Documentation
Upkeep rule).
**Dependencies:** T14.
**Acceptance:** both READMEs reference the examples directory.

### T16 — CHANGELOG `[Unreleased] → Added`
Add an entry: "examples/ — runnable example script per conduct-ts flow at S/M/L tiers."
**Dependencies:** none.
**Acceptance:** `## [Unreleased]` has the Added bullet; integrity suite passes.
