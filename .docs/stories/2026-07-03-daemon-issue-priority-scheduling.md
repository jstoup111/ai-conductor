**Status:** Accepted

# Stories: Daemon Issue-Priority Scheduling

**PRD:** `.docs/specs/2026-07-03-daemon-issue-priority-scheduling.md`
**ADRs:** `adr-2026-07-03-priority-from-linked-issue-labels`, `adr-2026-07-03-priority-fetch-fail-soft`
**Source:** jstoup111/ai-conductor#200

---

## Story: Unlinked specs build before all issue-linked specs

**Requirement:** FR-2

As an operator, I want specs I commissioned directly (no originating issue) to build first,
so that my deliberate direct asks are never queued behind triaged intake work.

### Acceptance Criteria

#### Happy Path
- Given a pending backlog of one unlinked spec (merged 2026-07-01) and one spec linked to a
  `priority: high` issue (merged 2026-06-25), when the daemon picks its next feature, then it
  picks the unlinked spec first and the high-priority spec second.
- Given a backlog where every pending spec is unlinked, when the daemon orders the backlog,
  then the order equals today's chronological order and no priority lookup of any kind is
  attempted (no network activity for ordering).

#### Negative Paths
- Given a spec whose committed intake marker exists but contains a garbled/unparseable issue
  reference, when the backlog is ordered, then that spec is treated as unlinked (top band) and
  no error is raised — matching the existing behavior where a garbled marker yields no linked
  issue.
- Given an empty pending backlog, when the daemon scans, then ordering produces an empty list
  and no priority lookup occurs (no crash, no warning).

### Done When
- [ ] With a mixed backlog (unlinked + linked-high), daemon log/dispatch order shows the
      unlinked slug dispatched first.
- [ ] An all-unlinked backlog produces zero priority-source calls (verifiable via injected
      label-reader test double recording zero invocations).
- [ ] A garbled intake marker lands its spec in the top band without any warning or skip.

---

## Story: Issue-linked specs build in priority-label order

**Requirement:** FR-1, FR-3

As an operator, I want issue-linked specs built high → medium → low based on the linked
issue's priority label, so that the most valuable pending work builds next.

### Acceptance Criteria

#### Happy Path
- Given three pending linked specs whose issues carry `priority: low`, `priority: high`, and
  `priority: medium` respectively, when the daemon orders the backlog, then dispatch order is
  high → medium → low regardless of merge dates.
- Given a pending spec linked to an issue in a different repository than the daemon's repo,
  when the backlog is ordered, then that issue's priority label is honored identically
  (cross-repo reference resolved per-ref).

#### Negative Paths
- Given a linked issue that has been deleted or returns not-found, when priorities are
  resolved, then that spec falls to the unlabeled (lowest) band, this is NOT treated as an
  outage, and every other spec keeps its labeled band.
- Given a linked issue carrying only a label that merely resembles the vocabulary (e.g.
  `priority: urgent` or `Priority-High`), when priorities are resolved, then the unknown label
  is ignored and the spec lands in the unlabeled band (closed vocabulary: exactly
  `priority: high|medium|low`).
- Given a linked issue that is CLOSED but still labeled `priority: high`, when priorities are
  resolved, then its label is still honored (issue state does not affect ordering — only
  eligibility gates decide buildability).

### Done When
- [ ] Ordering test proves high → medium → low dispatch across differing merge dates.
- [ ] Cross-repo ref test resolves labels for a non-daemon-repo issue reference.
- [ ] Not-found issue → unlabeled band, zero outage warnings, other bands unaffected.
- [ ] Unknown/near-miss label strings never map to a priority band.

---

## Story: Specs with unlabeled issues build last

**Requirement:** FR-4

As an operator, I want issue-linked specs whose issue has no priority label to build after
all labeled ones, so that skipping triage never jumps the queue.

### Acceptance Criteria

#### Happy Path
- Given two pending linked specs — one whose issue has no `priority: *` label (merged
  2026-06-20) and one whose issue is `priority: low` (merged 2026-07-02), when the daemon
  orders the backlog, then the `low` spec builds before the unlabeled one despite being newer.

#### Negative Paths
- Given a linked issue whose labels list is present but empty, when priorities are resolved,
  then the spec lands in the unlabeled band (no crash on empty list).
- Given a linked issue whose label payload is malformed (e.g. unexpected shape from the API),
  when priorities are resolved, then resolution treats that issue as unlabeled and does NOT
  trigger the whole-scan outage fallback (malformed content ≠ transport failure).

### Done When
- [ ] Ordering test proves low-labeled beats unlabeled regardless of dates.
- [ ] Empty-labels and malformed-payload cases both resolve to the unlabeled band with no
      outage warning.

