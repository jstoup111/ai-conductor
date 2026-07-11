**Status:** Accepted

# Stories: gate-writeback skip-notice warn-once dedup

Technical track (no PRD). Source: issue jstoup111/ai-conductor#379. Tier: S.

Intent: the three per-pass skip notices in `gate-writeback.ts` (no-PR, terminal PR state,
no-usable-Source-Ref) must log at most once per `(slug, reason)` per daemon run via an
in-memory dedup injected through `GateWritebackDeps`, and must read as benign skips —
without changing any announce/upsert behavior.

## Story 1: No-PR skip notice logs once per daemon run

As an operator scanning `.daemon/daemon.log`, I want the "no PR known" skip notice for a
gated spec to appear once per daemon run so that an idle daemon does not flood the log with
lines that read like failures.

### Acceptance Criteria

#### Happy Path
- Given a daemon run whose gated set contains spec `S` with no known implementation PR
  (`prUrl` falsy), when `announceGatedPr` runs on two consecutive discover passes with the
  same injected dedup state, then the no-PR skip notice for `S` is logged exactly once
  (first pass only) and the second pass logs nothing for `S`.
- Given the same dedup state, when `announceGatedPr` runs for two DIFFERENT gated specs `S1`
  and `S2`, both with no PR, then one notice is logged for each of `S1` and `S2`.
- Given a fresh daemon run (new in-memory dedup state, e.g. after a restart), when
  `announceGatedPr` runs for spec `S` still without a PR, then the notice is logged once
  again in the new run.

#### Negative Paths
- Given spec `S` whose no-PR skip was already logged (dedup key recorded), when a later
  discover pass finds `S` now HAS a PR URL (open/merged state), then the announce path
  proceeds normally — the label is ensured/applied and the marker comment upserted — i.e.
  the dedup suppresses only the skip LOG, never the announcement work.
- Given no dedup state is injected into `GateWritebackDeps` (legacy caller / bare deps),
  when `announceGatedPr` skips the same no-PR spec on two consecutive calls, then the
  notice is logged on BOTH calls (prior behavior preserved as the fallback).

### Done When
- [ ] A test drives `announceGatedPr` twice for the same slug with `prUrl` falsy and a
      shared injected dedup state, asserting exactly one skip log line total.
- [ ] A test with two distinct slugs asserts two log lines (one per slug).
- [ ] A test with a fresh dedup state asserts the notice re-appears once.
- [ ] A test with no dedup state injected asserts two calls produce two log lines.
- [ ] A test asserts that after a suppressed skip, a subsequent call with a real `prUrl`
      still performs the label + comment upserts (spy on the injected `runGh`).

## Story 2: Terminal-PR-state skip notice logs once per daemon run

As an operator, I want the "PR is CLOSED/NOTFOUND" skip notice deduped the same way so that
a gated spec with a dead PR does not re-log identically every ~5s poll.

### Acceptance Criteria

#### Happy Path
- Given a daemon run whose gated spec `S` has a PR in state `CLOSED` (or `NOTFOUND`), when
  `announceGatedPr` runs on two consecutive discover passes with the same injected dedup
  state, then the terminal-state skip notice for `S` is logged exactly once.
- Given spec `S` was already suppressed under the no-PR reason, when a later pass finds `S`
  has a PR but it is `CLOSED`, then the terminal-state notice IS logged once — the dedup
  key is `(slug, reason)`, so a different reason for the same slug logs once per reason.

#### Negative Paths
- Given the terminal-state skip for `S` was already logged and suppressed, when `gh`
  errors during a later pass's `prMergeState` lookup, then `announceGatedPr` still returns
  without throwing (best-effort contract unchanged).
- Given no dedup state is injected, when the terminal-state skip fires on two consecutive
  calls, then it logs on both calls (fallback preserves prior behavior).

### Done When
- [ ] A test drives `announceGatedPr` twice with a fake `runGh` reporting `CLOSED`, shared
      dedup state, asserting exactly one terminal-state skip log line.
- [ ] A test drives the same slug through the no-PR reason then the `CLOSED` reason,
      asserting one log line per reason (two total).
- [ ] The non-throwing contract is asserted (no rejection) when the injected `runGh`
      throws mid-pass with dedup state present.

## Story 3: No-usable-Source-Ref skip notice logs once per daemon run

As an operator, I want the "no usable Source-Ref" issue-announcement skip deduped so that
chat-originated or unparseable-ref gated specs do not spam the log.

### Acceptance Criteria

#### Happy Path
- Given gated spec `S` whose `sourceRef` fails to parse (present but malformed), when
  `announceGatedIssue` runs on two consecutive passes with the same injected dedup state,
  then the skip notice is logged exactly once.
- Given spec `S` was suppressed for the no-PR reason in `announceGatedPr`, when
  `announceGatedIssue` skips `S` for the Source-Ref reason in the same run, then the
  Source-Ref notice still logs once (independent reason key — the PR-path and issue-path
  dedup never mask each other).

#### Negative Paths
- Given the Source-Ref skip for `S` was already suppressed, when a later pass presents a
  now-VALID `sourceRef` for `S`, then the issue announcement proceeds normally (label +
  issue marker comment upserted) — dedup never blocks the announcement work.
- Given `sourceRef` is absent entirely (undefined — chat-originated spec), when
  `announceGatedIssue` runs, then the existing silent-skip behavior for the absent case is
  unchanged by this feature (whatever it logs today, it logs no MORE than today).
- Given no dedup state is injected, then consecutive unparseable-ref skips log every call
  (fallback preserved).

### Done When
- [ ] A test drives `announceGatedIssue` twice with a malformed `sourceRef` and shared
      dedup state, asserting exactly one skip log line.
- [ ] A test asserts the PR-path and issue-path reasons dedupe independently for the same
      slug in one run.
- [ ] A test asserts a valid `sourceRef` after suppression still performs the issue label +
      comment upserts.
- [ ] Existing `announceGatedIssue` tests for the absent-`sourceRef` case pass unmodified.

## Story 4: Skip notices self-identify as benign

As an operator scanning the log, I want each skip notice worded as a benign, self-explaining
skip so that I can tell "nothing to announce yet, will retry" apart from "write-back broke".

### Acceptance Criteria

#### Happy Path
- Given any of the three skip conditions fires for gated spec `S`, when the notice is
  logged, then its wording states WHAT is missing and that the daemon will retry when it
  exists — e.g. `[gate-writeback] nothing to announce for gated spec "S" (no PR) — will
  retry when one exists` — and retains the `[gate-writeback]` prefix and the slug.

#### Negative Paths
- Given the reworded notices, when the existing `test/engine/gate-writeback.test.ts` suite
  runs, then every assertion pinned to the OLD wording has been updated in the same change —
  no test remains green by accidentally matching neither old nor new wording (assertions
  match the new strings exactly).

### Done When
- [ ] All three skip notices use benign will-retry wording including the
      `[gate-writeback]` prefix, the quoted slug, and the missing-thing reason.
- [ ] `npx vitest run test/engine/gate-writeback.test.ts` passes with assertions updated to
      the new wording.
- [ ] The daemon-cli `announceGated` call site injects one shared per-run dedup state so
      production gets once-per-run semantics for all three notices.
