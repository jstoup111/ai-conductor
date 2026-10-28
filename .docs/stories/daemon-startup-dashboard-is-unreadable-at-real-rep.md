**Status:** Accepted

# Stories: Daemon startup dashboard readable at real repo scale (#1332)

Technical intent comes from #1332's desired outcomes, the operator-confirmed scope (Balanced,
2026-10-24), and the architecture review
(`.docs/decisions/architecture-review-2026-10-24-daemon-startup-dashboard-is-unreadable-at-real-rep.md`).
That review amended `adr-2026-07-04-operator-park-marker` (D5) and
`adr-2026-07-03-owner-gate-gated-channel` (D3).

- **TI-1**: the first content line of the startup dashboard tells the operator whether anything
  needs them, and what.
- **TI-2**: groups render in display order: actionable groups (HALTED, BLOCKED, GATED), then
  active groups (IN-PROGRESS, WAITING, ELIGIBLE), then inert groups (PARKED, RETAINED WORKTREES,
  NEVER-STARTED, PROCESSED). Bucket precedence is unchanged.
- **TI-3**: on the console, inert groups take no more space than their count, plus the rows that
  still carry an operator remedy.
- **TI-4**: every console row fits the terminal width. Only free text is clipped; a slug never
  is.
- **TI-5**: merged specs that cannot build yet — blocked, waiting on a dependency, or held by the
  owner gate — are visible on the startup dashboard with their reason and remedy.
- **TI-6**: a slug appears in exactly one group, across every group including BLOCKED.
- **TI-7**: full detail stays reachable: `daemon.log` always gets the full render, and `--all` or
  `--completed` sends the full render to the console.

Terms used below:

- **Compact render**: the console render when neither `--all` nor `--completed` is given.
- **Full render**: every group header and every row with its complete text, the shape of today's
  dashboard. PROCESSED rows appear in it only when `--all` or `--completed` is given, as today.
- **Row budget**: `process.stdout.columns` when stdout is a TTY, otherwise 80, with a floor of
  40.
- **Remedy-bearing inert row**: a PARKED row annotated `orphan` or `merged-ready`, or a RETAINED
  WORKTREES row whose reason is anything other than `pr-open-awaiting-main`.

## Story 1: The first line says whether anything needs the operator

**Requirement:** TI-1

As an operator starting the daemon, I want the dashboard's first content line to say whether
anything is waiting on me, so I don't have to read every group to find out.

### Acceptance Criteria

#### Happy Path
- Given 2 halted features, 1 blocked spec, 0 gated entries, and 55 parked features of which 2 are annotated `orphan`, when the startup dashboard renders, then the line directly after the opening rule reads `NEEDS YOU: 2 halted · 1 blocked · 2 parked need review`, listing only the non-zero categories in the order halted, blocked, gated, parked need review, retained need action.
- Given 0 halted, 0 blocked, 0 gated, and no remedy-bearing inert rows, when the startup dashboard renders, then the line directly after the opening rule reads `NEEDS YOU: nothing`.
- Given any inherited state, when the startup dashboard renders, then the same attention line is the first content line of both the persisted `daemon.log` render and the console render.

#### Negative Paths
- Given 55 parked features none of which is annotated, and 30 retained worktrees all with reason `pr-open-awaiting-main`, when the startup dashboard renders, then the attention line reads `NEEDS YOU: nothing` and does not count parked or retained rows.
- Given the startup discovery partitions are unavailable (no discovery pass has completed), when the startup dashboard renders, then the attention line ends with `· discovery state unknown` and never reads `NEEDS YOU: nothing`.
- Given a GATED repo-scoped warning such as `identity-unresolved` with no slug, when the startup dashboard renders, then the attention line counts it under `gated` exactly as a per-spec gated entry is counted.

### Done When
- [ ] A `renderDashboard` test over a fixture with 2 halted, 1 blocked and 2 orphan-parked rows asserts the second output line equals `NEEDS YOU: 2 halted · 1 blocked · 2 parked need review`.
- [ ] A test over an all-inert fixture asserts the second line equals `NEEDS YOU: nothing`.
- [ ] A test with partitions unavailable asserts the second line contains `discovery state unknown` and not `nothing`.

## Story 2: Actionable groups render first, inert groups last

**Requirement:** TI-2

As an operator, I want the groups that need me rendered at the top, so the rows I must act on are
never buried below rows I can ignore.

### Acceptance Criteria

#### Happy Path
- Given at least one member in every group, when either render runs, then group headers appear in the order HALTED, BLOCKED, GATED, IN-PROGRESS, WAITING, ELIGIBLE, PARKED, RETAINED WORKTREES, NEVER-STARTED, PROCESSED.
- Given a slug that is both parked and halted, when either render runs, then it appears once, under PARKED, even though PARKED renders after HALTED.

