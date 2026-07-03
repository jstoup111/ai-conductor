**Status:** Accepted

# Stories: Surface Owner-Gated Specs in Dashboard and Status

PRD: `.docs/specs/2026-07-03-surface-owner-gated-specs-dashboard-status.md` (issue #208, tier M)
ADRs: `adr-2026-07-03-owner-gate-gated-channel`, `adr-2026-07-03-gated-snapshot-status-read-model`,
`adr-2026-07-03-gated-writeback-announcements` (all APPROVED)

---

## Story: Discovery emits structured gated entries instead of dropping skipped specs

**Requirement:** FR-1, FR-2

As a daemon operator, I want every owner-gate skip captured as a structured entry so that
gated work can be displayed instead of vanishing into the log.

### Acceptance Criteria

#### Happy Path
- Given a merged spec stamped `Owner: alice` and a daemon resolved as `bob`, when a discovery
  pass runs, then the discovery result's gated list contains an entry for that slug with
  reason `other-owner` naming `alice`, and the slug is absent from the eligible items.
- Given an un-owned merged spec whose first appearance is after the configured
  `owner_gate_cutover`, when a discovery pass runs, then the gated list contains the slug
  with reason `unowned-post-cutover`.
- Given an un-owned merged spec whose merge time cannot be derived (no addition commit found),
  when a discovery pass runs, then the gated list contains the slug with reason
  `unowned-indeterminate`.

#### Negative Paths
- Given the same repo fixture, when discovery runs once with the gated channel present and
  once against the pre-change behavior, then the eligible `items` sets are byte-identical —
  the gated channel must not add, remove, or reorder buildable specs (visibility-only NFR).
- Given a spec that fails a content filter (missing stories) AND would also fail the owner
  gate, when discovery runs, then it appears in neither `items` nor `gated` (content filters
  run first; the gate never evaluates it) and only the existing content-skip warn line fires.
- Given a spec owned by the daemon's own identity, when a discovery pass runs, then it is in
  `items` and NOT in `gated` (no false-positive gating of owned work).
- Given an intake marker whose `Owner:` line is present but blank (`Owner:   `), when
  discovery runs, then the spec is treated as un-owned (existing provenance semantics) and
  gated with the correct un-owned reason — not crashed on, not treated as owned.

### Done When
- [ ] Discovery result carries a `gated` list alongside `items` and `waiting`, one entry per
      owner-gate skip: `{ slug, reason, otherOwner?, remedy }`.
- [ ] Unit tests cover all three per-spec reasons plus the owned/content-filtered exclusions.
- [ ] A regression test asserts `items` equality with and without the gated channel on a
      fixture containing owned, other-owned, un-owned, and content-ineligible specs.

---

## Story: Dashboard renders a GATED group with reason and remedy per slug

**Requirement:** FR-1, FR-3, FR-4, FR-13

As a daemon operator, I want a GATED section in the startup dashboard so that blocked-by-
ownership work is visible next to HALTED / IN-PROGRESS / WAITING / ELIGIBLE / PROCESSED.

### Acceptance Criteria

#### Happy Path
- Given a scan that gated `2026-07-01-foo` as `other-owner: alice`, when the startup
  dashboard renders, then a `GATED` section lists `2026-07-01-foo` with the owner name and a
  remedy hint referencing ownership declaration.
- Given a spec gated as `unowned-post-cutover`, when the dashboard renders, then its remedy
  hint references adding an `Owner:` marker; given `unowned-indeterminate` with no cutover
  configured, the hint references setting `owner_gate_cutover`.

#### Negative Paths
- Given a slug that is both processed and would be gated (stale ledger scenario), when the
  dashboard renders, then the slug appears ONLY in PROCESSED (existing precedence wins) —
  never in two buckets.
- Given a scan with zero gated specs, when the dashboard renders, then the GATED section is
  rendered in its explicit empty form consistent with how WAITING/ELIGIBLE handle empty
  (never a missing-vs-empty ambiguity between dashboard and status surfaces).
- Given discovery throws mid-scan (existing `backlog discovery failed` path), when the
  dashboard renders, then the GATED section shows the same failure fallback as ELIGIBLE
  today — not a fabricated empty state presented as authoritative.

### Done When
- [ ] `renderDashboard` output contains a GATED section listing slug + reason + remedy,
      placed alongside the existing groups.
- [ ] A test proves the exactly-one-bucket invariant over a fixture with a spec in every
      bucket type.
- [ ] Empty and scan-failure renderings are asserted verbatim in tests.

---

## Story: Repo-level gate warnings surface on the dashboard, including fail-closed identity

**Requirement:** FR-11

As a daemon operator, I want repo-wide gate conditions shown on the dashboard so that an
empty backlog caused by a misconfigured daemon is never mistaken for "no work."

### Acceptance Criteria

#### Happy Path
- Given the owner gate is active but `owner_gate_cutover` is unset and an un-owned spec was
  encountered, when the dashboard renders, then a repo-level warning line states that
  un-owned specs are being skipped and names the cutover setting as the remedy.

#### Negative Paths
- Given the daemon's owner identity is supplied but UNRESOLVED (no `spec_owner`, no gh
  login), when a discovery pass runs, then the early fail-closed return still emits a
  repo-level warning entry in the gated channel (per `adr-2026-07-03-owner-gate-gated-channel`)
  and the dashboard shows "building NOTHING — identity unresolved" with the remedy — an
  empty dashboard with no explanation is a test failure.
