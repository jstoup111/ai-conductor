**Status:** Accepted

# Stories: Preserve self-host provider transcripts for failed, stalled, or zero-progress dispatches

Technical track (no PRD). Source: intake jstoup111/ai-conductor#611. Governing decision:
`adr-2026-10-10-retain-self-host-provider-transcripts` (APPROVED). Requirements are technical
requirements `TR-N` derived from that ADR's numbered decisions.

- **TR-1** (ADR 1) — every self-host provider declares which home files are its transcripts.
- **TR-2** (ADR 2, 3) — every normal retirement of a provider home captures its transcripts first.
- **TR-3** (ADR 1, 2) — nothing outside the declared transcripts ever leaves a provider home.
- **TR-4** (ADR 2) — a capture failure never changes a dispatch's outcome or teardown.
- **TR-5** (ADR 2, 4) — a killed attempt's transcripts are captured by the dead-owner sweep.
- **TR-6** (ADR 4) — captures are kept or pruned according to the owning step's verdict.
- **TR-7** (ADR 4) — retained captures are bounded per worktree.
- **TR-8** (ADR 5) — every capture lifecycle transition is announced on the event spine.
- **TR-9** (ADR 6) — an operator can list captures and read a capture's final assistant message.

Retention cap defaults (operator-confirmed): **20 retained captures** and **1 GiB** total per
worktree, whichever is reached first.

## Story 1: Self-host providers declare their transcript files

**Requirement:** TR-1

As the harness maintainer, I want every self-host provider to state which of its home files are
session transcripts so that preservation never depends on someone remembering a provider's layout.

### Acceptance Criteria

#### Happy Path
- Given the built-in provider catalog, when the self-host shape of `claude` is read, then it declares the transcript allowlist `projects/**/*.jsonl` and a final-assistant-message extractor.
- Given the built-in provider catalog, when the self-host shape of `codex` or `pi` is read, then each declares the transcript allowlist `sessions/**/*.jsonl` and a final-assistant-message extractor.

#### Negative Paths
- Given a built-in provider descriptor that declares self-host support but omits the transcript allowlist, when the conductor package is type-checked, then compilation fails naming the missing field.
- Given a built-in provider descriptor whose transcript allowlist is an empty list, when the provider catalog is validated at load, then validation rejects it with an error naming the provider id and the empty allowlist.

### Done When
- [ ] `claude`, `codex`, and `pi` self-host shapes each expose a non-empty transcript allowlist and an extractor.
- [ ] A descriptor without the field fails type-checking; one with an empty list fails catalog validation with the provider id in the message.

## Story 2: A provider home's transcripts are captured before it is removed

**Requirement:** TR-2

As an operator investigating a self-host dispatch, I want every provider home's transcripts copied
out before the home is deleted so that the session record survives the attempt.

### Acceptance Criteria

#### Happy Path
- Given a self-host `build` dispatch through the Claude config sandbox whose home contains `projects/«cwd»/«session».jsonl` and `projects/«cwd»/«session»/subagents/«agent».jsonl`, when the attempt ends and the home is torn down, then both files exist under `«worktree»/.pipeline/transcripts/build/«runId»-a«attempt»-claude/` at the same paths relative to the home, and the home directory no longer exists.
- Given a self-host dispatch through a Codex or Pi provider home containing `sessions/2026/10/10/rollout-x.jsonl`, when the home is torn down, then that file exists under `«worktree»/.pipeline/transcripts/«step»/«runId»-a«attempt»-«provider»/sessions/2026/10/10/rollout-x.jsonl`, and the home directory no longer exists.
- Given concurrent `build_review` rubric members sharing a run and attempt, when each member's home is torn down, then each member's transcripts land in its own `«runId»-a«attempt»-«member»-«provider»` directory and no member's capture overwrites another's.
- Given a transcript line containing a bearer token, an API key, or an authorization header inside a JSON string value, when it is captured, then that string value is replaced by the sanitized form `redactSafetyText` produces, the line is still valid JSON, and lines with nothing to redact are semantically unchanged.
- Given a transcript line whose JSON object has a key named `token`, `api_key`, `secret`, `password`, `credential`, or `authorization` (any case), when it is captured, then that key's value is `[REDACTED]` in the capture.
- Given a transcript line that is not valid JSON and contains `token=abc123`, when it is captured, then the captured line contains `token=[REDACTED]` and not `abc123`.

#### Negative Paths
- Given a provider home that contains no file matching its allowlist, when it is torn down, then a capture is still recorded with zero files, no capture directory content is fabricated, and the home is removed.
- Given a teardown invoked twice on the same home, when the second teardown runs, then no second capture is created and no error is raised.
- Given an attempt that exits with failure, when its home is torn down, then its transcripts are captured exactly as for a successful exit.
- Given the same step dispatched for a second attempt, when the second home is torn down, then its capture is written to a distinct `a«attempt»` directory and the first attempt's capture is unchanged.