#### Negative Paths
- Given HALTED has 0 members, when either render runs, then the HALTED header still renders as `HALTED (0)` in its position, so the actionable block is never silently absent.
- Given WAITING, BLOCKED, RETAINED WORKTREES, or NEVER-STARTED has 0 members, when either render runs, then that group's header is omitted, matching today's empty-group convention for those groups.
- Given discovery completed with 0 gated entries, when either render runs, then GATED renders its explicit empty header `GATED (0)`, and ELIGIBLE with 0 members renders `ELIGIBLE (0)`.
- Given PROCESSED rows exist and neither `--all` nor `--completed` is given, when the full render for `daemon.log` runs, then no PROCESSED rows are listed, matching today's persisted behavior.

### Done When
- [ ] A `renderDashboard` test with one member per group asserts the index order of the ten group headers in both modes.
- [ ] The existing PARKED-precedence acceptance test is updated to assert single-group membership rather than PARKED-first position, citing the amended `adr-2026-07-04-operator-park-marker` D5.

## Story 3: Inert groups collapse on the console

**Requirement:** TI-3

As an operator on a phone, I want parked, retained, never-started, and processed features to take
a single line each on the console, unless a row needs me.

### Acceptance Criteria

#### Happy Path
- Given 55 unannotated parked features, when the compact render runs, then PARKED renders as exactly one line, `PARKED (55)`, with no member rows.
- Given 55 parked features of which 2 are annotated `orphan` or `merged-ready`, when the compact render runs, then PARKED renders as `PARKED (55) — 2 need review` followed by exactly those 2 rows.
- Given 30 retained worktrees of which 1 has reason `pr-closed-unmerged`, when the compact render runs, then RETAINED WORKTREES renders as `RETAINED WORKTREES (30) — 1 needs action` followed by exactly that row.
- Given 12 processed features, when the compact render runs, then PROCESSED renders as the single line `PROCESSED (12)` with no member rows.

#### Negative Paths
- Given 4 never-started worktrees, when the compact render runs, then NEVER-STARTED renders as the single line `NEVER-STARTED (4)` with no member rows, because those rows carry no operator remedy.
- Given the same 55 parked and 30 retained features, when the full render for `daemon.log` runs, then every parked row and every retained row is listed, exactly as in today's dashboard.
- Given a fixture of 55 parked, 30 retained, 2 halted, 4 in progress, and 2 eligible features, when the compact render runs at an 80-column budget, then it contains at most 30 lines.

### Done When
- [ ] A compact-render test over the 55-parked/30-retained fixture asserts the PARKED and RETAINED sections and a total line count of 30 or fewer.
- [ ] A full-render test over the same fixture asserts all 55 parked and 30 retained slugs appear.

## Story 4: Console rows fit the terminal; slugs are never clipped

**Requirement:** TI-4

As an operator on a narrow terminal, I want each row to fit the width, so one long halt reason
doesn't push everything else off screen, while every slug stays copyable.

### Acceptance Criteria

#### Happy Path
- Given a row budget of 80 and a halted feature with a 280-character halt reason, when the compact render runs, then the row is a slug line `  • <slug> [<tier>] @<step>` followed by one indented detail line that starts with the halt reason, ends with `…`, and is exactly 80 characters long.
- Given a row budget of 120, when the compact render runs, then no line is longer than 120 characters.
- Given a BLOCKED, GATED, or remedy-bearing inert row, when the compact render runs, then it renders as a slug line plus one indented detail line carrying its reason, then its remedy, clipped to the row budget.
- Given an IN-PROGRESS, WAITING, or ELIGIBLE row, when the compact render runs, then it renders as a single line clipped to the row budget, with the slug and tier intact.

#### Negative Paths
- Given a row budget of 40 and a 50-character slug, when the compact render runs, then the slug line contains the full 50-character slug, unclipped, even though that line exceeds the budget.
- Given stdout is not a TTY, when the compact render runs, then the row budget is 80.
- Given `process.stdout.columns` reports 20, when the compact render runs, then the row budget is 40.
- Given a halt reason or remedy that contains a newline, when the compact render runs, then the detail line contains no newline: the text is joined with single spaces before clipping.
- Given a reason that already fits the budget, when the compact render runs, then the detail line is not padded and carries no trailing `…`.
- Given a row budget of 40, when the compact render runs, then the opening and closing rules are exactly 40 characters, every header, metric, and discovery-unknown line is at most 40 characters, and the attention line wraps at its ` · ` separators onto lines of at most 40 characters without dropping any category.

### Done When
- [ ] A compact-render test at budgets 40, 80, and 120 asserts every line except slug lines is at most the budget, and every slug appears in full.
- [ ] A test of the budget resolver asserts results 80 (non-TTY), 40 (columns 20), and 120 (columns 120).

