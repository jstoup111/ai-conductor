**Status:** Accepted

# Stories: finish-record primitive — first-try finish-choice marker write (issue #281)

Technical track — acceptance criteria derive from
`adr-2026-07-07-finish-record-primitive.md` (APPROVED). Requirement tags reference ADR
decisions (D1–D5).

## Story: finish-record subcommand detection

**Requirement:** D1

As the conduct-ts CLI, I want `finish-record` argv detected exactly, so that a
recognized-but-misused invocation can never fall through to the pipeline launcher.

### Acceptance Criteria

#### Happy Path
- Given argv `conduct-ts finish-record --choice pr --pr-url https://github.com/o/r/pull/1 --pipeline-dir /abs/wt/.pipeline`, when detection runs, then it returns a `record` dispatch with `choice='pr'`, that URL, and that pipeline dir.
- Given argv `conduct-ts finish-record --choice keep --pipeline-dir /abs/wt/.pipeline`, when detection runs, then it returns a `record` dispatch with `choice='keep'` and no pr-url.

#### Negative Paths
- Given argv `conduct-ts finish-record` with no flags, when detection runs, then it returns `guide` (exit 1 with usage on stderr), NOT null and NOT the pipeline launcher.
- Given argv `conduct-ts finish-record --choice merge-local --pipeline-dir /abs/p`, when detection runs, then it returns `guide` — `merge-local` and `discard` are not accepted choices.
- Given argv `conduct-ts finish-record --choice pr --pipeline-dir /abs/p` (no `--pr-url`), when detection runs, then it returns `guide` — `pr` without a URL is malformed.
- Given argv `conduct-ts finish-record --choice pr --pr-url --pipeline-dir /abs/p` (flag value is another flag), when detection runs, then it returns `guide`.
- Given argv for a different subcommand (`conduct-ts daemon status`), when detection runs, then it returns null so the rest of the dispatch chain proceeds unchanged.

### Done When
- [ ] `detectFinishRecordCommand(argv)` exists in `src/conductor/src/engine/finish-record-cli.ts` and is wired into the `src/index.ts` detection chain before the pipeline launcher fallthrough.
- [ ] Vitest cases cover both happy dispatches, all five malformed shapes above, and the null passthrough.
- [ ] `guide` output names all flags and the two accepted choices.

## Story: choice=pr verification refuses fail-closed

**Requirement:** D2, D3

As the daemon's finish gate, I want finish-record to verify the PR and the push before
writing anything, so that a marker never testifies to a ship that did not happen.

### Acceptance Criteria

#### Happy Path
- Given the gh runner returns a non-empty PR URL, `headPushedToUpstream` returns `true`, and the
  current PR head contains a strict-valid matching shipped record, when
  `finish-record --choice pr` runs, then it exits 0 and both markers are written.

