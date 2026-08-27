# Stories: Runnable example scripts for every conduct-ts flow (#786)

Track: technical
Tier: M
Status: Accepted

Scope: an `examples/` directory demonstrating each conduct-ts flow at S/M/L prompt tiers.
Eval/regression-runner is out of scope (#807). Acceptance criteria live here (no PRD).

---

## Story 1 — examples/ scaffolding and README

As an operator, I want an `examples/` directory with a README indexing every scenario,
so I can discover what each demonstrates and how to run it.

**Happy path**
- Given a clean checkout,
- When I open `examples/README.md`,
- Then it lists all five scenarios (inline, interactive, daemon, engineer, intake-loop),
  each with its command, whether it is headless self-asserting or a guided launcher, its
  completion checkpoint, and the `./<flow>.sh [s|m|l]` invocation.

**Negative path**
- Given I run `examples/inline.sh --help` (or an unknown tier like `examples/inline.sh xl`),
- When the script starts,
- Then it prints usage (valid tiers `s|m|l`) and exits non-zero without running any flow.

---

## Story 2 — shared sandbox + prompt library (lib/common.sh)

As an example author, I want a shared `lib/common.sh`, so every scenario isolates state and
resolves prompts identically.

**Happy path**
- Given any scenario sources `lib/common.sh` and calls `sandbox_up`,
- When the flow runs,
- Then `HOME`, `AI_CONDUCTOR_REGISTRY`, and `AI_CONDUCTOR_ENGINEER_DIR` point at a throwaway
  root and the flow's project root is a fresh `git init` under that root, so the operator's
  real registry, engineer store, `.daemon/`, `.worktrees/`, and `.pipeline/` are untouched;
- And on exit an `EXIT` trap runs `sandbox_down`, removing exactly the one throwaway path
  it created (never a glob).

**Negative path**
- Given a flow exceeds its per-example timeout (e.g. a daemon wedge),
- When the timeout fires,
- Then `common.sh` kills the flow, prints `FAIL <flow>/<tier>: timeout`, runs `sandbox_down`,
  and exits non-zero — the wedge is captured, not left hanging.

---

## Story 3 — tiered prompt fixtures

As an operator, I want `prompts/{small,medium,large}.md`, so I can drive a flow at a chosen
complexity tier.

**Happy path**
- Given `examples/prompts/small.md`, `medium.md`, `large.md` exist,
- When a scenario resolves its prompt,
- Then a tier arg (`./inline.sh medium`) selects `prompts/medium.md`; with no arg on a TTY
  the script asks `Which prompt? [s/m/l]` and uses the choice; the prompt text is passed
  into the flow in that flow's expected role (feature vs idea).

**Negative path**
- Given no tier arg and no TTY (piped/non-interactive),
- When the script resolves the prompt,
- Then it errors with usage and exits non-zero — it never silently defaults to a tier.

---

## Story 4 — inline flow example (headless, self-asserting)

**Happy path**
- Given `./examples/inline.sh medium`,
- When it runs `conduct-ts inline "<medium prompt>" --auto` in the sandbox,
- Then on reaching the DONE marker (`feature_complete`) it prints `PASS inline/medium` and
  exits 0.

**Negative path**
- Given the inline flow ends without a DONE marker,
- When the script checks the checkpoint,
- Then it prints `FAIL inline/<tier>: no DONE marker` and exits non-zero.

---

## Story 5 — interactive flow example (guided launcher)

**Happy path**
- Given `./examples/interactive.sh large`,
- When it runs,
- Then it calls `sandbox_up`, prints the completion checkpoint to watch for, and `exec`s
  `conduct-ts inline "<large prompt>" --interactive` with stdio inherited so a human drives
  the REPL.

**Negative path**
- Given `conduct-ts` is not on `PATH`,
- When the launcher starts,
- Then it prints a clear "conduct-ts not found" error and exits non-zero before exec.

---

## Story 6 — daemon flow example (headless, seeded fixture)

**Happy path**
- Given `./examples/daemon.sh small` seeds a fixture spec (stories+plan) into the sandbox
  repo,
- When it runs `conduct-ts daemon` (drain once),
- Then on the feature reaching DONE (and a `pr_url`/`local-commit` recorded) it prints
  `PASS daemon/small` and exits 0.

**Negative path**
- Given the daemon drains with the feature not reaching DONE,
- When the script checks the checkpoint,
- Then it prints `FAIL daemon/<tier>: feature did not reach DONE` and exits non-zero;
  no PR is opened against the real remote.

---

## Story 7 — engineer flow example (headless primitives + guided full loop)

**Happy path (headless)**
- Given `./examples/engineer.sh medium` seeds a fixture `.docs/` artifact set,
- When it runs `engineer worktree → land → handoff` in the sandbox,
- Then on `handoff` returning `pr-opened` (or `local-commit` with no remote) it prints
  `PASS engineer/medium` and exits 0; the real engineer store and registry are untouched.

**Happy path (guided)**
- Given `./examples/engineer.sh medium --interactive`,
- When it runs,
- Then it is a guided launcher that execs the real `conduct-ts engineer` loop with stdio
  inherited after sandbox setup.

**Negative path**
- Given `land` rejects the fixture (e.g. a DRAFT ADR or missing stories),
- When the script runs,
- Then it prints `FAIL engineer/<tier>: land rejected — <reason>` and exits non-zero,
  surfacing the guard message.

---

## Story 8 — intake-loop flow example (headless, seeded queue)

**Happy path**
- Given `./examples/intake-loop.sh small` seeds a fixture issue set for the sandbox
  engineer store,
- When it runs `conduct-ts intake-loop --once`,
- Then on `intake-status.json` being written it prints `PASS intake-loop/small` and exits 0;
  no `claude` is spawned and no PR is opened.

**Negative path**
- Given the poll writes no `intake-status.json`,
- When the script checks the checkpoint,
- Then it prints `FAIL intake-loop/<tier>: no intake-status.json` and exits non-zero.
