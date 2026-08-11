**Status:** Accepted

# Stories: Re-kick sentinel can strand an active feature outside recovery

Technical track (no PRD). Requirements are the desired outcomes stated in
`jstoup111/ai-conductor#1232`, referenced below as `Outcome-1` … `Outcome-4`:

- **Outcome-1** — every persisted re-kick signal reaches an observable lifecycle outcome: resumed,
  explicitly halted, processed, operator-parked, or reported as blocked by a named discovery gate.
- **Outcome-2** — a discovery-gated feature is surfaced with the exact blocking requirement instead
  of appearing silently in progress.
- **Outcome-3** — recovery never bypasses legitimate eligibility, live-HALT, operator-park, or
  shipped-work dedup gates.
- **Outcome-4** — a processed/merged feature carrying a stale sentinel is reported as processed,
  never re-dispatched.

Scope is reporting only (approach B). Nothing in these stories clears a sentinel, dispatches a
feature, parks a worktree, or removes a worktree.

---

## Story 1: Discovery records a stranded re-kick sentinel next to its blocking gate

**Requirement:** Outcome-1, Outcome-2

As a daemon operator, I want a discovery pass that blocks a merged spec to also record whether that
feature's worktree is holding an unconsumed re-kick sentinel, so that I can tell an ordinary
specification gap apart from a stranded recovery signal without inspecting the filesystem.

### Acceptance Criteria

#### Happy Path
- Given a merged spec whose tier is `M` and whose `.docs/coherence/<slug>.md` is absent, and whose
  worktree holds `.pipeline/REKICK` and no `.pipeline/HALT`, when a discovery pass runs, then the
  entry written to `.daemon/blocked.json` for that slug carries `reason: "missing-coherence"`, the
  existing remedy string, and a field marking the stranded re-kick sentinel as present.
- Given the same spec, when a discovery pass runs, then the daemon log emits a warn-once line for
  that slug naming both the blocking gate and the stranded sentinel.
- Given a merged spec blocked for `missing-coherence` whose worktree holds no `.pipeline/REKICK`,
  when a discovery pass runs, then its `.daemon/blocked.json` entry is byte-identical to the entry
  produced before this change (no sentinel field, or the field set to absent).

#### Negative Paths
- Given a blocked spec whose worktree directory does not exist, when the sentinel probe runs, then
  the probe reports "no sentinel", the blocked entry is still written with its gate and remedy, and
  the pass does not throw.
- Given a blocked spec whose sentinel probe throws (unreadable directory, permission error), when
  the pass runs, then the error is logged, the sentinel is treated as absent (fail-open on the
  annotation, never fail-closed on the blocked entry), and discovery continues with the remaining
  specs.
- Given two blocked specs where the first one's sentinel probe throws, when the pass runs, then the
  second spec's blocked entry is still written — a per-slug probe failure is isolated.

### Done When
- [ ] `.daemon/blocked.json` entries carry an explicit stranded-sentinel field, and the snapshot
      still validates against its existing `schemaVersion: 1` reader in `daemon-observe-cli.ts`
      (unknown/optional field tolerated, no reader crash).
- [ ] A unit test asserts a `missing-coherence` block on a sentinel-carrying worktree produces an
      entry with both the gate reason and the sentinel marker.
- [ ] A unit test asserts a throwing sentinel probe still yields a complete blocked entry for that
      slug and for every subsequent slug in the same pass.

---

## Story 2: The blocked read model names the gate and the stranded sentinel to the operator

**Requirement:** Outcome-2

As a daemon operator running `conduct daemon observe`, I want the blocked section to tell me that a
feature is holding a re-kick sentinel and exactly which requirement is blocking it, so that I can
remediate the real gate instead of manufacturing a HALT.

### Acceptance Criteria

#### Happy Path
- Given `.daemon/blocked.json` contains an entry with `reason: "missing-coherence"` and the
  stranded-sentinel marker, when the operator runs the observe command, then the rendered line names
  the slug, the blocking reason, the remedy, and states that an unconsumed re-kick sentinel is held.
- Given a blocked entry with no stranded-sentinel marker, when the operator runs the observe
  command, then the rendered line is unchanged from the current output.

