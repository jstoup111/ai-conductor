# Flow Examples

Runnable, self-asserting examples of each `conduct-ts` flow. Each scenario
spins up an isolated sandbox (a throwaway copy of the project, never the
real repo), runs the flow against a small/medium/large prompt or fixture,
and asserts the flow reached its completion checkpoint.

## State isolation

Every scenario calls `sandbox_up` (`examples/lib/common.sh`) before doing
anything else. This creates a fresh, temporary sandbox directory and copies
in whatever fixture the scenario needs — no scenario ever runs against this
repo's real `.pipeline/`, git state, or branches. The sandbox is torn down
(`sandbox_down` / trap) when the script exits, so runs never leak state
between each other or into your working tree. It is always safe to run
these scripts repeatedly, in parallel, or out of order.

## Scenarios

| Scenario | Command | Mode | Checkpoint | Invocation |
| --- | --- | --- | --- | --- |
| inline | `conduct-ts inline "<prompt>" --auto` | headless, self-asserting | `feature_complete` event (DONE marker) in `.pipeline/events.jsonl` | `./inline.sh [s|m|l]` |
| interactive | `conduct-ts inline "<prompt>" --interactive` | guided, interactive launcher (execs with stdio inherited so a human drives the REPL) | `feature_complete` / DONE, printed as the checkpoint to watch for before handing off to the human | `./interactive.sh [s|m|l]` |
| daemon | daemon drain against a seeded accepted story + plan fixture | headless, self-asserting | feature reaches DONE with a recorded `pr_url` / local-commit | `./daemon.sh [s|m|l]` |
| engineer | `engineer worktree` -> `engineer land` -> `engineer handoff` (headless); or the real `conduct-ts engineer` loop with `--interactive` | headless self-asserting by default; guided interactive launcher with `--interactive` | flow reaches `pr-opened` or `local-commit` | `./engineer.sh [s|m|l] [--interactive]` |
| intake-loop | `conduct-ts intake-loop --once` against a seeded pending envelope | headless, self-asserting | `intake-status.json` written into the sandbox engineer dir | `./intake-loop.sh [s|m|l]` |

Every script accepts a tier of `s`, `m`, or `l` (or the long forms `small`,
`medium`, `large`), which selects the prompt/fixture size from
`examples/prompts/`. Running a script with `--help` or an unknown tier
(e.g. `./inline.sh xl`) prints usage naming the valid tiers and exits
non-zero without running any flow.

## Eval / regression runner

A batch eval/regression runner over these scenarios is out of scope here —
see #807. These scripts are single-run, human- or CI-triggered examples,
not a scored regression suite.
