**Status:** Accepted

# Stories: updating-the-harness-requires-cd-ing-to-its-checko

Technical track (no PRD). Source: issue jstoup111/ai-conductor#2605. Tier S. Scope boundary: minimal — one `update` subcommand on the installed CLI that resolves the harness checkout the CLI belongs to and runs that checkout's `bin/update` with the operator's arguments, inherited terminal, and its exit status; three pre-spawn refusals. Documentation of the command is delivered outside this spec, per the stories and plan documentation boundary. `bin/update`, the startup `--auto` check, the `bin/ai-conductor` shell wrapper, and the curl bootstrap (#1712) are not modified.

## Story 1: An attended update runs from any working directory

As an operator with the CLI on my `PATH`, I want `ai-conductor update` to run my harness checkout's own updater from whatever directory I am in so that I never have to remember where the harness was cloned.

### Acceptance Criteria

#### Happy Path
- Given an installed CLI whose harness root is a git checkout containing `bin/update`, when `ai-conductor update` runs from a directory outside that checkout, then the checkout's `bin/update` is executed with no arguments, with stdin, stdout, and stderr inherited from the terminal, and the command exits 0 when the updater exits 0
- Given the same installation, when `ai-conductor update --set-channel stable` runs from any directory, then the checkout's `bin/update` receives exactly `--set-channel stable` and the command exits with the updater's status
- Given the installed CLI, when `ai-conductor --help` runs, then the output lists an `update` command with a one-line description

#### Negative Paths
- Given an updater that exits 3, when `ai-conductor update` runs, then the command exits 3 and prints no error of its own
- Given an updater terminated by a signal before it exits, such as the operator pressing Ctrl-C at a confirmation prompt, when `ai-conductor update` returns, then the command exits non-zero
- Given a CLI whose harness root cannot be resolved, when `ai-conductor update` runs, then it exits 1, stderr names the locations it probed, and no updater process is started
- Given a harness root with no `bin/update`, when `ai-conductor update` runs, then it exits 1, stderr names the missing updater path, and no updater process is started
- Given a harness root whose `.git` is not a directory, when `ai-conductor update` runs, then it exits 1, stderr names that root as not a git checkout, and no updater process is started
- Given the shipped change, when `ai-conductor inline` starts, then the startup check still runs `bin/update --auto` and swallows its failures exactly as before, and `bin/update` itself is byte-for-byte unchanged

### Done When
- [ ] `ai-conductor update [args...]` executes the resolved checkout's `bin/update` with the arguments verbatim and inherited stdio, and exits with its status
- [ ] Each refusal (unresolved root, missing updater, non-git root) exits 1 naming the path and never reaches the process runner
- [ ] A signal-terminated updater yields a non-zero exit
- [ ] `ai-conductor --help` lists `update`; the existing auto-update-check tests pass unchanged; the diff does not touch `bin/update`