#### Negative Paths
- Given `.daemon/blocked.json` is missing, unreadable, or malformed, when the operator runs the
  observe command, then the existing "blocked state unknown — <reason>" line is printed and no
  exception escapes.
- Given a blocked entry whose stranded-sentinel field holds an unexpected type (a string rather than
  a boolean, from an older or newer writer), when the operator runs the observe command, then the
  field is treated as absent and the gate/remedy line still renders.

### Done When
- [ ] Observe output for a sentinel-carrying blocked spec contains the slug, the reason, the remedy,
      and an explicit stranded-sentinel statement on the same entry.
- [ ] A test asserts the unchanged rendering for a blocked entry without the marker.
- [ ] A test asserts a malformed/absent snapshot still prints the existing unknown-state line.

---

## Story 3: A blocked spec is reported as blocked, not as in progress

**Requirement:** Outcome-2

As a daemon operator reading the dashboard, I want a merged spec that discovery has blocked to
appear under a blocked group carrying its named gate, rather than under IN-PROGRESS, so that the
dashboard stops asserting forward progress that cannot happen.

### Acceptance Criteria

#### Happy Path
- Given a slug that discovery reports as blocked and whose worktree has readable pipeline state, no
  `.pipeline/HALT`, no `.pipeline/DONE`, and no processed-ledger entry, when the dashboard state is
  scanned, then that slug appears in the blocked group with its reason and remedy and does **not**
  appear in IN-PROGRESS.
- Given the same slug, when the dashboard is rendered, then the blocked group is displayed with the
  slug, its blocking reason, its remedy, and the stranded-sentinel statement when present.
- Given a slug with worktree state that discovery does **not** report as blocked, when the dashboard
  state is scanned, then it appears in IN-PROGRESS exactly as it does today.

#### Negative Paths
- Given a slug that discovery reports as blocked and that also carries a live `.pipeline/HALT`, when
  the dashboard state is scanned, then it appears in HALTED only — HALTED outranks blocked and the
  slug is not double-listed.
- Given a slug that discovery reports as blocked and that is also operator-parked, when the
  dashboard state is scanned, then it appears in PARKED only — the existing absolute precedence of
  PARKED is preserved.
- Given `discover()` throws during the dashboard scan, when the dashboard state is scanned, then the
  failure is logged, the blocked group is empty, and the halted / in-progress / processed groups are
  still returned from the worktree scan.
- Given a caller built before this change whose `discover()` returns a bare array or an object with
  no `blocked` key, when the dashboard state is scanned, then the blocked group is empty and every
  other group is unchanged (backward compatibility).

### Done When
- [ ] The dashboard's returned state exposes a blocked group, and the documented precedence chain
      places it above IN-PROGRESS and below PARKED / HALTED / PROCESSED.
- [ ] A test asserts a blocked slug with live worktree state is absent from IN-PROGRESS and present
      in the blocked group.
- [ ] A test asserts a bare-array `discover()` yields an empty blocked group with all other groups
      unchanged.
- [ ] Rendered dashboard text for a blocked slug contains its reason and remedy.

---

## Story 4: A sentinel with no enumerable gate is reported as stranded, not as in progress

**Requirement:** Outcome-1

As a daemon operator, I want a worktree holding an unconsumed re-kick sentinel that discovery never
enumerates — because it has no merged spec, or its spec was already deduped — to be reported as
stranded with an explicit "no blocking gate identified" reason, so that no persisted re-kick signal
can sit in a silent state.

### Acceptance Criteria

#### Happy Path
- Given a worktree holding `.pipeline/REKICK` with no `.pipeline/HALT`, not operator-parked, not in
  the processed ledger, and whose slug appears in none of discovery's eligible, waiting, gated, or
  blocked results, when the dashboard state is scanned, then that slug is reported as stranded with
  a reason stating that no blocking gate was identified, and it does not appear in IN-PROGRESS.
- Given that same worktree, when the dashboard is rendered, then the stranded entry names the slug
  and directs the operator to the recovery runbook.

