**Status:** Accepted

# Stories: Observed-close — issues close on first production observation (#492)

Technical track (no PRD). Requirement tags reference the APPROVED ADR
`adr-2026-07-10-observed-close-watch-registry.md` sections. Terminology: "marker" =
`.docs/observation/<plan-stem>.md`; "registry" = `.daemon/observation-watch.jsonl`;
"surface" = `.daemon/daemon.log` (+ `daemon.log.1`).

## Story: Observation marker parses and validates

**Requirement:** ADR §1

As the harness, I want a well-defined observation-marker artifact so that every spec
declares how its fix will be observed (or explicitly opts into close-on-merge).

### Acceptance Criteria

#### Happy Path
- Given a marker with `Signature: ▶ build 0/`, `Surface: daemon-log`, `Window-days: 14`,
  when it is parsed, then it yields a watched declaration with that substring signature,
  surface `daemon-log`, and a 14-day window.
- Given a marker with `Signature: /halt cleared: .+/` (regex form), when parsed, then the
  signature compiles as an anchored-free regex and is flagged as regex (not substring).
- Given a marker with `Signature: close-on-merge` and a non-empty `Rationale:` line, when
  parsed, then it yields a close-on-merge declaration.

#### Negative Paths
- Given a marker with `Signature: close-on-merge` and no `Rationale:` line (or a
  whitespace-only one), when parsed, then parsing fails with an error naming the missing
  rationale — it does not default to watched or to close-on-merge.
- Given a marker whose `Signature:` is a regex that does not compile (e.g. `/[unclosed/`),
  when parsed, then parsing fails naming the regex error — never a silent fallback to
  substring matching.
- Given a marker with no `Signature:` line at all, when parsed, then parsing fails — an
  empty declaration is not grandfathering (only a *missing file* is).
- Given a marker with `Window-days: 0` or a non-numeric value, when parsed, then parsing
  fails naming the invalid window — no silent default.
- Given a marker with an unknown `Surface:` value (e.g. `events`), when parsed, then
  parsing fails naming the v1-supported surface — the field is reserved, not ignored.

### Done When
- [ ] A parser module exposes parse → `{kind: 'watched', signature, isRegex, windowDays} | {kind: 'close-on-merge', rationale}` with the failure cases above as typed errors.
- [ ] Unit tests cover every happy/negative case above and pass.

## Story: Engineer land gate asserts the marker

**Requirement:** ADR §1

As the operator, I want `engineer land` to reject a spec without a valid observation
marker so that no new spec can reach the daemon without declaring its close semantics.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose `.docs/` set includes a valid watched marker stem-matched to the
  plan, when `engineer land` runs, then the land succeeds and the marker is part of the
  landed commit.
- Given a valid `close-on-merge` marker with rationale, when `engineer land` runs, then
  the land succeeds.

#### Negative Paths
- Given a worktree with plan `.docs/plans/foo.md` but no `.docs/observation/foo.md`, when
  `engineer land` runs, then land fails naming the missing observation marker and the
  worktree is left intact (keep-on-failure).
- Given a marker present but malformed (any parse failure from the parser story), when
  `engineer land` runs, then land fails quoting the parse error.
- Given a marker whose stem does not match the plan stem (e.g. `.docs/observation/bar.md`
  with plan `foo.md`), when `engineer land` runs, then land fails naming the stem mismatch.

### Done When
- [ ] `engineer land` on a markerless worktree exits non-zero with the missing-marker message; with a valid marker it lands (integration test).
- [ ] The gate error text names the expected path `.docs/observation/<plan-stem>.md`.

## Story: Ship-time trailer is conditional on the declaration

**Requirement:** ADR §2, §4

As the daemon, I want watched fixes to link (not close) their issue at merge so that the
close event can move to first observation, while unwatched paths stay byte-identical.

### Acceptance Criteria

#### Happy Path
- Given a built feature whose worktree carries a watched marker and a `sourceRef`, when
  the post-run issue-link step runs, then the implementation PR body gains `Refs
  owner/repo#N` (no `Closes`) and a v1 registry entry is appended with sourceRef, prUrl,
  slug, signature, surface, windowDays, and enrolledAt.
- Given a built feature whose marker declares `close-on-merge`, when the post-run step
  runs, then the PR body gains `Closes owner/repo#N` exactly as today and no registry
  entry is written.
- Given a built feature with NO marker (legacy spec), when the post-run step runs, then
  behavior is byte-identical to today (`Closes` injected, no registry write).

