# Architecture Review: Surface Owner-Gated Specs in Dashboard and Status

**Date:** 2026-07-03
**Mode:** Lightweight (tier M) — feasibility + alignment
**Inputs reviewed:** PRD `2026-07-03-surface-owner-gated-specs-dashboard-status.md` (FR-1..FR-14),
approved architecture diagrams (same stem), decision memory (Approach C)
**Verdict:** APPROVED

## Feasibility

- **Gated channel (FR-1..FR-4):** `discoverBacklog` already returns `{ items, waiting }`
  (daemon-backlog.ts:257) — the structured-skip channel added by
  `adr-2026-07-03-dependency-gate-backlog-waiting-channel`, whose Decision section
  explicitly anticipates this feature: "the channel is deliberately shaped so #208 becomes
  'add a second reason kind.'" Adding a `gated` list (or a second reason kind) is an
  additive return-shape change with a known, small caller set (`localWorkSource`,
  `scanInheritedState`, tests). The owner gate already runs at daemon-backlog.ts:398-415
  and already computes `GateDecision` with the three per-spec reasons — the change is to
  collect instead of `continue`-drop. Low risk.
- **Dashboard bucket (FR-4):** `scanInheritedState`/`renderDashboard` gained the WAITING
  group in #246; GATED mirrors it. Bucket precedence extends naturally: owner gate runs
  BEFORE the dependency gate, so a gated spec never reaches the dependency check —
  exactly-one-bucket holds by construction.
- **Repo-level warnings (FR-11):** both signals exist (`warnIdentityUnresolvedOnce`,
  `warnGateNoCutoverOnce`, daemon-backlog.ts:289-315). One behavioral subtlety: the
  identity-unresolved path currently short-circuits with `return { items: [], waiting: [] }`
  BEFORE the per-spec scan — the gated result must carry a repo-scoped warning entry from
  that early return, or the dashboard shows an empty-but-unexplained repo. Feasible;
  called out as a required story.
- **Snapshot for status (FR-5..FR-7, FR-14):** `runDaemonStatus` already stat/reads
  per-repo `.daemon/` files (`readPidRecord`, daemon-observe-cli.ts:94), so reading a
  per-repo gated snapshot fits its existing I/O pattern; no re-scan, no network. No
  existing atomic-write convention found in `.daemon/` handling — the snapshot ADR
  specifies write-temp-then-rename.
- **Write-back (FR-8..FR-10, FR-12):** all primitives exist and are best-effort by design:
  `upsertComment` (marker-comment edit-in-place, pr-labels.ts:459), `ensureLabel`/`addLabel`
  (REST), `findOrCreatePr`, with `escalateBuildFailure` as the orchestration template. The
  gated case is simpler (the spec PR already exists post-merge... note: the spec PR may be
  MERGED/CLOSED by the time the daemon gates the spec — commenting a merged PR is valid on
  GitHub and `upsertComment` operates by PR number, so this works; the Source-Ref issue is
  the more operator-visible surface and is covered by FR-9).
- **No new dependencies, no schema/migration, no new service.** Worktree isolation: all new
  state lives under the target repo's `.daemon/` (gitignored, per-checkout), consistent
  with existing daemon state.

## Alignment

- **Follows the ratified skip-channel pattern** (`adr-2026-07-03-dependency-gate-backlog-waiting-channel`,
  APPROVED): structured skip data flows through the discovery result the dashboard already
  consumes; no second scan. This feature is the second consumer that ADR planned for.
- **No conflict with that ADR's Option B rejection:** Option B rejected a side-channel file
  as the *dashboard's* source of truth (stale/racy). Here the dashboard stays on the live
  channel; the snapshot is a read model ONLY for the out-of-process status CLI, which
  cannot call `discover()` cheaply (registry-wide sweep, no per-repo config/identity). The
  snapshot never feeds the dashboard. Freshness is labeled (FR-6), staleness self-heals by
  whole-file rewrite (FR-7).
- **Write-back mirrors adr-015 (daemon PR-labeling sweep) + needs-remediation:** same
  pr-labels seam, same hidden-marker idempotency, same advisory/never-blocking semantics
  (FR-12). New label + marker are additive; no changes to existing flows.
- **Warn-once semantics:** aligned with the waiting-channel ADR's "warn-once per state
  change" (not once-forever), so ownership changes re-announce. The existing
  `.daemon/warned/` per-slug markers remain the log-line dedup; the write-back dedup is
  keyed by the marker comment itself (server-side), avoiding a second local ledger.
- **Gate outcomes byte-identical (NFR):** the feature only observes `GateDecision`; it must
  not alter decisions or ordering. Stories must assert the built set is unchanged.
- **EKS/remote-first (project constraint):** write-back rides the existing `gh` seam; no
  local-machine assumptions added.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Snapshot read/write race (status reads mid-write) | Data | Medium | Low | Write-temp + atomic rename; reader treats parse failure as "unknown" (FR-14) |
| Identity-unresolved early return bypasses gated collection | Technical | High | Medium | Dedicated story: early return must still emit repo-warning entry + snapshot |
| Write-back spam if marker lookup fails silently | Integration | Low | Medium | Mirror upsertComment's PATCH-terminal semantics (no fallback create); negative-path story |
| Stale snapshot misread as current | Data | Medium | Low | Written-at timestamp rendered as age; "unknown" when missing (FR-6/FR-14) |
| Return-shape change ripples to callers/tests | Technical | Low | Low | Additive field; same coordinated-change path #246 just exercised |

## ADRs Created

- `adr-2026-07-03-owner-gate-gated-channel.md` — gated entries + repo-level warnings ride
  the discovery-result skip channel (extends the waiting-channel ADR as planned)
- `adr-2026-07-03-gated-snapshot-status-read-model.md` — per-pass atomic `.daemon/gated.json`
  as the status CLI's read model
- `adr-2026-07-03-gated-writeback-announcements.md` — warn-once-per-state-change PR/issue
  announcements via the pr-labels seam

## Conditions

None — APPROVED, subject to the three ADRs reaching APPROVED status before stories.
