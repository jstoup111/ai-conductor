**Status:** Accepted

# Stories: CI-fix log excerpt carries the failure, not the setup output

Source: jstoup111/ai-conductor#3106. Track: technical (no PRD). Tier: S.

Scope boundary (from `.docs/track/daemon-ci-fix-never-sees-the-test-failure-in-a-fai.md`): the
per-run workflow-log excerpt that `enrichCiFixHint` adds to the daemon CI-fix hint. The required
check metadata, the three-run read limit, the 24,576-byte total hint budget and its truncation, the
CI-fix agent prompt, and the `conductor` CI reporter output are unchanged.

Observed baseline: a failed run's `gh run view --log-failed` output (127,189 bytes for run
35624876796) starts with roughly 12 KB of checkout and fetch output, and its test output begins
after line 466. Today the read rejects any log over 65,536 bytes (Node `execFile` `maxBuffer`), so
that run yields no excerpt at all, and a log under that limit yields only its first 12,288 bytes.

Terms used below:

- **Per-run budget**: 12,288 UTF-8 bytes, the existing excerpt limit for one workflow run.
- **Failure line**: a log line containing any of `##[error]`, `FAIL` as a whole word, `✗`, `×`,
  `Error:`, `[ci-progress] failed test:`, `[ci-progress] stalled`, `[ci-progress] still running at
  run end:`, `[ci-progress] process exiting`, or a `[ci-progress] done` record whose status is
  `failed`. Matching is case-sensitive and anywhere in the line, so the job, step, and timestamp
  prefix that `--log-failed` adds to every line does not prevent a match.

## Story 1: The excerpt for a long failed log carries its failure lines and its end

**Requirement:** #3106 desired outcomes 1 and 2

As the daemon's CI-fix agent, I want each workflow-run excerpt to contain the log's failure lines and
its final lines, so that I can see which test failed without re-deriving it from setup output.

### Acceptance Criteria

#### Happy Path
- Given a failed-run log larger than the per-run budget whose first 12,288 bytes are checkout and `* [new branch]` fetch lines and whose later lines include `FAIL  test/engine/foo.test.ts > foo > bar` and `AssertionError: expected 1 to be 2`, when the hint is enriched, then that run's excerpt contains both of those lines and no more than the per-run budget of log text.
- Given a failed-run log larger than the per-run budget, when the hint is enriched, then that run's excerpt ends with the log's last line (for example `##[error]Process completed with exit code 1.`) and contains a contiguous run of the log's final lines.
- Given a failed-run log larger than the per-run budget that contains failure lines, when the hint is enriched, then the excerpt lists its failure lines in their original log order, under a labelled failure-lines section that appears before a labelled log-tail section.
- Given a failed-run log at or under the per-run budget, when the hint is enriched, then that run's excerpt is the whole log unchanged, with no section labels and no truncation marker.

#### Negative Paths
- Given a long failed-run log whose failure lines together exceed half the per-run budget, when the hint is enriched, then the excerpt keeps the earliest failure lines, states how many failure lines were omitted, and still includes the log tail, all within the per-run budget.
- Given a failure line longer than 512 bytes, when the hint is enriched, then the excerpt carries that line cut to at most 512 bytes with a truncation marker, so one oversized line cannot consume the failure-lines section.
- Given a long log of checkout output whose lines contain `error` or `fail` only in lowercase (for example `* [new branch] feat/fail-fast -> origin/feat/fail-fast`), when the hint is enriched, then none of those lines is listed as a failure line.
- Given a long log containing multibyte characters at every cut point, when the hint is enriched, then the excerpt contains no U+FFFD replacement character and stays within the per-run budget.

### Done When
- [ ] An `enrichCiFixHint` test over a synthetic 127 KB log shaped like run 35624876796 (12 KB of fetch lines, then Vitest output with a `FAIL` line and an `AssertionError:` line, then a `##[error]` final line) asserts the excerpt contains the `FAIL` line, the `AssertionError:` line, and the final line, and contains none of the leading fetch lines.
- [ ] An `enrichCiFixHint` test asserts a log under the per-run budget is passed through byte-for-byte.
- [ ] An `enrichCiFixHint` test asserts the per-run log text never exceeds 12,288 bytes for logs with many failure lines, an oversized failure line, and multibyte content.

## Story 2: A log without recognizable failure lines still yields an excerpt

**Requirement:** #3106 desired outcome 3

As the daemon's CI-fix agent, I want a failed run whose log has no recognizable failure line to still
contribute an excerpt, so that an unfamiliar CI tool's failure is not silently dropped.

### Acceptance Criteria

#### Happy Path
- Given a failed-run log larger than the per-run budget with no failure line, when the hint is enriched, then that run's excerpt is the log's final lines filling the per-run budget, ending with the log's last line, with a marker stating that earlier lines were omitted and no failure-lines section.

#### Negative Paths
- Given a failed-run log that is empty, when the hint is enriched, then no excerpt is added for that run and the required check metadata is still present in the hint.
- Given a failed-run log whose final line alone exceeds the per-run budget, when the hint is enriched, then the excerpt carries the end of that line cut to fit the per-run budget rather than an empty excerpt.

### Done When
- [ ] An `enrichCiFixHint` test over a long log with no failure line asserts a non-empty, tail-only excerpt ending with the log's last line and within 12,288 bytes.
- [ ] An `enrichCiFixHint` test over an empty log asserts the hint equals the required check metadata.

## Story 3: Failed logs larger than 64 KiB are read instead of dropped

**Requirement:** #3106 desired outcome 1 (verified read-limit baseline)

As the daemon's CI-fix agent, I want a typical failed-run log of over 100 KB to be read, so that the
excerpt exists at all for the long logs where the failure sits far from the start.

### Acceptance Criteria

#### Happy Path
- Given the CI-fix enrichment reads a failed-run log, when it calls the tracker, then it passes a read limit of 8 MiB (8,388,608 bytes) and the existing 10,000 ms timeout.
- Given a failed-run log of 127,189 bytes returned by the tracker, when the hint is enriched, then the run contributes an excerpt and no `log-unavailable` degradation is reported.

#### Negative Paths
- Given the tracker rejects a run's log read (for example a log above the read limit or a denied read), when the hint is enriched, then that run contributes no excerpt, `log-unavailable` is reported, and the other runs' excerpts and the required check metadata are still present.
- Given three failed runs each contributing a full per-run excerpt, when the hint is enriched, then the combined hint still never exceeds 24,576 bytes and reports `context-truncated` when it was cut.

### Done When
- [ ] The existing runner-options test asserts `maxBuffer: 8_388_608` and `timeout: 10_000`.
- [ ] A test through `makeProductionGh` with an injected `execFile` asserts that the read limit `enrichCiFixHint` passes reaches `execFile` as `maxBuffer: 8_388_608`, and that a 127,189-byte stdout from it is returned whole by `viewWorkflowRunFailedLog`.