- Given the gate is unwired (no `daemonOwner` supplied — legacy mode), when the dashboard
  renders, then NO repo-level warning and NO GATED entries appear (silent legacy behavior
  preserved).
- Given a cutover IS configured and all specs are owned, when the dashboard renders, then no
  repo-level warning appears (no false alarms).

### Done When
- [ ] Identity-unresolved and no-cutover conditions each produce one repo-scoped entry in
      the gated channel, rendered as warning lines in the GATED section.
- [ ] A test drives the identity-unresolved early return and asserts the warning entry
      exists in the discovery result (not only in the log).
- [ ] Legacy (gate-unwired) fixture asserts zero gated output.

---

## Story: Every discovery pass atomically rewrites the gated snapshot

**Requirement:** FR-7 (plus ADR snapshot contract)

As a daemon operator, I want gated state persisted fresh each scan so that stale gated claims
self-heal without cleanup logic.

### Acceptance Criteria

#### Happy Path
- Given a discovery pass with two gated specs and one repo warning, when the pass completes,
  then `.daemon/gated.json` contains `schemaVersion`, a current `writtenAt` timestamp, both
  per-spec entries, and the repo warning.
- Given a spec that was gated last pass and gained an `Owner:` stamp since, when the next
  pass completes, then the snapshot no longer contains it (whole-file rewrite, no cleanup
  code path).