### Done When
- [ ] For Claude sandbox, Codex home, and Pi home, an end-of-attempt teardown leaves the allowlisted files under `.pipeline/transcripts/«step»/…` and removes the home.
- [ ] Rubric members and successive attempts produce distinct capture directories.
- [ ] Double teardown is a no-op for capture.

## Story 3: Credentials and other home content never leave the home

**Requirement:** TR-3

As the harness maintainer, I want capture to copy only declared transcript files so that seeded
credentials and linked harness content cannot be exfiltrated into run state.

### Acceptance Criteria

#### Happy Path
- Given a Codex or Pi home containing `auth.json` alongside a session transcript, when it is captured, then the capture contains the transcript and contains no `auth.json`.
- Given a Claude sandbox home containing `.claude.json`, `settings.json`, and symlinked `skills/` and `hooks/` directories alongside a transcript, when it is captured, then the capture contains only the transcript.

#### Negative Paths
- Given a home in which a path matching the allowlist is a symlink to a file outside the home, when it is captured, then that path is not copied and the capture records it as skipped.
- Given a home in which a directory on an allowlisted path is a symlink that leaves the home, when it is captured, then nothing beneath that symlink is copied.
- Given a home containing `projects/x/notes.txt` (outside the `*.jsonl` allowlist), when it is captured, then `notes.txt` is not copied.
- Given an allowlisted transcript in which a tool result or provider error echoed the contents of `auth.json`, when it is captured, then no credential value from that file appears anywhere in the capture.
- Given the sanitizer throws on a line, when capture runs, then that line is omitted from the capture and the omission is reported, rather than written unsanitized.

### Done When
- [ ] A capture of a home seeded with `auth.json`, `.claude.json`, `settings.json`, symlinked `skills/`/`hooks/`, and non-matching files contains only allowlisted regular files inside the home.
- [ ] Symlinked allowlist matches are skipped and reported.
- [ ] A fixture transcript seeded with a token, an authorization header, and echoed `auth.json` contents yields a capture containing none of those values.

## Story 4: A capture failure never changes the dispatch outcome

**Requirement:** TR-4

As an operator, I want preservation to be best-effort so that forensics machinery can never fail
or alter a build.

### Acceptance Criteria

#### Happy Path
- Given a successful attempt whose capture succeeds, when teardown completes, then the step result is identical to what it would be with capture disabled.

#### Negative Paths
- Given the capture destination cannot be written (for example, the transcripts directory is not writable), when teardown runs, then a harvest-failed event names the step, attempt, provider, and error, the home is still removed, and the step result is unchanged.
- Given a transcript file disappears between matching and copying, when capture runs, then the remaining files are copied, the missing file is reported, and teardown completes.
- Given the disk fills partway through a capture, when the copy fails, then the partial capture is removed or marked incomplete, a harvest-failed event is emitted, and the home is still removed.

### Done When
- [ ] With an unwritable destination, the dispatch returns the same result object as without capture, the home is gone, and one harvest-failed event is persisted.
- [ ] A partial-copy failure leaves no capture presented as complete.

## Story 5: A killed attempt's transcripts are captured by the sweep

**Requirement:** TR-5

As an operator, I want an attempt killed mid-run (SIGKILL, OOM, daemon restart) to keep its
transcript so that the hardest failures are not the least explainable.

### Acceptance Criteria

#### Happy Path
- Given an orphaned provider home whose lease names a dead owner and which contains a transcript, when the dead-owner sweep reclaims it, then the transcript is captured before the home is removed and the capture is marked interrupted.
- Given an interrupted capture, when retention runs, then it is retained regardless of any later verdict.

#### Negative Paths
- Given a home whose lease is missing, unreadable, or whose owner is still alive, when the sweep runs, then the home is neither captured nor removed (existing retention behavior unchanged).
- Given capture fails during a sweep reclaim, when the sweep continues, then a harvest-failed event is emitted and the sweep's reclaim decision for that home is unchanged.

### Done When
- [ ] A swept dead-owner home yields an interrupted capture under `.pipeline/transcripts/` before removal.
- [ ] Sweep decisions for live, lease-less, and unreadable-lease homes are unchanged from today.

## Story 6: Captures are kept or pruned by the step's verdict

**Requirement:** TR-6

As an operator, I want transcripts kept exactly when something went wrong — including a build that
exited cleanly but did nothing — and discarded when the step succeeded, so that forensics are
available without accumulating noise.

### Acceptance Criteria