#### Negative Paths
- Given a feature with no `sourceRef` (hand-authored spec), when the post-run step runs,
  then nothing is injected and nothing is enrolled (existing early return preserved).
- Given a halted build (no `pr_url`), when the post-run step runs, then nothing is
  injected and nothing is enrolled — a watch entry without a PR must never exist.
- Given a watched marker that is present but unreadable/malformed at ship time (e.g.
  corrupted in the build worktree), when the post-run step runs, then the daemon logs the
  parse failure and falls back to today's `Closes` path — a broken marker must not strand
  the issue linkless or block the ship (best-effort contract).
- Given the registry append fails (e.g. `.daemon` unwritable), when enrollment runs, then
  the failure is logged and the ship outcome is unaffected; the PR still carries `Refs`.
- Given a watched fix whose PR was born as a halt PR, when halt-PR rehabilitation flips it
  ready and ensures its issue ref, then it ensures `Refs` (not `Closes`) — resolved from
  the same declaration via a shared keyword-resolution helper (conflict resolution
  2026-07-10: rehabilitation must not silently restore merge-close on the recovery path).
- Given a legacy or close-on-merge fix's halt PR, when rehabilitation ensures its issue
  ref, then it ensures `Closes` exactly as today.

### Done When
- [ ] Unit tests over the extended issue-link step cover all cases above and pass.
- [ ] A test asserts the legacy (no-marker) path produces a PR body and registry state byte-identical to the pre-feature behavior.
- [ ] Both injection call sites (post-run step and halt-PR rehabilitation) resolve the keyword through one shared helper, asserted by a test on each site.

## Story: Registry survives daemon restarts and malformed lines

**Requirement:** ADR §2, §3

As the daemon, I want the observation registry to be durable and tolerant so that watches
outlive restarts and one bad line never poisons the sweep.

### Acceptance Criteria

#### Happy Path
- Given two entries enrolled before a daemon restart, when the daemon starts and the sweep
  reads the registry, then both entries are present with their persisted state (including
  `mergedAt` and `lastPollAt` if set).

#### Negative Paths
- Given a registry file containing a malformed JSON line between two valid entries, when
  the sweep reads it, then the two valid entries are processed and the malformed line is
  dropped on the next survivors rewrite (logged, never thrown).
- Given a registry entry missing the `v` tag or with `v: 2`, when the sweep reads it, then
  the entry is skipped and logged as unrecognized-schema — never misinterpreted.
- Given concurrent enrollment during a sweep's survivors rewrite, when both complete, then
  no entry is lost (the rewrite must re-read or the append must be ordered — data-integrity
  test pins whichever contract the implementation chooses).

### Done When
- [ ] Registry read/append/rewrite helpers have unit tests for all cases above and pass.
- [ ] A restart-shaped test (enroll → new sweep instance → read) confirms durability.

## Story: Awaiting-merge entries poll gently and transition correctly

**Requirement:** ADR §3

As the daemon, I want enrolled watches to notice their PR's fate without burning gh quota
so that watching starts exactly at merge and dead PRs are cleaned up.

### Acceptance Criteria

#### Happy Path
- Given an awaiting-merge entry whose PR reports MERGED with a mergedAt timestamp, when
  the sweep processes it, then the entry records `mergedAt` and transitions to watching.
- Given an awaiting-merge entry polled less than 5 minutes ago (`lastPollAt`), when the
  sweep runs, then NO gh call is made for that entry this tick.

#### Negative Paths
- Given an entry whose PR reports CLOSED (unmerged), when the sweep processes it, then the
  originating issue receives a watch-cancelled comment and the entry is pruned; the issue
  stays open.
- Given the gh PR-state call fails (outage/quota), when the sweep processes the entry,
  then the failure is logged, the entry survives unchanged, and the sweep continues with
  other entries (never throws).
- Given ten awaiting-merge entries all past their poll interval, when one sweep tick runs,
  then each entry makes at most one gh state call (no per-entry retry storms within a tick).

### Done When
- [ ] Sweep unit tests with a fake gh runner + injected clock cover all cases above and pass.
- [ ] A test asserts zero gh invocations when `lastPollAt` is within the 5-minute floor.

## Story: First post-merge observation closes the issue

**Requirement:** ADR §3

As the operator, I want the issue to close the moment the fixed behavior is first observed
in the daemon log so that a closed issue always means "exercised in production".

