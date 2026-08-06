**Status:** Accepted

# Stories: Blocked Merged Specs Are Visible, Never Skipped

PRD: `.docs/specs/annotated-stories-line-makes-a-merged-spec-silentl.md` (issue #1330, tier M)
ADRs: `adr-2026-08-05-token-first-stories-reference-normalization`,
`adr-2026-08-05-blocked-is-a-distinct-state-from-halted`,
`adr-2026-08-05-blocked-classification-after-dedup` (all APPROVED)

---

## Story 1: An annotated `**Stories:**` line resolves to its path

**Requirement:** FR-1, FR-2, FR-3, FR-4

As a plan author, I want a stories reference followed by a human annotation to resolve to the
path it names, so that a natural way of writing the line does not make my spec undispatchable.

### Acceptance Criteria

#### Happy Path
- Given a plan whose line is ``**Stories:** `.docs/stories/x.md` (TR-1..TR-6)``, when the
  reference is resolved, then it resolves to `.docs/stories/x.md`.
- Given a plan whose line is `**Stories:** .docs/stories/x.md (11 stories)`, when the
  reference is resolved, then it resolves to `.docs/stories/x.md`.
- Given a plan whose line is `**Stories:** [Stories](.docs/stories/x.md) — 14 stories`, when
  the reference is resolved, then it resolves to `.docs/stories/x.md`.
- Given a plan whose line is ``**Stories:** `.docs/stories/x.md` (TR-1..TR-13 — closes the
  *wiring*`` with an unbalanced parenthesis, when the reference is resolved, then it resolves
  to `.docs/stories/x.md`.
- Given a plan whose line names a path relative to the plan's own directory followed by an
  annotation, when the reference is resolved, then it resolves relative to the plan's
  directory exactly as an unannotated relative path does.

#### Negative Paths
- Given each of the previously-supported unannotated shapes — bare path, inline-code path,
  Markdown link — when the reference is resolved, then it resolves to the same path it
  resolved to before this change.
- Given a plan whose line is `**Stories:** /etc/passwd.md (annotated)` or a Windows
  drive-absolute or UNC reference, when the reference is resolved, then it is refused.
- Given a plan whose line is `**Stories:** ../../outside.md (annotated)`, when the reference
  is resolved, then it is refused.
- Given a plan whose line is `**Stories:** see the stories directory`, when the reference is
  resolved, then it is refused, because the first token is not a Markdown path.
- Given a plan whose line is `**Stories:**` with nothing after it, when the reference is
  resolved, then it is refused.
- Given a plan with no `**Stories:**` line at all, when the reference is resolved, then it
  falls back to the same-stem stories path exactly as before.

---

## Story 2: Discovery classifies unbuildable merged specs instead of dropping them

**Requirement:** FR-5, FR-6, FR-9

As a daemon operator, I want every content-based decline captured as a structured blocked
entry so that unbuildable work can be displayed instead of vanishing.

### Acceptance Criteria

#### Happy Path
- Given a merged plan whose stories reference cannot be resolved, when a discovery pass runs,
  then the result's blocked list contains that slug with reason `unresolvable-stories-ref`, a
  remedy naming the plan file and the accepted reference forms, and the slug is absent from
  the eligible items.
- Given a merged plan whose stories reference resolves but whose target is absent on the
  default branch, when a discovery pass runs, then the blocked list contains that slug with
  reason `stories-missing` and a remedy naming the resolved path.
- Given a merged spec whose stories are not approved, when a discovery pass runs, then the
  blocked list contains that slug with reason `stories-not-approved`, and the existing
  `merged spec cannot build — stories not approved …` log line is still emitted with its
  current wording.
- Given a merged spec whose plan carries no dependency tree, when a discovery pass runs, then
  the blocked list contains that slug with reason `no-dependency-tree`, and the existing log
  line is still emitted with its current wording.
- Given a merged non-`S`-tier spec with no parseable coherence artifact, when a discovery pass
  runs, then the blocked list contains that slug with reason `missing-coherence`, and the
  existing log line is still emitted with its current wording.
- Given a spec blocked for either stories reason, when discovery runs twice in a process with
  warn-once markers wired, then its new log line is emitted exactly once.

#### Negative Paths
- Given a merged spec that passes every content check, when a discovery pass runs, then it
  appears in the eligible items and in no blocked entry.
- Given a merged spec skipped by the ownership gate, when a discovery pass runs, then it
  appears in the gated list and in no blocked entry — content vetting precedes the owner gate,
  so the two states never co-occur for one slug.
- Given a plan absent from the default-branch tree, when a discovery pass runs, then it is
  neither eligible nor blocked, because it was never merged.

---

## Story 3: Finished work is never reported as blocked

**Requirement:** FR-7, FR-8

As a daemon operator, I want blocked entries to be actionable, so that a repository's history
of completed specs does not bury the one spec I need to fix.

### Acceptance Criteria

#### Happy Path
- Given a merged plan with an unresolvable stories reference whose slug has a processed
  marker, when a discovery pass runs, then it produces no blocked entry.
- Given a merged plan with an unresolvable stories reference whose stem matches a committed
  shipped record, when a discovery pass runs, then it produces no blocked entry.
- Given a merged spec that fails a content check and whose plan and stories content match a
  committed shipped record's spec hash, when a discovery pass runs, then it produces no
  blocked entry.
- Given a merged spec that fails a content check and whose slug is operator-parked, when a
  discovery pass runs, then it produces no blocked entry — a parked spec is already held by
  operator decision and needs no second reason.

#### Negative Paths
- Given a fixture repository, when discovery runs once against the pre-change behaviour and
  once with the blocked channel and the reordered gauntlet, then the eligible `items` sets are
  identical apart from plans made newly resolvable by Story 1 — the blocked channel must not
  add, remove, or reorder buildable specs.
- Given a merged spec that is neither processed, shipped, nor parked and fails a content
  check, when a discovery pass runs, then it *is* reported as blocked — dedup must not
  suppress genuinely actionable work.

---

## Story 4: `daemon status` explains a blocked spec without scanning anything

**Requirement:** FR-10, FR-11, FR-12, FR-13, NFR-1, NFR-3

As a daemon operator checking from a phone, I want `conduct-ts daemon status` alone to tell me
why a merged and accepted spec is not eligible.

### Acceptance Criteria

#### Happy Path
- Given a discovery pass that produced two blocked specs, when the pass completes, then the
  repository's blocked snapshot contains both entries and the time it was written, replacing
  the previous contents entirely.
- Given a snapshot containing blocked entries, when `daemon status` runs, then it renders a
  per-repository blocked section listing each slug with its reason and remedy, and labels how
  old the snapshot is.
- Given a spec that was blocked in the previous pass and is fixed on the default branch, when
  the next pass completes, then the snapshot no longer contains it and `daemon status` no
  longer shows it — with no operator cleanup.
- Given a status run, when it renders the blocked section, then it performs no git operation,
  no repository scan, and no network call.

#### Negative Paths
- Given a repository whose daemon has never run, so no snapshot exists, when `daemon status`
  runs, then it reports blocked state as unknown — never as zero blocked specs.
- Given a snapshot file containing unparseable content, when `daemon status` runs, then it
  reports blocked state as unknown and the status run still succeeds.
- Given a snapshot write that fails, when the discovery pass completes, then the pass still
  returns its blocked entries to its caller and the daemon continues dispatching eligible
  work.

---

## Story 5: Landing refuses an unusable stories reference and names the accepted forms

**Requirement:** FR-14, FR-15

As a spec author, I want the land gate to tell me exactly which reference forms are accepted,
so that I fix the plan instead of guessing.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose plan carries an annotated stories reference resolving to the selected
  stories artifact, when the spec is landed, then the land succeeds — authoring and discovery
  accept the same forms.
- Given a plan whose stories reference does not resolve to the selected stories artifact, when
  the spec is landed, then the land fails with an error naming the selected artifact, the
  resolved value, and the accepted forms — a repo-relative path, an inline-code path, or a
  Markdown link, each optionally followed by a trailing annotation.
- Given the `/plan` skill's documentation, when an author reads the stories-reference guidance,
  then the accepted forms above are stated there.

#### Negative Paths
- Given a plan whose stories reference resolves to a valid but unrelated stories artifact,
  when the spec is landed, then the land still fails — the relaxed resolver must not let an
  unrelated file satisfy the gate.
- Given a plan whose stories reference escapes the repository root, when the spec is landed,
  then the land fails with the resolved value reported as invalid.
