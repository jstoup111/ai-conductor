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

## Story: Authorized gated spec PR announcements preserve local visibility

**Requirement:** FR-8, FR-10, FR-12; adr-2026-09-11-github-operation-ownership D8

### Acceptance Criteria

#### Happy Path
- Given an independently authorized PR announcement, when write-back runs, then it applies an existing owner-gated label and upserts one marker comment with the reason and remedy after local gated state is recorded.
- Given repeated authorized announcements or a reason change, when write-back runs, then one marker comment remains and its body reflects the current authorized reason.

#### Negative Paths
- Given a spec gated as other-owner, when write-back finds its PR, then no PR label, comment, or body mutation occurs and local GATED visibility remains available.
- Given authorization or evidence is missing, conflicting, or unavailable, when write-back runs, then no remote mutation occurs and a typed refusal remains available.
- Given an authorized merged PR, when write-back runs, then merged state alone does not prevent the authorized announcement.
- Given an authorized comment edit fails, when write-back handles the failure, then it never creates a duplicate comment as fallback and local visibility remains intact.
- Given no PR exists, when write-back runs, then it does not create a PR or change branch state.
- Given a needed shared label is absent, when explicit shared-resource permission is absent, then label creation is refused rather than force-updating a shared definition.

### Done When
- [ ] Two-operator fixtures show zero foreign PR mutations while local GATED output persists.
- [ ] Authorized fixtures retain one-comment idempotency, reason updates, local-before-remote ordering, and no create-after-edit-failure behavior.

---

## Story: Intake-originated gated announcements require independent issue permission

**Requirement:** FR-9, FR-10, FR-12; adr-2026-09-11-github-operation-ownership D8

### Acceptance Criteria

#### Happy Path
- Given a valid Source-Ref and independent issue authorization, when write-back runs, then the source issue receives the marker-comment upsert with reason and remedy without changing its assignees.

#### Negative Paths
- Given a source issue owned by another operator, when write-back runs, then a valid Source-Ref alone does not permit any issue mutation.
- Given no intake marker or an invalid Source-Ref, when write-back runs, then no issue is guessed and no malformed remote call occurs.
- Given an authorized closed issue, when write-back runs, then closed state alone does not prevent the authorized comment.
- Given an authorized issue write fails after an authorized PR write succeeded, when the pass ends, then no rollback is attempted on the PR and neither surface reports a false success.
- Given a repo-level warning without a target, when write-back runs, then no GitHub write occurs.

### Done When
- [ ] Source-Ref resolution and issue authorization are independently exercised; foreign, missing, malformed, and unavailable evidence produce no write.
- [ ] Authorized issue updates preserve assignees and per-surface best-effort independence.