#### Negative Paths
- Given a pass with ZERO gated specs, when it completes, then the snapshot is rewritten as
  an explicit empty snapshot with fresh `writtenAt` — an unchanged stale file is a failure
  (FR-13's "explicitly none" signal).
- Given the identity-unresolved early return (no per-spec scan ran), when the pass
  completes, then the snapshot is still written, containing the repo warning and an empty
  gated list.
- Given a reader opens the snapshot at any point while a writer is mid-rewrite, when the
  read completes, then it sees either the previous complete snapshot or the new complete
  snapshot — never a torn/partial file (write-temp + rename on the same filesystem).
- Given the snapshot write itself fails (e.g. `.daemon/` unwritable, disk full), when the
  pass completes, then the failure is logged, the dashboard (live channel) is unaffected,
  and dispatch/build behavior is unchanged — snapshot failure never blocks the scan.

### Done When
- [ ] Snapshot written via temp-file + rename at the end of every discovery pass, including
      empty and early-return passes.
- [ ] Snapshot schema includes `schemaVersion` and `writtenAt`; serializer and dashboard
      consume the SAME in-memory gated list (single-writer helper, asserted by test).
- [ ] Tests cover: populated, empty-pass overwrite, early-return write, unwritable
      directory, and torn-read impossibility (rename atomicity exercised via injected fs).

---

## Story: daemon status shows per-repo gated state with freshness

**Requirement:** FR-5, FR-6, FR-13, FR-14

As a daemon operator checking from my phone, I want `conduct-ts daemon status` to show gated
work per repo so that I can diagnose an ownership stall without shell access to logs.

### Acceptance Criteria

#### Happy Path
- Given a repo whose snapshot contains gated entries, when `daemon status` runs, then under
  that repo's liveness row a GATED section lists each slug, reason, and remedy hint, plus an
  age label derived from `writtenAt` (e.g. "as of 3m ago").
- Given a repo whose snapshot is an explicit empty snapshot, when `daemon status` runs, then
  the output states no specs are gated (consistent wording with the dashboard's empty form).

#### Negative Paths
- Given a repo with NO snapshot file (daemon never ran since the feature shipped), when
  `daemon status` runs, then the repo shows "gated state unknown — no scan recorded", not an
  implied all-clear and not a crash.
- Given a snapshot containing invalid JSON (truncated by a crash), when `daemon status`
  runs, then that repo shows "gated state unknown — snapshot unreadable", other repos render
  normally, and the exit code is unchanged.
- Given a snapshot with an unrecognized `schemaVersion`, when `daemon status` runs, then the
  repo degrades to the same explicit unknown state (forward-compat guard) rather than
  misrendering fields.
- Given a registry entry whose path is missing (existing `path-missing` liveness), when
  `daemon status` runs, then no snapshot read is attempted for it and the existing liveness
  row is unchanged.
- Given `daemon status` runs 100 times against a large registry, when observed, then it
  performs zero git commands and zero network calls for the gated section (read-only
  snapshot access; assert via injected runner recording).

### Done When
- [ ] `runDaemonStatus` renders a gated section per repo from `.daemon/gated.json` only.
- [ ] Freshness age rendered from `writtenAt`; unknown states for missing, unreadable, and
      version-mismatched snapshots each asserted verbatim.
- [ ] Injected-runner test proves no git/gh spawn on the status path — plus one real-binary
      smoke run of `conduct-ts daemon status` against a fixture repo (injected-runner argv
      tests alone are insufficient per harness feedback).

---

## Story: Gated spec PR gets a warn-once announcement and label

**Requirement:** FR-8, FR-10, FR-12

As a collaborating operator, I want a gated spec's PR to say it is blocked and why so that
the block is visible where the work lives.

### Acceptance Criteria

#### Happy Path
- Given a spec newly gated as `other-owner: alice` whose spec PR exists, when the pass's
  write-back runs, then the PR gains the `owner-gated` label and one comment carrying the
  hidden marker, the reason, and the remedy hint.
- Given the same spec still gated on the next 10 passes, when write-back runs each pass,
  then the PR still has exactly ONE marker comment (upsert edits in place; count asserted).
- Given the gate reason transitions (`unowned-indeterminate` → `other-owner` after a stamp
  appears), when write-back runs, then the single existing comment's body is updated to the
  new reason.

#### Negative Paths
- Given the spec PR is already MERGED (normal for a merged spec), when write-back runs, then
  the comment/label apply to the merged PR without error (GitHub permits both).
- Given `gh` exits non-zero on the comment upsert (rate limit, network), when write-back
  runs, then the failure is logged once, no retry storm occurs within the pass, and the
  scan's gated channel + snapshot are already written (ordering asserted: local state
  before GitHub calls) — dispatch and dashboard are unaffected.
- Given the marker-comment lookup succeeds but the in-place edit (PATCH) fails, when
  write-back runs, then NO fallback create is attempted (mirrors `upsertComment` terminal
  PATCH semantics — duplicate pileup is the failure being prevented).
- Given no PR exists for the spec branch (local-commit fallback spec), when write-back runs,
  then the PR step is skipped with a logged notice — no `findOrCreatePr` draft creation for
  gated specs (write-back must never mutate repo branch state).
- Given label creation races another daemon (`ensureLabel` conflict), when write-back runs,
  then the existing best-effort semantics swallow the conflict and the comment still lands.

### Done When
- [ ] New hidden marker constant and `owner-gated` label wired through the existing
      pr-labels seam (REST label calls, not `gh pr edit --add-label`).
- [ ] Idempotency test: 10 gated passes → exactly one comment, one label.
- [ ] Reason-transition test updates the comment body in place.
- [ ] Failure-injection tests: PATCH failure (no create), gh unavailable (advisory,
      ordering preserved), missing PR (skip, no branch mutation).

---

## Story: Intake-originated gated specs announce on the Source-Ref issue

**Requirement:** FR-9, FR-10, FR-12

As the operator who filed the intake issue, I want the originating issue to show the block so
that intake work I'm tracking doesn't stall silently.

### Acceptance Criteria

#### Happy Path
- Given a gated spec whose committed intake marker carries `Source-Ref: owner/repo#42`, when
  write-back runs, then issue #42 receives the same marker-comment upsert with reason and
  remedy (one living comment, updated on reason change).

#### Negative Paths
- Given a gated spec with NO intake marker (chat-originated), when write-back runs, then the
  issue step is skipped silently — no error, no attempt to guess an issue.
- Given the intake marker exists but its `Source-Ref:` line is malformed
  (`Source-Ref: not-a-ref`), when write-back runs, then the issue step is skipped with a
  logged notice — never a gh call with garbage arguments.
- Given the referenced issue is CLOSED, when write-back runs, then the comment still posts
  (commenting closed issues is valid and is the visible-where-it-lives intent).
- Given the issue comment fails but the PR comment succeeded, when write-back completes,
  then the PR announcement is not rolled back and the pass completes normally (per-surface
  independence; both advisory).
- Given repo-level warnings (identity unresolved / no cutover) exist this pass, when
  write-back runs, then NO GitHub write occurs for them (ADR: dashboard/status-only).

### Done When
- [ ] Source-Ref parsing reuses the existing single parse source (`issue-ref.ts`), never a
      new regex.
- [ ] Tests: valid ref, absent marker, malformed ref, closed issue, per-surface failure
      independence, repo-warning exclusion.

---
