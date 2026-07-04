**Status:** Accepted

# Stories: Operator Park — human park survives autonomous re-dispatch

Source PRD: `.docs/specs/2026-07-04-operator-park.md` (FR-1..FR-7)
ADRs: `adr-2026-07-04-operator-park-marker.md`, `adr-2026-07-04-park-unpark-cli-verbs.md`

---

## Story: Operator parks a feature by slug

**Requirement:** FR-1

As the operator, I want `conduct-ts daemon park <slug>` to durably mark a feature "do not
touch" so that the daemon leaves it alone until I say otherwise.

### Acceptance Criteria

#### Happy Path
- Given a halted feature `<slug>` (worktree with live `.pipeline/HALT`), when I run
  `conduct-ts daemon park <slug>`, then the command exits 0, prints a confirmation stating the
  feature will not be dispatched or re-kicked until unparked, and `.daemon/parked/<slug>` exists
  with a provenance body (timestamp + "parked by operator").
- Given a backlog spec `<slug>` that has never been dispatched (no worktree), when I run
  `daemon park <slug>`, then the command exits 0 and `.daemon/parked/<slug>` exists — parking
  does not require a worktree or a halt.
- Given the repo's daemon is not running, when I run `daemon park <slug>`, then the park
  succeeds identically — no supervisor, tmux session, or live daemon is contacted.

#### Negative Paths
- Given `<slug>` matches no backlog stem and no worktree directory, when I run
  `daemon park <slug>`, then the command exits non-zero with an error naming the unknown slug,
  and `.daemon/parked/` contains no new entry.
- Given `.daemon/` does not exist yet (fresh checkout), when I run `daemon park <slug>` for a
  known slug, then the directory chain is created and the park succeeds (no ENOENT crash).
- Given I run `daemon parkk <slug>` (typo subcommand), when the CLI dispatches, then it fails
  loudly as an unknown subcommand and does NOT fall through to launching the SDLC pipeline.

### Done When
- [ ] `daemon park <known-slug>` exits 0 and creates `.daemon/parked/<slug>` (verified on disk)
- [ ] Park succeeds for a never-dispatched backlog slug and with the daemon stopped
- [ ] `daemon park <unknown-slug>` exits non-zero, writes nothing
- [ ] Both verbs appear in `conduct --help` output

---

## Story: A parked feature is never autonomously dispatched or resumed

**Requirement:** FR-2

As the operator, I want every autonomous path — discovery, startup scan, polling ticks, and
sentinel resume — to treat a parked slug as ineligible so the park holds indefinitely.

### Acceptance Criteria

#### Happy Path
- Given `.daemon/parked/<slug>` exists and `<slug>` is an otherwise-eligible backlog item, when
  the daemon polls (any tick), then `<slug>` is not dispatched and no worktree is created for it.
- Given a parked, halted feature whose `.pipeline/HALT` was manually removed, when the next poll
  runs, then the PR-#109 discovery un-park path still does NOT re-dispatch it (park outranks
  halt-cleared eligibility).
- Given a parked feature with a pending `.pipeline/REKICK` sentinel, when the daemon would
  resume it, then the resume is skipped and the sentinel is left unconsumed.
- Given a parked feature, when the daemon is restarted N times with base advances in between,
  then across all restarts and sweeps there are zero dispatches, zero model invocations, and
  zero build attempts for `<slug>` (zero-burn NFR).

#### Negative Paths
- Given the parked-existence check for `<slug>` fails with a non-ENOENT error (e.g. `EACCES` on
  `.daemon/parked/`), when any autonomous path evaluates `<slug>`, then the slug is treated as
  parked for that pass and the anomaly is logged — the error is never read as "not parked".
- Given `.daemon/parked/<slug>` is an empty file (zero bytes), when eligibility is evaluated,
  then presence alone parks the slug — contents are never parsed for control flow.

### Done When
- [ ] Discovery/dispatch eligibility consults the parked marker via the canonical module (single
      import; no re-spelled `.daemon/parked` paths at call sites)
- [ ] Tests cover: tick skip, halt-cleared skip, sentinel-resume skip, restart persistence
- [ ] Fail-toward-parked on check error is asserted with an injected fs error

---

## Story: Base-advance sweep skips parked worktrees non-destructively

**Requirement:** FR-3

As the operator, I want the re-kick sweep to leave a parked feature completely untouched so a
merge to main can never burn runs on work I've parked.

### Acceptance Criteria

#### Happy Path
- Given a parked worktree with live `.pipeline/HALT` (body `B`) and a genuine base-SHA advance,
  when `rekickSweep` runs, then `<slug>` is in `skipped`, `.pipeline/HALT` still exists with
  body exactly `B`, no `HALT.cleared` is written, no `REKICK` sentinel is dropped, and the log
  contains `re-kick <slug>: skipped — parked by operator`.
- Given the same parked worktree also has a rebase paused mid-flight, when the sweep runs, then
  `git rebase --abort` is NOT invoked for it (parked check precedes the abort/clear chain).
- Given the sweep skipped a parked slug at SHA `X`, when main advances to SHA `Y`, then the slug
  is skipped again — a park is not once-per-SHA, it is unconditional.

#### Negative Paths
- Given a parked slug, when the sweep evaluates it, then the parked check runs BEFORE
  `isProcessed` and before the last-rekick-SHA guard — a parked slug never consumes or updates
  `lastRekickSha` state.
- Given the sweep's parked check throws for one slug, when the sweep continues, then that slug
  is skipped (fail-toward-parked), the error is logged, and remaining slugs are still processed
  (per-worktree isolation preserved).