---

## Story: Chronological order preserved within every band

**Requirement:** FR-5

As an operator, I want equal-priority specs to keep today's oldest-first order, so that
introducing priority never scrambles work of the same rank.

### Acceptance Criteria

#### Happy Path
- Given three pending specs all linked to `priority: medium` issues, merged on three different
  dates, when the daemon orders the backlog, then they dispatch oldest-first — byte-identical
  to today's order.
- Given a backlog spanning all five bands with multiple specs per band, when ordered, then
  within each band the relative order equals the pre-feature chronological order (stable
  permutation).

#### Negative Paths
- Given any backlog, when ordering runs, then the output is a permutation of the input — no
  spec is dropped, duplicated, or mutated (property-style assertion over randomized inputs).
- Given two specs in the same band with identical date prefixes, when ordered, then their
  relative order is deterministic across repeated scans (no flapping between polls).

### Done When
- [ ] Stable-sort test: same-band items keep input order.
- [ ] Property test: ordering output is always a permutation of its input.
- [ ] Repeated-scan determinism test passes.

---

## Story: Relabeling an issue reorders the backlog without a restart

**Requirement:** FR-6

As an operator, I want a label change on a pending spec's issue to take effect on a
subsequent scan, so that I can re-prioritize from my phone with no daemon restart and no
repo change.

### Acceptance Criteria

#### Happy Path
- Given a pending spec whose issue is `priority: low`, when the operator relabels it
  `priority: high` and the daemon next refreshes its backlog (idle refresh scan), then the
  spec moves ahead of `medium`/`low` work in the very next ordering — same daemon process.
- Given priorities were fetched on a refresh scan, when subsequent non-refresh scans run,
  then they reuse the previously resolved priorities without new lookups (no network on the
  hot path).

#### Negative Paths
- Given a relabel happens between two non-refresh scans, when those scans order the backlog,
  then the old ranking is used (staleness bounded by refresh cadence) and the daemon does NOT
  fetch mid-cycle — the new ranking appears only at the next refresh scan.
- Given the daemon restarts, when its first backlog scan completes, then priorities reflect
  the labels at startup (no stale ranking survives a restart — resolution state is
  process-local).

### Done When
- [ ] Same-process test: label change + refresh scan → new dispatch order.
- [ ] Non-refresh scans perform zero label lookups (injected reader records calls only on
      refresh).
- [ ] Restart discards any prior resolution state (fresh process ranks from current labels).

---

## Story: Priority-source outage degrades to today's order, loudly once

**Requirement:** FR-7

As an operator, I want a priority-source outage to fall back to plain chronological order
with a single warning, so that builds never stall and I still know priority wasn't applied.

### Acceptance Criteria

#### Happy Path
- Given the priority source is unreachable (transport/auth failure) during a refresh scan,
  when the daemon orders the backlog, then the entire scan uses pure chronological order,
  exactly one warning is logged, and the eligible spec still dispatches and builds normally.
- Given a later refresh scan succeeds, when the backlog is next ordered, then banded ordering
  resumes automatically.

#### Negative Paths
- Given an outage persists across many scans, when each scan orders the backlog, then no
  additional outage warnings are logged (suppressed while the outage continues).
- Given the outage resolves and a NEW outage begins later in the same daemon process, when
  the new outage's first failed fetch occurs, then a fresh warning IS logged (the once-per-
  outage flag resets on success — not once-per-process).
- Given label resolution fails mid-scan after some issues already resolved, when the scan
  completes, then the ENTIRE scan falls back to chronological order (no mixed banded/
  unbanded ordering) per the fail-soft ADR.
- Given the priority source fails, when ordering falls back, then the fallback NEVER causes a
  spec to be skipped, marked processed, warned via the durable spec-warning mechanism, or
  otherwise change eligibility — order only.

### Done When
- [ ] Outage test: fetch failure → chronological order + exactly one warning + build proceeds.
- [ ] Recovery test: success resumes banding; second outage warns anew.
- [ ] Mid-scan partial failure yields whole-scan fallback (no mixed bands).
- [ ] Fallback path provably leaves eligibility results identical to today's.

---

## Story: Priority influences order only — never eligibility

**Requirement:** FR-8

As an operator, I want priority to be a pure ordering concern, so that a hot label can never
make an unready spec build or a ready spec skip.

### Acceptance Criteria

#### Happy Path
- Given a `priority: high` spec that is ineligible (e.g. parked under a live HALT marker) and
  an eligible `priority: low` spec, when the daemon fills a slot, then the low spec dispatches
  — the ineligible high spec never blocks it (no head-of-line blocking).
