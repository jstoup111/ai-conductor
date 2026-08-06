**Status:** Accepted

# Stories: Worktree classification, retained reasons, and the operator lever (#1329)

Technical intent, derived from #1329's desired outcomes and the two APPROVED ADRs
(`adr-2026-08-05-worktree-classification-evidence-derived-reasons`,
`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`):

- **TI-1** — a feature with no HALT, no park, an unpushed branch and no commits is dispatchable,
  and appears in a bucket the daemon acts on rather than one it excludes.
- **TI-2** — a worktree that has never initialised pipeline state is distinguishable, in the
  dashboard, from one retained after a verified ship.
- **TI-3** — a retained row's stated reason matches reality: a row claiming a PR is awaiting main
  appears only when an open PR for that slug has been established.
- **TI-4** — a genuinely shipped-and-retained worktree whose PR is open is still excluded from
  dispatch (negative path — must not regress).
- **TI-5** — when a feature is excluded from dispatch for any reason, an operator can determine
  which reason applies and what action would resume it, from `daemon status` alone.
- **TI-6** — no non-`done` dispatch outcome leaves a feature stopped without an operator-clearable
  marker.

## Story 1: A never-started worktree is classified apart from a retained ship

**Requirement:** TI-2

As an operator reading the daemon dashboard, I want a worktree that has never written pipeline
state to be reported as its own case so I can tell "never started" from "finished and reaped"
without inspecting the filesystem.

### Acceptance Criteria

#### Happy Path

- Given a directory under `.worktrees/` with no `.pipeline/conduct-state.json`, no HALT marker and
  no processed-ledger entry, when the dashboard state is scanned, then that slug is reported in a
  never-started bucket and is absent from the retained-worktree collection.
- Given a worktree whose `.pipeline/` holds only setup-era artifacts (`git-hooks`,
  `session-hooks`, `step-heartbeat`, `task-evidence.json`, `events.jsonl`, `audit-trail`), when the
  dashboard state is scanned, then it is classified never-started rather than retained.
- Given a worktree that has written `conduct-state.json`, when the dashboard state is scanned, then
  it is reported IN-PROGRESS exactly as before and appears in no never-started bucket.

#### Negative Paths

- Given a `.pipeline/conduct-state.json` containing malformed JSON, when the dashboard state is
  scanned, then the slug is reported IN-PROGRESS with step `unknown` and is NOT classified
  never-started — a file that exists but does not parse is not "never started".
- Given a worktree whose `.pipeline/conduct-state.json` is unreadable due to a permissions error,
  when the dashboard state is scanned, then classification does not throw and the scan completes
  for every other worktree.
- Given an infrastructure directory whose name begins with `resolve-` or `engineer-` and which has
  no pipeline state, when the dashboard state is scanned, then it is excluded from the
  never-started bucket exactly as it is excluded from the retained bucket today.

### Done When

- [ ] `scanInheritedState` returns the never-started slugs in a collection distinct from
      `retainedWorktrees`, and the retained collection contains no slug lacking pipeline state.
- [ ] A unit test asserts the setup-era-artifacts-only worktree lands in the never-started
      collection and not in `retainedWorktrees`.
- [ ] A unit test asserts malformed `conduct-state.json` still yields an IN-PROGRESS entry with
      step `unknown` and no never-started entry.
- [ ] `resolve-`/`engineer-` prefixed directories appear in neither collection.

## Story 2: A never-started feature stays dispatchable

**Requirement:** TI-1

As an operator, I want a feature with no HALT, no park, an unpushed branch and no commits to
remain eligible so it is not silently excluded with no lever to clear.

### Acceptance Criteria

#### Happy Path

- Given a slug that discovery reports as eligible and whose worktree has never written pipeline
  state, when the dashboard is rendered, then that slug appears in ELIGIBLE.
- Given the same slug, when the daemon selects work, then dispatch behavior is unchanged from
  before this change — dispatch consults the backlog, never the dashboard's classification.
- Given a never-started slug with no HALT and no park marker, when the dashboard is rendered, then
  it appears in neither HALTED nor PARKED.

#### Negative Paths

- Given a never-started slug that ALSO carries an operator park marker, when the dashboard is
  rendered, then PARKED wins and the slug is excluded from ELIGIBLE — the never-started bucket
  never overrides a higher-precedence bucket.