#### Negative Paths
- Given the gh runner returns an empty string for `gh pr view --json url -q .url`, when the command runs, then it exits non-zero, writes NOTHING under the pipeline dir, and stderr states the PR check failed.
- Given the gh runner throws (spawn ENOENT — the known child-PATH class, bug #290), when the command runs, then it exits non-zero with zero writes and stderr names the gh spawn failure — it does NOT fall back to `keep`.
- Given `headPushedToUpstream` returns `false` (HEAD not an ancestor of the upstream ref), when the command runs, then it exits non-zero with zero writes and stderr states the push evidence failed.
- Given `headPushedToUpstream` returns `null` (indeterminate — detached HEAD, no upstream, git error), when the command runs, then it exits non-zero with zero writes — indeterminate is refusal, never fail-open.
- Given PR existence and push evidence pass but the shipped record is missing, malformed,
  mismatched, uncommitted, or unpushed, when the command runs, then it exits non-zero with zero new
  terminal writes and stderr names the durable-evidence refusal — PR/push alone are no longer
  sufficient.
- Given a pre-existing valid `finish-choice` from an earlier attempt, when a later `finish-record --choice pr` run refuses, then the pre-existing files are left byte-for-byte untouched (refusal never deletes or rewrites prior state).

### Done When
- [ ] `dispatchFinishRecord` imports `headPushedToUpstream` from `./push-evidence.js` — `git merge-base --is-ancestor` appears in no new implementation (grep-verifiable single source).
- [ ] gh, git, and durable-evidence dependencies are injectable; vitest covers every refusal row
      above asserting BOTH exit code ≠ 0 AND zero filesystem writes (directory snapshot before/after).
- [ ] Each refusal prints exactly one actionable reason line to stderr.

## Story: marker writes are ordered and preserve state

**Requirement:** D4

As the completion gate, I want `pr_url` recorded before `finish-choice` and unrelated
state preserved, so that no observable half-state confuses gate diagnostics.

### Acceptance Criteria

#### Happy Path
- Given verifications pass and `conduct-state.json` already holds other fields (e.g. `feature`, `session_id`), when `finish-record --choice pr` runs, then `conduct-state.json` contains the new `pr_url` AND every pre-existing field unchanged, and `finish-choice` contains exactly `pr` (no trailing prose).
- Given `conduct-state.json` does not exist yet, when the command runs, then it is created containing `pr_url` and `finish-choice` is written after it.

#### Negative Paths
- Given the `conduct-state.json` write fails (pipeline dir removed between check and write, fs error injected), when the command runs, then it exits non-zero and `finish-choice` was NEVER written — the marker is the commit point and must not exist without its pr_url.
- Given `conduct-state.json` exists but contains invalid JSON, when the command runs, then it exits non-zero with zero writes and stderr names the corrupt state file — it does NOT clobber the corrupt file with a fresh one (evidence preservation).

### Done When
- [ ] Write-order test proves `finish-choice` is absent whenever the state write failed (fs-injection test).
- [ ] Round-trip test proves unknown state fields survive byte-for-byte.
- [ ] `finish-choice` content is the bare choice string, satisfying the existing `artifacts.ts` finish verifier value check.

## Story: choice=keep writes only the marker

**Requirement:** D1, D2

As the finish skill on a repo with no usable remote, I want `keep` recorded without any
gh/git verification, so that offline/no-remote finishes still converge on the marker.

### Acceptance Criteria

#### Happy Path
- Given a valid absolute pipeline dir, when `finish-record --choice keep` runs, then it exits 0, `finish-choice` contains `keep`, and NO gh or git process was spawned (runner spies never called).

#### Negative Paths
- Given `--choice keep --pr-url <url>` (contradictory flags), when detection runs, then it returns `guide` — keep carries no PR.
- Given the pipeline dir does not exist, when the command runs, then it exits non-zero with zero writes and stderr names the missing directory (it does NOT mkdir a pipeline dir the conductor never created).

### Done When
- [ ] keep-path vitest asserts zero spawns via runner spies plus the marker content.
- [ ] Contradictory-flag and missing-dir cases covered.

## Story: Managed FINISH delegates recording to the engine

**Requirement:** adr-2026-08-01-engine-owned-resumable-finish-publication D3–D6; adr-2026-10-01-daemon-session-command-contracts D2.

As a managed FINISH provider, I want a bounded PR prose assignment whose mechanical completion remains engine-owned.

### Acceptance Criteria

#### Happy Path
- Given managed FINISH with coherent publication evidence, when the final outcome is recorded, then the engine invokes and verifies the recorder through the coordinator and provider instructions contain no recording command.
- Given a provider completes a PR presentation repair, when FINISH resumes, then the engine owns subsequent recording and verification.

#### Negative Paths
- Given publication refuses or required evidence is missing, when FINISH settles, then no completion marker is fabricated and the existing typed refusal identifies the condition.
- Given a managed path has no usable publication coordinator, when it requires recording, then it refuses explicitly instead of rendering a relative-path or absolute-path recording command for the provider.
- Given a marked provider invokes finish-record directly, when the CLI guard evaluates the command, then it refuses before recorder execution.

### Done When
- [ ] FINISH coordinator fixtures prove engine recording and no provider recording instruction for normal, presentation-repair, and missing-coordinator paths.
- [ ] CLI guard fixtures prove a marked recording call invokes no recorder; unmarked primitive parsing and evidence validation retain their existing contract.

## Story: real-binary smoke test

**Requirement:** D2, D3 (testing consequence)

As the harness maintainer, I want one smoke test running the real built CLI, so that
argv-shape drift between tests and the shipped binary cannot false-pass (PR #143 lesson).

### Acceptance Criteria

#### Happy Path
- Given the built conduct-ts binary and a temp git repo (nested-mkdtemp parent per the rekick-flake lesson) with an absolute temp pipeline dir, when the smoke invokes `finish-record --choice keep --pipeline-dir <tmp>`, then exit 0 and the marker file contains `keep`.

#### Negative Paths
- Given the same real binary, when invoked as `finish-record --choice pr --pipeline-dir <tmp>` (missing `--pr-url`), then exit ≠ 0, usage on stderr, and nothing written under the temp pipeline dir.

### Done When
- [ ] Smoke lives with the existing real-binary suite and respects the production-spawn env kill-switch set in global vitest setup (no leaked processes).
- [ ] Full conductor vitest suite passes via `rtk proxy npx vitest run`.