### Done When
- [ ] `rekickSweep` unit tests: parked slug → `skipped`, HALT byte-identical, no cleared/sentinel
      files, no abort call, no `lastRekickSha` mutation
- [ ] Skip log line asserted verbatim
- [ ] Error-in-check test: slug skipped, sweep completes for siblings

---

## Story: Unpark restores ordinary behavior

**Requirement:** FR-4

As the operator, I want `conduct-ts daemon unpark <slug>` to return the feature to exactly the
state it would otherwise be in.

### Acceptance Criteria

#### Happy Path
- Given a parked, halted feature, when I run `daemon unpark <slug>`, then the command exits 0,
  `.daemon/parked/<slug>` is removed, and on the next genuine base advance the sweep clears its
  HALT and the feature is re-dispatched exactly as today's halted flow does.
- Given a parked, never-dispatched backlog slug, when I unpark it, then the next poll treats it
  as ordinarily eligible.

#### Negative Paths
- Given `<slug>` is not parked, when I run `daemon unpark <slug>`, then the command exits 0 with
  a clear "was not parked" message and no filesystem change occurs (safe no-op).
- Given the marker file is removed by unpark, when the daemon's in-flight tick had already read
  it as parked, then the feature is picked up on the following tick — unpark never requires a
  daemon restart to take effect.

### Done When
- [ ] `daemon unpark <parked-slug>` exits 0, removes the marker; subsequent sweep/dispatch
      behavior matches the never-parked baseline in tests
- [ ] `daemon unpark <not-parked-slug>` exits 0, prints the no-op message, changes nothing

---

## Story: Machine-placed halts keep today's re-kick behavior

**Requirement:** FR-5

As the daemon, I want step-failure halts to keep their exact current lifecycle so the sanctioned
rebase-on-latest flywheel is unaffected by the park feature.

### Acceptance Criteria

#### Happy Path
- Given two halted worktrees `A` (parked) and `B` (not parked) and a genuine base advance, when
  the sweep runs once, then in the same pass `B`'s HALT is renamed to `HALT.cleared`, `B` gets a
  `REKICK` sentinel and re-dispatches on the next poll — while `A` is skipped untouched.
- Given no feature in the repo is parked, when the sweep runs, then its behavior (clears, skips,
  logs, `lastRekickSha` updates) is byte-for-byte identical to the pre-feature behavior.

#### Negative Paths
- Given `B` (not parked) was already re-kicked at the current SHA, when the sweep runs again at
  that SHA, then `B` is still skipped by the FR-9 guard — the parked check does not weaken or
  bypass existing skip conditions.

### Done When
- [ ] Mixed-pass test: parked sibling untouched, un-parked sibling cleared, in one sweep call
- [ ] Existing rekick test suite passes unchanged (no behavioral regression for un-parked slugs)

---

## Story: Parked features are visible as their own dashboard group

**Requirement:** FR-6

As the operator, I want parked features surfaced distinctly in status/dashboard output so parks
never rot silently.

### Acceptance Criteria

#### Happy Path
- Given a parked, halted feature, when the daemon dashboard renders, then the feature appears
  once, under a `PARKED` group (not under `HALTED`). `PARKED` takes precedence over **every**
  other group (HALTED, PROCESSED, GATED, IN-PROGRESS, WAITING, ELIGIBLE — including groups added
  by sibling specs); the existing groups' relative order among themselves is unchanged.
- Given a parked, never-dispatched backlog slug, when the dashboard renders, then it appears
  under `PARKED`, not `ELIGIBLE`.

#### Negative Paths
- Given no parked features, when the dashboard renders, then no `PARKED` section noise is
  added beyond an empty-group header consistent with existing empty groups, and output for all
  other groups is unchanged from today.
- Given `.daemon/parked/` contains a marker for a slug with no worktree AND no backlog entry
  (stale park after a slug rename), when the dashboard renders, then the stale park is listed
  under `PARKED` (visible, not hidden) so the operator can notice and unpark it.

### Done When
- [ ] Dashboard grouping test: both-markers slug renders once as PARKED
- [ ] Precedence asserted with a fixture containing every existing group (incl. GATED and
      WAITING): PARKED wins over each; interior order unchanged
- [ ] Stale-park fixture renders visibly under PARKED

---

## Story: Park verb edge semantics — idempotent re-park, mid-run park

**Requirement:** FR-7

As the operator, I want the verbs to be safe under repetition and mid-run timing so I can use
them without checking daemon state first.

### Acceptance Criteria

#### Happy Path
- Given `<slug>` is already parked, when I run `daemon park <slug>` again, then it exits 0,
  reports the existing park (including its original timestamp), and the marker file's content
  and mtime are unchanged (no rewrite).
- Given the daemon is mid-run on `<slug>`'s build, when I park it, then the running attempt is
  not interrupted, and when that attempt ends (DONE or HALT), no further autonomous decision
  (re-dispatch, sweep clear, sentinel resume) touches `<slug>` while the park stands.

#### Negative Paths
- Given two `daemon park <slug>` invocations race (double-tap from two shells), when both
  complete, then exactly one marker exists, both exit 0, and the marker is not corrupted
  (idempotent create, no partial write).
- Given `.daemon/parked/<slug>` exists, when the daemon itself writes any state for `<slug>`
  (ledger, processed, warned), then the parked marker is never modified or removed by any
  daemon code path — only the unpark verb removes it (operator-owned invariant).

### Done When
- [ ] Re-park test asserts unchanged content + mtime and exit 0
- [ ] Concurrent double-park test yields one intact marker, two zero exits
- [ ] Grep-level assertion: no daemon (non-CLI-verb) code path writes to or removes from
      `.daemon/parked/` (single-writer invariant enforced via the canonical module's API shape)
