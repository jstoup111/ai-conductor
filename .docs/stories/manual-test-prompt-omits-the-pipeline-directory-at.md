**Status:** Accepted

# Stories: manual_test attempts record results without being handed a pipeline path (#3642)

Track: technical. Tier: S. Source: intake jstoup111/ai-conductor#3642.

Scope: manual_test only. The prd_audit and architecture_review_as_built handshakes and every other
step's prompt are unchanged. Identity-mismatch reasons keep the shape set by
adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity D5.

## Story 1: manual-test-record finds the feature's pipeline directory itself

As a manual_test agent, I want `ai-conductor manual-test-record` to locate the feature's `.pipeline` directory when I do not pass one so that recording never depends on a path the step prompt may not carry.

### Acceptance Criteria

#### Happy Path
- Given the working directory is the root of a feature worktree that contains a `.pipeline` directory, when `ai-conductor manual-test-record --results -` runs with results on stdin and no `--pipeline-dir`, then a new attempt section is appended to `<worktree root>/.pipeline/manual-test-results.md` and the command exits 0
- Given the same worktree, when `ai-conductor manual-test-record --skip --reason "<reason>"` runs with no `--pipeline-dir`, then the skip attempt is recorded in `<worktree root>/.pipeline/manual-test-results.md` and the command exits 0
- Given the working directory is a subdirectory of the feature worktree, when the command runs with no `--pipeline-dir`, then it records into `<worktree root>/.pipeline/manual-test-results.md`, not into a `.pipeline` under the subdirectory
- Given an explicit absolute `--pipeline-dir`, when the command runs, then it records into that directory exactly as before this change, regardless of the working directory

#### Negative Paths
- Given the working directory is not inside a git work tree and no `--pipeline-dir` is passed, when the command runs, then it exits 1 with a message saying the pipeline directory could not be determined and naming `--pipeline-dir` as the override, and writes no file
- Given the git toplevel of the working directory has no `.pipeline` directory and no `--pipeline-dir` is passed, when the command runs, then it exits 1 with a message naming the expected `<toplevel>/.pipeline` path, and creates neither that directory nor a results file
- Given a relative `--pipeline-dir` is passed, when the command runs, then it is refused before any write, as before this change

### Done When
- [ ] A test running the record command from a temporary git worktree with a `.pipeline` directory and no `--pipeline-dir` observes the appended attempt in that worktree's `.pipeline/manual-test-results.md`, for both `--results` and `--skip`
- [ ] A test running it from a subdirectory observes the write at the worktree root's `.pipeline`, and no `.pipeline` created under the subdirectory
- [ ] Tests for the non-git directory and the missing-`.pipeline` toplevel observe exit 1, the stated message, and an unchanged filesystem

## Story 2: manual-test guidance no longer halts for a missing pipeline path

As a manual_test agent that follows its skill literally, I want the guidance I receive to record results without a supplied pipeline path so that I test and record instead of halting.

### Acceptance Criteria

#### Happy Path
- Given the manual-test skill, when an agent reads its recording instructions, then the skill directs recording with `ai-conductor manual-test-record` run from the feature worktree and treats `--pipeline-dir` as optional
- Given the manual-test skill, when an agent has no pipeline path in its step prompt, then no instruction in the skill directs it to halt or withhold results for that reason
- Given a manual_test retry after a completion miss whose reason says the results file is missing, when the engine builds the retry hint, then the record commands it shows carry no `--pipeline-dir` placeholder

#### Negative Paths
- Given the record command itself exits non-zero, when the agent follows the skill, then the skill still directs it not to hand-write the results file and to report the command's error as its blocker
- Given the skill's existing whitewash guard and bug loop, when the guidance is changed, then their instructions are unchanged

### Done When
- [ ] `skills/manual-test/SKILL.md` contains no instruction to halt when no pipeline directory is supplied, and its record examples run without `--pipeline-dir`
- [ ] A unit test of the manual_test retry hint for a "results file is missing" reason observes record commands without `--pipeline-dir`

## Story 3: an attempt that wrote nothing says so

As an operator reading a manual_test retry or halt, I want an attempt that recorded nothing to be reported as exactly that so that I am not sent chasing a stale file or a run-identity mismatch that did not happen.

### Acceptance Criteria

#### Happy Path
- Given the results file on disk carries this run's identity but was last written before this attempt's dispatch started, when the post-dispatch handshake runs, then the attempt fails with a reason beginning `no results written this attempt` that names `.pipeline/manual-test-results.md` and its last-write time
- Given the same attempt, when the reason is formed, then it does not call the file stale and does not print an expected and a found run identity as a pair
- Given no results file exists, when the handshake runs, then the attempt fails with a reason beginning `no results written this attempt` that names the missing `.pipeline/manual-test-results.md`
- Given the attempt is retried or the step's retry budget is exhausted, when the `step_retry` event or the halt is recorded, then its reason carries the `no results written this attempt` text

#### Negative Paths
- Given the results file carries a different run's identity, when the handshake runs, then the reason still names the artifact, the expected run identity, and the found identity as before this change
- Given the attempt wrote fresh results stamped with this run's identity, when the handshake runs, then no `no results written this attempt` reason is produced

### Done When
- [ ] Replaying the #3642 shape (results and stamp left by an earlier attempt of the same run, nothing written by this attempt) yields a failed attempt whose reason starts `no results written this attempt` and contains no expected/found run-identity pair
- [ ] A test with a prior run's stamp still observes the expected and found identities in the reason

## Story 4: the agent's reported blocker reaches the retry and halt reason, and a blocked attempt never passes

As an operator, I want the blocker a manual_test agent reported instead of recording results to appear in the retry or halt reason so that the cause is visible without opening provider transcripts, while the attempt still fails.

### Acceptance Criteria

#### Happy Path
- Given an attempt that wrote no results and whose final agent message is non-empty, when the handshake reason is formed, then it includes that message as the agent's reported blocker, with whitespace runs collapsed to single spaces
- Given a final agent message longer than 600 characters, when the reason is formed, then only its last 600 characters appear, preceded by an ellipsis
- Given the attempt is retried or exhausts its budget, when the `step_retry` event or halt reason is recorded, then it contains the reported blocker text

#### Negative Paths
- Given an attempt that wrote no results and produced no final agent message, when the reason is formed, then it states that the agent gave no final message
- Given an attempt where the application could not start and the agent reported that instead of recording results, when the step concludes, then the attempt is failed and manual_test is not marked done
- Given an attempt whose final message claims the tests passed but which recorded no results, when the step concludes, then the attempt is failed and manual_test is not marked done
- Given an attempt that recorded fresh results containing FAIL rows, when the step concludes, then the existing FAIL routing applies unchanged and no reported-blocker text is added

### Done When
- [ ] A test with a final agent message and no results write observes the message in the failed attempt's reason; a 2,000-character message appears as its last 600 characters after an ellipsis
- [ ] A test with no final message observes the "no final message" statement
- [ ] Tests for the blocked and the claimed-pass attempts observe a failed attempt and manual_test not `done`