### Acceptance Criteria

#### Happy Path
- Given a watching entry with `mergedAt` T and a daemon.log line matching the signature
  timestamped T+1h, when the sweep scans, then `gh issue close` runs with a comment
  quoting the matched line and its timestamp, and the entry is pruned.
- Given the matching line lives only in the rotated `daemon.log.1`, when the sweep scans,
  then it is still found (both files scanned).

#### Negative Paths
- Given a signature-matching line timestamped BEFORE `mergedAt` (old code emitted it), when
  the sweep scans, then it does NOT count — the entry stays watching (engine-vintage race,
  #482).
- Given the `gh issue close` call fails transiently, when the sweep processes the match,
  then the entry survives and the close is retried on a later tick; when the issue turns
  out to be already closed, then the entry is pruned without error (idempotency).
- Given a watching entry scanned less than 60 seconds ago, when the sweep runs, then no
  log scan happens for that entry this tick (scan throttle).
- Given a log line that contains the signature text but with no leading ISO timestamp
  (corrupt/partial line), when the sweep scans, then that line is ignored — never treated
  as a match with an assumed time.

### Done When
- [ ] Sweep tests with fixture logs (fresh + rotated, pre- and post-merge timestamps) cover all cases above and pass.
- [ ] The close comment format includes the literal matched line and its timestamp, asserted in a test.

## Story: A never-observed fix is flagged, never silently closed

**Requirement:** ADR §3 (no-show)

As the operator, I want a loud no-show flag when a merged fix's behavior is never observed
so that green-but-unwired ships (#462) become visible instead of closed.

### Acceptance Criteria

#### Happy Path
- Given a watching entry whose `enrolledAt + windowDays` has passed with no post-merge
  match, when the sweep processes it, then the issue receives a no-show comment (naming
  the signature and window) plus the `observation:no-show` label via REST (`gh api`), the
  issue REMAINS OPEN, and the entry is pruned.

#### Negative Paths
- Given the label-add REST call fails, when the no-show fires, then the comment is still
  attempted, the failure is logged, and the entry is pruned (no infinite re-flag loop) —
  the comment and label are independent best-effort actions.
- Given a match arrives on the same tick the window would expire, when the sweep
  processes the entry, then the match wins (close, not no-show) — the observation check
  runs before the expiry check.
- Given the daemon was down for the entire window and restarts after expiry, when the
  first sweep runs, then a signature line that appeared post-merge during the outage still
  counts as observed (scan-before-expiry ordering) — the no-show fires only when the log
  truly holds no post-merge match.

### Done When
- [ ] No-show tests with an injected clock cover all cases above and pass.
- [ ] The label is applied via `gh api` REST (asserted on the fake runner's argv), not `gh issue edit --add-label`.

## Story: The sweep is wired into the production daemon and can never block it

**Requirement:** ADR §3, §4 — anti-orphaning (#462 lesson: merged ≠ loaded ≠ exercised)

As the operator, I want the observation sweep reachable from the real daemon entry point
and provably harmless so that this feature cannot itself ship green-but-unwired or destabilize builds.

### Acceptance Criteria

#### Happy Path
- Given a production daemon started via the real CLI entry (`conduct-ts daemon start`
  wiring), when an idle tick fires, then `sweepObservationWatch` is invoked with the
  production registry path and gh runner (dependency bound in `daemon-cli.ts`, invoked
  from `sweepBestEffort` — asserted from the entry-point wiring, not the primitive).
- Given the sweep enrolls, transitions, closes, or flags, when it acts, then each action
  emits a `[daemon]`-prefixed log line into daemon.log (the machinery's own behavior is
  observable — and provides this feature's own observation signature).

#### Negative Paths
- Given `sweepObservationWatch` throws unexpectedly (bug, fs error), when `sweepBestEffort`
  runs, then the error is caught and logged and the daemon loop, dispatch, and the other
  sweeps proceed unaffected.
- Given an empty or absent registry, when the sweep runs, then it makes zero gh calls,
  zero log scans, and emits no log noise.

### Done When
- [ ] A wiring test (or real-binary smoke) asserts the production `sweepBestEffort` path invokes the observation sweep — not just that the exported primitive works.
- [ ] A throw injected into the sweep leaves a test daemon's dispatch loop functional (existing sweepBestEffort error-isolation pattern extended, test passes).
- [ ] `src/conductor/README.md` documents the registry, marker, sweep cadence, and no-show semantics (docs-track-features).