- Given a never-started slug that ALSO carries a live `.pipeline/HALT`, when the dashboard is
  rendered, then it is reported HALTED and excluded from ELIGIBLE.
- Given a never-started slug that discovery did not report as eligible (its spec is gated or
  waiting), when the dashboard is rendered, then it is not manufactured into ELIGIBLE.

### Done When

- [ ] A unit test asserts a never-started, unparked, unhalted eligible slug is present in the
      rendered ELIGIBLE list.
- [ ] A unit test asserts park and HALT each still take precedence over the never-started bucket.
- [ ] No dispatch-path module reads the never-started or retained collections — verified by the
      absence of any import of those fields outside the dashboard render path.

## Story 3: A retained row's reason is derived from evidence

**Requirement:** TI-3

As an operator, I want a retained row to state only what the daemon has actually established so a
row never asserts a merge is pending when no PR exists.

### Acceptance Criteria

#### Happy Path

- Given a retained slug whose processed-ledger entry records a PR URL and whose PR-state probe
  reports that PR open, when the dashboard is rendered, then its reason states the PR is awaiting
  main and names the PR URL.
- Given a retained slug whose ledger records a PR URL and whose probe reports that PR closed and
  unmerged, when the dashboard is rendered, then its reason states the closed-unmerged case and not
  the awaiting-main case.
- Given a retained slug whose ledger entry is legacy plain-text `shipped` with no PR URL, when the
  dashboard is rendered, then its reason states that a ship was recorded with no PR reference
  rather than asserting an open PR.

#### Negative Paths

- Given no PR-state probe is injected at all, when the dashboard is rendered, then every retained
  reason that would require probe evidence renders as an explicit unknown, and no row claims a PR
  is awaiting main.
- Given a PR-state probe that throws or times out for a slug, when the dashboard is rendered, then
  that row's reason degrades to the explicit unknown, the scan completes for all other rows, and no
  positive claim is substituted.
- Given a PR-state probe that returns a slug it was not asked about, when the dashboard is
  rendered, then the unrelated response is ignored rather than attributed to the queried slug.
- Given six retained slugs where only one has an open PR, when the dashboard is rendered, then
  exactly one row claims a PR is awaiting main.

### Done When

- [ ] No code path can emit the awaiting-main reason without an established open PR for that slug —
      the reason string is unreachable from a branch that has not consulted PR evidence.
- [ ] A unit test renders six retained slugs with one open PR and asserts exactly one awaiting-main
      row.
- [ ] A unit test asserts a throwing probe yields an explicit unknown reason and a completed scan.
- [ ] A unit test asserts an absent probe never produces an awaiting-main row.

## Story 4: A shipped-and-retained worktree with an open PR stays excluded from dispatch

**Requirement:** TI-4

As an operator, I want a feature that genuinely shipped and whose PR is still open to remain
excluded from the eligible set so this change never causes a merged-pending feature to be rebuilt.

### Acceptance Criteria

#### Happy Path

- Given a slug present in the processed ledger with a PR URL whose probe reports the PR open, when
  the dashboard is rendered, then the slug appears in RETAINED and is absent from ELIGIBLE.
- Given the same slug, when discovery also reports it as eligible, then the rendered ELIGIBLE list
  still excludes it.
- Given a slug whose pipeline finished and whose ledger entry is absent (the closed-unmerged
  reclaim case), when the dashboard is rendered, then it remains retained and excluded from
  ELIGIBLE as it is today.

#### Negative Paths

- Given a shipped-and-retained slug whose PR-state probe fails, when the dashboard is rendered,
  then it remains excluded from ELIGIBLE — probe failure downgrades the stated reason, never the
  exclusion.
- Given a shipped-and-retained slug with no pipeline state remaining on disk (its worktree was
  reaped down to an empty directory), when the dashboard is rendered, then the processed-ledger
  entry still governs and it remains retained rather than being reclassified never-started.
- Given a shipped-and-retained slug, when the never-started classification is evaluated, then the
  ledger entry takes precedence and the slug is never placed in the never-started bucket.

### Done When

- [ ] A regression test asserts a processed-ledger slug with an open PR is absent from the rendered
      ELIGIBLE list.