## Story 5: Specs that cannot build yet are visible at startup

**Requirement:** TI-5

As an operator, I want blocked, dependency-waiting, and owner-gated specs on the startup
dashboard, so a dashboard showing nothing to do is never hiding merged specs stuck in discovery.

### Acceptance Criteria

#### Happy Path
- Given startup discovery classified a merged spec as blocked with reason `stories-not-approved` and a remedy, when the startup dashboard renders, then a BLOCKED group lists that slug with `stories-not-approved` and the remedy text.
- Given startup discovery classified a spec as waiting on an open blocker `jstoup111/ai-conductor#900`, when the startup dashboard renders, then a WAITING group lists that slug with `blocked by jstoup111/ai-conductor#900`.
- Given startup discovery classified a spec as `other-owner` gated, when the startup dashboard renders, then the GATED group lists that slug with its reason, owner, and remedy, and the count is not `0`.
- Given startup discovery ran once, when the startup dashboard renders, then the eligible, waiting, blocked, and gated entries all come from that same discovery pass, and no second discovery pass runs.
- Given the startup origin-refresh discovery pass failed and the daemon's local fallback discovery pass succeeded with one blocked spec, when the startup dashboard renders, then BLOCKED lists that spec from the fallback pass, no `unknown — discovery did not complete` line renders, and the daemon's startup maintenance steps after the dashboard still run.

#### Negative Paths
- Given no startup discovery pass has completed, when the startup dashboard renders, then BLOCKED, WAITING, GATED, and ELIGIBLE each render the single line `<GROUP>: unknown — discovery did not complete` instead of a count, and rendering completes without throwing.
- Given a blocked spec slug that is also operator-parked, when the startup dashboard renders, then the slug appears only under PARKED.
- Given discovery reports 0 blocked specs, when the startup dashboard renders, then no BLOCKED header renders, following the empty-group convention for WAITING.

### Done When
- [ ] A startup-dashboard test with an injected work source whose last pass held 1 blocked, 1 waiting, and 1 gated spec asserts all three slugs appear in the rendered output under BLOCKED, WAITING, and GATED.
- [ ] A binding test with no completed discovery pass asserts the four `unknown — discovery did not complete` lines and that rendering does not throw.
- [ ] A daemon-loop test whose origin-refresh pass rejects and whose local fallback pass resolves asserts the fallback's blocked spec renders under BLOCKED and later maintenance steps run.
- [ ] A test asserts the injected discovery function is called exactly once while the startup dashboard renders.

## Story 6: Each slug appears in exactly one group

**Requirement:** TI-6

As an operator, I want every feature shown in exactly one group, so counts add up and nothing is
double-reported.

### Acceptance Criteria

#### Happy Path
- Given a slug that is in both the blocked and the eligible partitions, when either render runs, then it appears only under BLOCKED.
- Given a slug that is both blocked and gated, when either render runs, then it appears only under BLOCKED.
- Given a slug that is blocked and also has a halted worktree, when either render runs, then it appears only under HALTED.

#### Negative Paths
- Given a randomized fixture in which every slug is placed in two to four partitions, when either render runs, then every slug appears in exactly one group, the one the precedence chain PARKED, HALTED, IN-PROGRESS, RETAINED WORKTREES, PROCESSED, BLOCKED, GATED, WAITING, ELIGIBLE ranks highest.
- Given a slug that is both retained and blocked, when the compact render collapses RETAINED WORKTREES to a count, then the slug is counted in RETAINED WORKTREES and does not reappear under BLOCKED.

### Done When
- [ ] A property-style test over generated multi-partition fixtures asserts, for both render modes, exactly one occurrence per slug in group membership and the expected winning group.

## Story 7: Full detail stays reachable

**Requirement:** TI-7

As an operator diagnosing a problem, I want the complete dashboard on demand and in the log, so
compacting the console never loses information.

### Acceptance Criteria

#### Happy Path
- Given the daemon starts without `--all` or `--completed`, when the startup dashboard is written, then `daemon.log` receives the full render and the console receives the compact render.
- Given the daemon starts with `--all`, when the startup dashboard is written, then the console receives the full render including PROCESSED rows.
- Given the daemon starts with `--completed`, when the startup dashboard is written, then the console receives the same full render as with `--all`.

#### Negative Paths
- Given a 328-character halt reason, when the full render runs, then the complete reason text appears unclipped and without `…` in `daemon.log`.
- Given 55 parked and 30 retained features and the compact render written to the console, when `daemon.log` is read, then it contains every one of the 55 parked and 30 retained slugs.

### Done When
- [ ] A startup-dashboard test with a captured `writeDashboard` asserts the persisted argument is the full render and the console argument is the compact render without flags.
- [ ] The same test with `showCompleted: true` asserts the console argument equals the full render with PROCESSED rows.