- Given identical backlogs with priority resolution enabled vs disabled, when discovery runs,
  then the SET of eligible items is identical — only sequence differs.

#### Negative Paths
- Given a spec whose stories are not approved and whose issue is `priority: high`, when the
  daemon scans, then the spec is skipped with the existing stories-not-approved warning —
  priority never overrides an eligibility gate.
- Given a spec gated out by the owner gate but labeled `priority: high`, when the daemon
  scans, then the ownership skip stands unchanged.
- Given the daemon dispatches from an ordered backlog, when the first item is already in
  flight, then the picker advances to the next eligible item exactly as today (dedup/park
  logic untouched by ordering).
- Given the daemon's identity is unresolved (fail-closed scan → empty backlog), when the
  scan runs, then ZERO priority lookups occur and no outage warning can fire — priority
  resolution runs only over the post-gate eligible set, never before eligibility/owner
  gating (conflict-check resolution vs multi-operator fail-closed story).

### Done When
- [ ] Head-of-line test: ineligible high + eligible low → low dispatches.
- [ ] Eligibility-set equivalence test (ordering on vs off) passes.
- [ ] Existing eligibility/owner-gate/park tests remain green with ordering active.
- [ ] Fail-closed (empty-backlog) scan performs zero priority lookups.

---

## Story: Conflicting or duplicated priority labels resolve to the highest

**Requirement:** FR-9

As an operator, I want an issue carrying several priority labels to rank at the highest one,
so that a mid-triage label overlap never demotes work.

### Acceptance Criteria

#### Happy Path
- Given a linked issue labeled both `priority: low` and `priority: high`, when priorities are
  resolved, then the spec lands in the high band.
- Given a linked issue with one valid priority label among many unrelated labels (e.g.
  `bug`, `intake`), when priorities are resolved, then the unrelated labels are ignored and
  the valid one wins.

#### Negative Paths
- Given a linked issue labeled with all three priority labels, when resolved, then the spec
  lands in the high band deterministically on every scan.
- Given a linked issue whose only priority-ish labels are unknown variants (`priority: P0`),
  when resolved, then the spec lands in the unlabeled band (unknown ≠ highest).

### Done When
- [ ] Multi-label test: {low+high} → high; {high+medium+low} → high, deterministic.
- [ ] Unrelated labels never influence banding; unknown variants never rank.

---

## Story: Operator can see the effective build order and why

**Requirement:** FR-10

As an operator, I want the daemon's status output to show the pending order, each spec's
band, and whether banding or fallback produced it, so that I can verify a relabel took
effect or detect an outage at a glance.

### Acceptance Criteria

#### Happy Path
- Given a mixed pending backlog with priorities resolved, when the operator views daemon
  status output, then pending specs appear in effective build order, each annotated with its
  band (no-issue / high / medium / low / unlabeled).
- Given the existing startup dashboard (HALTED / IN-PROGRESS / ELIGIBLE / PROCESSED groups),
  when band annotations are added, then they extend the ELIGIBLE group's listing additively —
  the four-group structure and its stdout+log parity are preserved, and the supervisor-level
  `daemon status` rows (pid/since/activity) are untouched (conflict-check resolution vs
  halt-reconciliation dashboard + supervised-hosting status stories).
- Given the most recent scan used the outage fallback, when the operator views status output,
  then the ordering is marked as chronological-fallback (distinguishable from "everything
  happened to be unlabeled").

#### Negative Paths
- Given an empty pending backlog, when status output renders, then the ordering section shows
  empty state without error.
- Given status output renders during an outage, when the operator reads it, then no stale
  band annotations from a previous successful scan are displayed as if current.

### Done When
- [ ] Status/dashboard output lists pending specs in dispatch order with band annotations.
- [ ] Fallback mode is explicitly visible and distinct from an all-unlabeled backlog.
- [ ] Empty-backlog and mid-outage renders are clean.

---

## Coverage

| FR | Stories |
|----|---------|
| FR-1 | Issue-linked specs build in priority-label order |
| FR-2 | Unlinked specs build before all issue-linked specs |
| FR-3 | Issue-linked specs build in priority-label order |
| FR-4 | Specs with unlabeled issues build last |
| FR-5 | Chronological order preserved within every band |
| FR-6 | Relabeling an issue reorders the backlog without a restart |
| FR-7 | Priority-source outage degrades to today's order, loudly once |
| FR-8 | Priority influences order only — never eligibility |
| FR-9 | Conflicting or duplicated priority labels resolve to the highest |
| FR-10 | Operator can see the effective build order and why |