#### Negative Paths
- Given a worktree with no `.pipeline/REKICK`, whose slug appears in none of discovery's results,
  when the dashboard state is scanned, then it is reported exactly as it is today (IN-PROGRESS,
  never-started, or retained as applicable) and is **not** reported as stranded.
- Given a worktree whose `.pipeline/REKICK` cannot be read (permission error), when the dashboard
  state is scanned, then the error is logged, that worktree is skipped without being reported as
  stranded, and the remaining worktrees are still scanned.

### Done When
- [ ] Every worktree holding an unconsumed sentinel resolves into exactly one reported group:
      parked, halted, processed/retained, blocked-with-named-gate, or stranded-with-no-gate.
- [ ] A test enumerates those five dispositions and asserts each sentinel-carrying fixture lands in
      exactly one of them.
- [ ] A test asserts a non-sentinel worktree's reporting is unchanged.

---

## Story 5: Park, halt, and shipped precedence over the stranded report is preserved

**Requirement:** Outcome-3, Outcome-4

As a daemon operator, I want a sentinel-carrying feature that is operator-parked, live-halted, or
already shipped to keep the group it has today, so that the new report never contradicts the
operator's intent or a completed ship.

### Acceptance Criteria

#### Happy Path
- Given a sentinel-carrying worktree whose slug is operator-parked, when the dashboard state is
  scanned, then it appears in PARKED only and in neither the blocked nor the stranded group.
- Given a sentinel-carrying worktree with a live `.pipeline/HALT` and no `.pipeline/DONE`, when the
  dashboard state is scanned, then it appears in HALTED only.
- Given a sentinel-carrying worktree whose slug is in the processed ledger, when the dashboard state
  is scanned, then it is reported as processed / retained exactly as today, and never as stranded.

#### Negative Paths
- Given a sentinel-carrying slug that is operator-parked, when a discovery pass runs, then no
  blocked entry is written for it — the existing park check that short-circuits ahead of the blocked
  classification is unchanged.
- Given a sentinel-carrying slug that matches a shipped record by content hash, when a discovery
  pass runs, then the existing shipped-dedup skip fires and no blocked or stranded entry is produced
  for it.
- Given a sentinel-carrying worktree that is both processed and holds a live `.pipeline/HALT`, when
  the dashboard state is scanned, then the existing halted-versus-processed precedence decides its
  group and it is not additionally reported as stranded.

### Done When
- [ ] A test asserts a parked sentinel-carrying slug appears only in PARKED.
- [ ] A test asserts a shipped-deduped sentinel-carrying slug produces no blocked and no stranded
      entry.
- [ ] A test asserts a processed sentinel-carrying worktree is reported as processed / retained.

---

## Story 6: The report performs no recovery action

**Requirement:** Outcome-3

As a daemon operator, I want this reporting change to have no side effect on daemon state, so that
adding visibility cannot itself cause a dispatch, a clear, or a deletion.

### Acceptance Criteria

#### Happy Path
- Given any sentinel-carrying worktree in any of the five dispositions, when a discovery pass and a
  dashboard scan both run, then `.pipeline/REKICK` still exists afterwards, `.pipeline/HALT` is
  unchanged, no `.daemon/parked/<slug>` marker is created or removed, no worktree directory is
  removed, and no feature is dispatched.
- Given a sentinel-carrying worktree that later becomes eligible (its blocking gate is fixed on the
  default branch), when the next discovery pass runs, then it is dispatched through the existing
  path and `resumeRebaseFirst` consumes the sentinel exactly as it does today.

#### Negative Paths
- Given a sentinel-carrying worktree reported as stranded, when the dashboard is rendered
  repeatedly, then no marker file is written on any pass and the report is idempotent.
- Given a discovery pass that reports a slug as blocked, when the daemon's dispatch loop runs, then
  the slug is not dispatched — the blocked classification remains a skip, not a new dispatch source.

### Done When
- [ ] A test asserts `.pipeline/REKICK`, `.pipeline/HALT`, `.daemon/parked/`, and the worktree
      directory are unmodified across a discovery pass plus a dashboard scan.
- [ ] A test asserts a fixed blocking gate restores the existing dispatch-and-consume behaviour
      unchanged.