#### Happy Path
- Given a `build` attempt that exits 0 and is then judged `no_task_progress`, when the verdict is settled, then that attempt's capture is retained.
- Given any self-host step attempt that fails, or ends in any `build_stall` reason, a HALT, or a needs-human outcome, when the verdict is settled, then that attempt's captures (including every rubric member's) are retained.
- Given a self-host step attempt that succeeds and, for `build`, resolves at least one task, when the verdict is settled, then that attempt's captures are pruned from disk.
- Given attempt 1 of a step failed and attempt 2 succeeds, when attempt 2's verdict is settled, then attempt 1's capture remains retained and only attempt 2's is pruned.

#### Negative Paths
- Given the daemon dies after a capture is written but before its verdict is settled, when the daemon restarts, then the capture is still on disk and is not pruned.
- Given a step outcome that the retention mapping does not recognize, when the conductor package is type-checked, then compilation fails (the mapping has no default arm).
- Given a prune fails (for example, a permission error), when retention runs, then the failure is reported on the spine and the step's outcome is unchanged.

### Done When
- [ ] A zero-progress `build` attempt's capture exists after the `build_stall` verdict; a successful-with-progress attempt's capture directory is gone.
- [ ] Failed, stalled, HALT, needs-human, and interrupted captures are retained; earlier-attempt captures survive a later success.

## Story 7: Retained captures are bounded per worktree

**Requirement:** TR-7

As an operator, I want retained transcripts capped so that a long-retrying feature cannot fill
the disk.

### Acceptance Criteria

#### Happy Path
- Given 20 retained captures in a worktree, when a 21st is retained, then the oldest retained capture is evicted and an eviction event names it.
- Given retained captures totalling more than 1 GiB, when retention runs, then the oldest retained captures are evicted until the total is at or below 1 GiB.

#### Negative Paths
- Given a single retained capture larger than 1 GiB, when retention runs, then that newest capture is kept and every older retained capture is evicted (the most recent evidence is never evicted by the size cap).
- Given eviction of a capture fails, when retention runs, then the failure is reported on the spine and no other retained capture is evicted in its place.

### Done When
- [ ] After the 21st retention there are exactly 20 retained captures and one eviction event.
- [ ] The size cap evicts oldest-first and never evicts the newest capture.

## Story 8: Capture lifecycle is visible on the event spine

**Requirement:** TR-8

As an operator or downstream consumer, I want capture lifecycle transitions in
`.pipeline/events.jsonl` so that existing readers can see where transcripts went without a
separate log.

### Acceptance Criteria

#### Happy Path
- Given a capture is written, when it completes, then a captured event is persisted with step, run id, attempt, member (when present), provider, capture path, file count, total bytes, and whether it was interrupted.
- Given a capture is retained, pruned, or evicted, when that happens, then a retained, pruned, or evicted event is persisted naming the capture path.

#### Negative Paths
- Given a capture or retention failure, when it occurs, then the corresponding failure event carries the capture identity and error text, and no index or sidecar file is written as a substitute.
- Given the event persister cannot append, when a capture event is emitted, then the capture on disk is unaffected and the dispatch outcome is unchanged.

### Done When
- [ ] Every transition in Stories 2–7 produces exactly one persisted event of the matching type.
- [ ] No new file other than captured transcripts is written under `.pipeline/transcripts/`.

## Story 9: An operator can read a feature's captured transcripts

**Requirement:** TR-9

As an operator doing a post-mortem, I want a command that lists a feature's retained captures and
prints a capture's final assistant message so that I can see why a dispatch did what it did.

### Acceptance Criteria

#### Happy Path
- Given a feature with retained captures, when the operator runs `ai-conductor transcripts «slug»`, then each retained capture is listed with step, attempt, member, provider, interrupted flag, and path, newest first, and the command exits 0.
- Given a retained Claude, Codex, or Pi capture, when the operator runs `ai-conductor transcripts «slug» --show «capture»`, then the final assistant message of the top-level session is printed and the command exits 0.

#### Negative Paths
- Given an unknown slug, when the command runs, then it prints `no feature worktree for «slug»` and exits non-zero.
- Given a feature with no retained captures, when the command runs, then it prints `no retained transcripts for «slug»` and exits 0.
- Given a capture with zero files or whose transcript contains no assistant message, when `--show` runs, then it prints `no assistant message in «capture»` and exits non-zero.
- Given a transcript with a malformed JSON line, when `--show` runs, then the malformed line is skipped and the last well-formed assistant message is printed.
- Given any invocation, when the command runs, then no file under the worktree is created, modified, or removed.
- Given a capture file that was placed in the transcripts directory by hand and contains an unsanitized token, when `--show` prints from it, then the printed output is sanitized with `redactSafetyText` as well.

### Done When
- [ ] `ai-conductor transcripts «slug»` lists retained captures; `--show` prints the final assistant message for each provider's fixture capture.
- [ ] Unknown slug, empty capture, and no-assistant-message cases exit as specified; the command is read-only.
