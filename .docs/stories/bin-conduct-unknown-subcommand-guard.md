**Status:** Accepted

# Stories: bin/conduct unknown-subcommand guard

Technical track — no PRD. Source: jstoup111/ai-conductor#178. Complexity: S.
Intent: an unknown token passed to `bin/conduct` must never be silently coerced into
`FEATURE_DESC` and launch the SDLC pipeline. Unknown options and bare-word commands fail
loudly; known `conduct-ts` subcommands are forwarded; real feature descriptions keep working.

## Story: Unknown option is rejected loudly

**Requirement:** TECH-1 (unknown `-`/`--` tokens never start a pipeline)

As an operator, I want `conduct` to reject options it does not recognize so that a typo'd or
`conduct-ts`-only flag cannot silently launch a full pipeline run.

### Acceptance Criteria

#### Happy Path
- Given a repo with the harness installed, when I run `conduct --frobnicate`, then the process prints `Unknown option: --frobnicate` (plus a pointer to `conduct --help`) to stderr and exits with a non-zero status.
- Given the same repo, when I run `conduct --frobnicate`, then no pipeline session is created: no `claude` process is spawned and `.pipeline/` state files (`STATE_FILE`, session file, session log) are not created or modified.

#### Negative Paths
- Given a valid option that takes a value (`--step <name>`), when I run `conduct --step build_task`, then it is parsed exactly as before (no rejection) — the guard must not break existing flag handling.
- Given an unknown option appearing after a valid feature description, when I run `conduct "add login form" --frobnicate`, then the command still fails loudly with `Unknown option: --frobnicate` and exits non-zero without starting the pipeline (no partial acceptance).

### Done When
- [ ] `conduct --frobnicate` exits non-zero with `Unknown option: --frobnicate` on stderr; `$?` verified in a test.
- [ ] After the rejected run, `.pipeline/` contains no new/modified state, session, or log files (asserted by the test).
- [ ] All existing documented options (`--status`, `--resume`, `--auto`, `--step`, `--from`, `--cooldown`, `--reset`, `--update`, `--set-channel`, `-h/--help`, …) still parse and behave unchanged (regression assertions).

## Story: Known conduct-ts subcommands are forwarded, not swallowed

**Requirement:** TECH-2 (conduct-ts-only verbs route to conduct-ts)

As an operator, I want `conduct render-diagrams --check <file>` (and other `conduct-ts`-only verbs) to be handled by `conduct-ts` so that a read-only utility command performs its documented function instead of launching a pipeline.

### Acceptance Criteria

#### Happy Path
- Given `conduct-ts` is on PATH, when I run `conduct render-diagrams --check <file>`, then the invocation is forwarded to `conduct-ts` with the identical argument vector (`render-diagrams --check <file>`) and `conduct`'s exit status is `conduct-ts`'s exit status.
- Given `conduct-ts` is on PATH, when I run `conduct daemon status`, then the existing daemon forwarding behavior is unchanged (regression).

#### Negative Paths
- Given `conduct-ts` is NOT on PATH, when I run `conduct render-diagrams --check <file>`, then the process prints a clear error naming `conduct-ts` as missing and exits non-zero — it must NOT fall through to treating `render-diagrams` as a feature description and must NOT spawn a pipeline or `claude` session.

### Done When
- [ ] A test (fake `conduct-ts` shim on PATH capturing argv) proves `conduct render-diagrams --check X` reaches the shim with argv exactly `render-diagrams --check X` and propagates the shim's exit code.
- [ ] A real-binary smoke test runs `conduct render-diagrams --check <valid-diagram.md>` end-to-end and exits 0 without creating `.pipeline/` session state.
- [ ] With `conduct-ts` absent from PATH, the same command exits non-zero with an error that names `conduct-ts`, and no `claude` process or `.pipeline/` state is produced.

## Story: Bare single-word token is rejected with a hint

**Requirement:** TECH-3 (a lone bare word is presumed a mistyped command, not a feature)

As an operator, I want a single-word non-option argument that isn't a known subcommand to fail with `Unknown command: <word>` so that a typo (e.g. `rendr-diagrams`) can never be reinterpreted as a feature description and auto-run the SDLC.

### Acceptance Criteria

#### Happy Path
- Given the harness installed, when I run `conduct rendr-diagrams` (typo), then it prints `Unknown command: rendr-diagrams` plus a hint that feature descriptions must be multi-word/quoted (e.g. `conduct "add user login"`), and exits non-zero.
- Given the same repo, when the command is rejected, then no pipeline starts: no `claude` spawn, no `.pipeline/` state or session files created.

#### Negative Paths
- Given an operator with a genuinely single-word feature idea, when they run `conduct auth`, then the command is rejected with the same hint (deliberate trade-off — the hint must tell them how to proceed, e.g. quote a longer description), and nothing is executed.

### Done When
- [ ] `conduct rendr-diagrams` exits non-zero with `Unknown command: rendr-diagrams` on stderr and the multi-word-description hint.
- [ ] The rejected run provably creates no `.pipeline/` state and spawns no `claude` process.
- [ ] The hint text appears in `conduct --help` (usage) so the new contract is discoverable.

## Story: Multi-word feature descriptions keep working unchanged

**Requirement:** TECH-4 (no regression to the primary UX)

As an operator, I want `conduct "add user login"` and flag combinations like `conduct --auto "add user login"` to behave exactly as today so that the guard changes only the mis-parse paths.

### Acceptance Criteria

#### Happy Path
- Given the harness installed, when I run `conduct "add user login"` (a quoted string containing whitespace), then `FEATURE_DESC` is set to that string and the run proceeds into the normal pipeline flow exactly as before the guard.
- Given the same repo, when I run `conduct --auto "add user login"`, then both the flag and the description parse as before (order-independent, matching current loop semantics).

#### Negative Paths
- Given a whitespace-containing argument that begins with a dash (e.g. `conduct "--weird feature name"`), when the loop classifies tokens, then it is treated as an unknown option (rejected loudly), not as a feature description — dash-leading tokens are never coerced into `FEATURE_DESC`.

### Done When
- [ ] A test proves `conduct "add user login" --status`-style parsing still yields the same `FEATURE_DESC`/mode outcomes as pre-change (characterization assertions on at least the `--auto`, `--step`, and bare-description combinations).
- [ ] `bash -n bin/conduct` passes and `test/test_harness_integrity.sh` is green.
- [ ] The README / usage text documents the new rejection behavior for unknown options, unknown bare words, and the conduct-ts forwarding list.
