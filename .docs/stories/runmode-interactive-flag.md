# Stories: runmode-interactive-flag

**Feature:** Wire `--interactive` CLI flag for RunMode (gap §4)
**Date:** 2026-04-18
**Complexity:** Small

---

## Story: Add `--interactive` flag to conductor CLI

As a developer, I want to invoke `conduct --interactive "feature"` so that every conversational step opens a real Claude REPL instead of print mode, giving me full oversight throughout the run.

### Acceptance Criteria

#### Happy Path

- Given the conductor is installed, when I run `conduct --interactive "Add login"`, then `RunMode` is set to `'interactive'` and every conversational step invokes the Claude provider with `interactive: true` (no `-p` flag).
- Given `conduct --interactive` is active, when a step completes normally, then the run continues to the next step (same flow as default mode, but REPL not print).
- Given no flags are passed, when I run `conduct "Add login"`, then `RunMode` remains `'default'` and behavior is unchanged.
- Given `--auto` is passed, when I run `conduct --auto "Add login"`, then `RunMode` remains `'auto'` and behavior is unchanged.

#### Negative Paths

- Given both flags are passed, when I run `conduct --auto --interactive "Add login"`, then the CLI exits immediately with a non-zero code and prints a clear error containing `--auto`, `--interactive`, and `mutually exclusive`.
- Given `conduct --help` is run, when the output is read, then `--interactive` appears with a description explaining it enables REPL mode for every step.

### Done When

- [ ] `conduct --interactive "feature"` executes without error; `RunMode` resolves to `'interactive'` (confirmed by unit test asserting mode derivation in `index.ts:287`)
- [ ] `conduct --auto --interactive "feature"` exits non-zero with a message containing `--auto`, `--interactive`, and `mutually exclusive`
- [ ] `conduct --help` output includes `--interactive` with a description
- [ ] `conduct "feature"` (no flags) still resolves `RunMode` to `'default'` — no regression
- [ ] `conduct --auto "feature"` still resolves `RunMode` to `'auto'` — no regression
- [ ] README.md lines 52–85 accurately describe the flag (manually verified during implementation)
- [ ] All pre-existing tests continue to pass

---

**Status:** Accepted