- [ ] A regression test asserts probe failure leaves the exclusion intact while changing only the
      reason text.
- [ ] A test asserts ledger presence outranks missing pipeline state for classification.

## Story 5: Every excluded feature states its reason and its remedy

**Requirement:** TI-5

As an operator, I want `daemon status` to tell me, for each feature that is not being dispatched,
why it is excluded and what action resumes it, so I never have to inspect the filesystem to find
the lever.

### Acceptance Criteria

#### Happy Path

- Given a slug excluded because it is operator-parked, when the dashboard is rendered, then its row
  names the park as the reason and names the unpark action that resumes it.
- Given a slug excluded because a HALT marker is present, when the dashboard is rendered, then its
  row names the halt reason and names clearing the marker as the resuming action.
- Given a slug excluded because it is retained after a ship, when the dashboard is rendered, then
  its row names the retention, the condition that ends it, and the existing reclaim verb
  (`.docs/stories/daemon-reaps-a-feature-worktree-at-pr-open-before-.md` Story S5) as the operator
  action where reclaim applies.
- Given a slug in the never-started bucket, when the dashboard is rendered, then its row states
  that no pipeline state was ever written and that the feature remains dispatchable.

#### Negative Paths

- Given a slug excluded for a reason with no operator action available, when the dashboard is
  rendered, then the row explicitly says no operator action applies rather than omitting the
  remedy line.
- Given a slug whose HALT marker is empty, when the dashboard is rendered, then the reason renders
  as `unknown` with the remedy still present, and rendering does not throw.
- Given a slug that qualifies for two exclusion reasons at once, when the dashboard is rendered,
  then exactly one row is emitted for it, carrying the higher-precedence reason.
- Given zero excluded features, when the dashboard is rendered, then no orphan reason or remedy
  lines are printed.

### Done When

- [ ] Every rendered row for a non-dispatched slug carries both a reason and a remedy line.
- [ ] A test asserts a slug qualifying for two reasons is rendered exactly once, with the
      higher-precedence reason.
- [ ] A test asserts an empty HALT marker renders `unknown` with the remedy line intact.
- [ ] `docs/guides/running-the-daemon.md` and the stalled-or-stuck runbook describe the new buckets
      and remedy lines.

## Story 6: A failed dispatch always leaves an operator-clearable marker

**Requirement:** TI-6

As an operator, I want any dispatch that ends in a non-`done` state to leave a marker I can find
and clear, so a feature can never be stopped with no lever.

### Acceptance Criteria

#### Happy Path

- Given a dispatch whose conductor run throws after the worktree exists, when the outcome is
  collected, then an operator-clearable marker exists in that worktree naming the failing stage and
  the resuming action, and the outcome is `error`.
- Given a dispatch where worktree creation itself throws before any worktree handle exists, when
  the outcome is collected, then an operator-clearable marker exists at the slug's deterministic
  worktree path and the outcome is `error`.
- Given such a marker is subsequently cleared by the operator, when the daemon next selects work,
  then the slug becomes eligible again through the existing halt-clear resume path, with no new
  retry mechanism involved.

#### Negative Paths

- Given worktree creation throws AND the marker write itself fails, when the outcome is collected,
  then the failure is logged as an explicit unrecoverable-state warning naming the slug, and the
  daemon does not report an error outcome while implying a lever exists.
- Given a dispatch that errors, when the outcome is collected, then the daemon does NOT
  re-dispatch the slug automatically on the next tick — the stop persists until the marker is
  cleared.
- Given a dispatch that errors twice in succession after the operator clears the marker each time,
  when the outcomes are collected, then a marker is present after each failure and no unbounded
  retry loop occurs.
- Given worktree creation throws because the target path exists but is not a valid git worktree,
  when the marker is written, then the write targets that path and the marker's remedy text
  accounts for the directory not being a usable worktree.

### Done When

- [ ] The error path derives the marker location from the slug, not from a worktree handle, so a
      creation failure still produces a marker.
- [ ] A unit test injects a throwing `createWorktree` and asserts a marker exists at the
      deterministic path and the outcome is `error`.
- [ ] A unit test asserts a failed marker write emits an explicit warning naming the slug.
- [ ] A test asserts no automatic re-dispatch follows an errored outcome while the marker is
      present.
