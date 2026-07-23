**Status:** Accepted

# Stories: DECIDE artifact coherence check

Source issue: jstoup111/ai-conductor#539 · Track: product · Tier: M
PRD: `.docs/specs/2026-07-22-decide-artifact-coherence-check.md`
ADRs: `adr-2026-07-22-coherence-gate-placement-and-validation-split`,
`adr-2026-07-22-coherence-waiver-and-duplicate-claim` (both APPROVED)

## Story 1 — Intake outcomes travel with the spec

**Requirement:** FR-13

As an operator, I want the intake issue's Desired-outcome bullets captured into the
spec's artifact set early in DECIDE, so the coherence check has a committed source of
truth and the outcomes are inspectable in the spec PR.

> **Conflict resolution 2026-07-22:** early persistence is a gitignored staging file in
> the worktree's `.pipeline/`, NOT a committed `.docs/intake/<slug>.md` — the committed
> marker stays land-written and plan-stem-keyed per
> `2026-07-03-intake-marker-plan-stem-keying` and `multi-operator-ownership-slice-b`.

### Acceptance Criteria

#### Happy Path
- Given an idea claimed from GitHub intake with a `Source-Ref` and a `## Desired
  outcome` section, when the per-idea worktree flow begins authoring, then a staged
  intake-outcomes file exists in the worktree's gitignored `.pipeline/` carrying the
  `Source-Ref` and the verbatim Desired-outcome bullets, before any DECIDE artifact is
  authored.
- Given the staged outcomes, when `engineer land` writes the committed
  `.docs/intake/<plan-stem>.md` marker, then the marker carries the Desired-outcome
  bullets byte-for-byte alongside `Source-Ref:`/`Owner:`, and no idea-slug-named intake
  file is created.
- Given a marker rewrite (e.g. owner re-stamp), when `writeIntakeMarker` runs again,
  then the previously committed outcome bullets and `Source-Ref` line are preserved
  byte-for-byte.

#### Negative Paths
- Given an idea captured from chat/CLI (no intake issue), when authoring begins, then
  no outcomes are staged and no error is raised — downstream checks treat the outcome
  layer as not-required.
- Given an intake body whose `## Desired outcome` section is empty, when staging runs,
  then zero outcome bullets are staged and the coherence check later treats the
  outcome layer as not-required rather than failing on an empty set.
- Given a staged outcomes file but a land that fails before commit, when land is
  re-run after fixes, then the staged outcomes are still available (staging survives a
  failed land; keep-on-failure).

### Done When
- [ ] Claim/worktree flow stages `Source-Ref` + outcome bullets in `.pipeline/` before any DECIDE artifact is authored
- [ ] Land commits the outcomes inside `.docs/intake/<plan-stem>.md` (plan-stem key preserved; no idea-slug file — pinned contract tests stay green)
- [ ] `writeIntakeMarker` rewrite preserves committed outcome bullets (byte-equality test)
- [ ] Chat-origin idea stages nothing and produces no failure

## Story 2 — Auditable mapping artifact authored at end of DECIDE

**Requirement:** FR-1

As an operator, I want a committed traceability record mapping outcomes → stories →
tasks with per-row verdicts, so coverage is auditable in the spec PR instead of
self-reported prose.

### Acceptance Criteria

#### Happy Path
- Given a completed DECIDE chain (plan exists), when the coherence-check step runs,
  then `.docs/coherence/<plan-stem>.md` exists containing one row per intake outcome
  bullet, per PRD FR (product track), per story, and per plan task, each with cited
  counterpart ids and a per-row verdict.
- Given the artifact, when the operator opens the spec PR, then the mapping renders as
  a readable table (valid Markdown) inside the PR diff.

#### Negative Paths
- Given a mapping row citing a story id that does not exist in the stories file, when
  `engineer land` validates, then land is rejected naming that row's id (fabricated
  citations cannot pass).
- Given a plan whose stem does not match any coherence artifact filename, when
  `engineer land` validates, then land is rejected as missing-coherence-artifact (stem
  mismatch is not silently tolerated).

### Done When
- [ ] Coherence-check step produces `.docs/coherence/<plan-stem>.md` with all four row classes and verdicts
- [ ] Validator cross-checks every cited id against the real artifact files
- [ ] Stem-mismatch and fabricated-id cases each produce a distinct, named rejection

## Story 3 — Every intake outcome maps to a story

**Requirement:** FR-2

As an operator, I want landing blocked when an intake outcome bullet has no story, so
a spec cannot lock while solving an adjacent problem.

### Acceptance Criteria

#### Happy Path
- Given every Desired-outcome bullet mapped to ≥1 existing story id with an
  affirmative verdict, when land validates, then the outcome layer passes with no
  operator interaction.

#### Negative Paths
- Given one outcome bullet with no mapping row (or a row with a negative verdict),
  when land validates, then land is rejected with gap id `outcome-<n>` quoting the
  unmapped bullet text.
- Given a mapping row asserting coverage by a story id absent from the stories file,
  when land validates, then land is rejected (id cross-check, not trust in the row).

### Done When
- [ ] Unmapped-outcome rejection names `outcome-<n>` and quotes the bullet
- [ ] Coverage asserted via nonexistent story id is rejected mechanically

## Story 4 — Every PRD requirement maps through stories to tasks (product track)

**Requirement:** FR-3

As an operator, I want every enumerated FR covered by ≥1 story and ≥1 plan task on the
product track, so no requirement silently drops between artifacts.

### Acceptance Criteria

#### Happy Path
- Given a product-track spec where each `FR-N` is cited by ≥1 story's
  `**Requirement:**` line and each such story maps to ≥1 task, when land validates,
  then the FR layer passes.

#### Negative Paths
- Given an FR cited by no story, when land validates, then land is rejected with gap
  id `fr-<N>`.
- Given an FR whose only covering story maps to no plan task, when land validates,
  then land is rejected reporting both the FR and the uncovered story (transitive gap
  is not masked).

### Done When
- [ ] FR ids parsed from the approved PRD; coverage computed via story `**Requirement:**` lines
- [ ] Uncovered FR and transitively-uncovered FR both reject with distinct reports

## Story 5 — Every story maps to at least one plan task

**Requirement:** FR-4

As an operator, I want landing blocked when an accepted story has no plan task, so
consciously-written behavior cannot be silently unplanned.

### Acceptance Criteria

#### Happy Path
- Given every story id in the stories file cited by ≥1 task's `**Story:**` line, when
  land validates, then the story layer passes.

#### Negative Paths
- Given a story cited by no task, when land validates, then land is rejected with gap
  id `story-<id>` naming the story title.
- Given a stories file with zero parseable story blocks, when land validates, then
  land is rejected as unparseable-stories (fail-closed), not treated as trivially
  covered.

### Done When
- [ ] Story→task coverage computed from real `**Story:**` lines, not the plan's prose
- [ ] Zero-parseable-stories case rejects rather than passes

## Story 6 — No orphan plan tasks

**Requirement:** FR-5

As an operator, I want every plan task to serve a story or a declared supporting
purpose, so plans cannot smuggle unrelated work.

### Acceptance Criteria

#### Happy Path
- Given a task whose `**Story:**` line cites ≥1 existing story id, when land
  validates, then the task is covered.
- Given a task with `**Type:** infrastructure` (or `refactor`) and a `**Story:**` line
  declaring a non-empty supporting purpose, when land validates, then the task is
  covered without citing a story id.

#### Negative Paths
- Given a task citing only nonexistent story ids, when land validates, then land is
  rejected with gap id `task-<id>`.
- Given an `infrastructure` task whose `**Story:**` line is empty or missing, when
  land validates, then land is rejected — type alone does not excuse a task.
- Given a task with no `**Story:**` line at all and a non-supporting `**Type:**`, when
  land validates, then land is rejected with gap id `task-<id>` (absence is orphan,
  not pass).

### Done When
- [ ] Orphan rule implemented exactly as the ADR's mechanical form (existing `**Story:**`/`**Type:**` fields, no new plan syntax)
- [ ] All three negative shapes reject with `task-<id>` gap ids

## Story 7 — Plan coverage claims must agree with the task tree

**Requirement:** FR-6

As an operator, I want a plan whose own coverage table contradicts its tasks to be
blocked, so self-reported coverage cannot diverge from reality.

### Acceptance Criteria

#### Happy Path
- Given a plan whose `## Coverage Check` table rows cite only task ids that exist in
  the task tree and story ids that exist in the stories file, when land validates,
  then the consistency layer passes.

#### Negative Paths
- Given a coverage row citing task `T9` while no task `T9` exists, when land
  validates, then land is rejected with gap id `claim-<row>` naming the phantom id.
- Given a task tree where task `T3` cites story `S2` but the coverage table omits that
  pair while claiming `S2` is covered only by a nonexistent task, when land validates,
  then land is rejected (the table is checked against the tree, both directions of the
  cited pair).

### Done When
- [ ] Coverage-table ids validated against parsed task tree and stories
- [ ] Phantom-id and contradicting-pair cases reject with `claim-<row>` gap ids

## Story 8 — A second spec cannot silently claim an already-claimed intake

**Requirement:** FR-7

As an operator, I want landing refused when the spec's `Source-Ref` is already claimed
by a landed spec, so duplicate specs (the #527 vs #530 shape) die at land.

> **Conflict resolution 2026-07-22:** the blocking scan reads `.docs/intake/*.md`
> markers only — `.docs/shipped/*.md` is excluded because its schema
> (`content-aware-shipped-work-dedup`) carries no `Source-Ref` field; the intake marker
> merges with the spec and is both sufficient and earlier.

### Acceptance Criteria

#### Happy Path
- Given no `.docs/intake/*.md` on the default branch carries this spec's `Source-Ref`,
  when land validates, then the duplicate check passes with no network access.

#### Negative Paths
- Given a default-branch intake marker with the same `Source-Ref`, when land
  validates, then land is rejected naming the conflicting slug and gap id
  `duplicate:<ref>`.
- Given the same conflict but a fresh-in-diff waiver covering `duplicate:<ref>`, when
  land validates, then land proceeds (operator-approved duplicate path).
- Given no network connectivity, when land validates a non-duplicate spec, then the
  blocking check still completes (local git only) and any open-PR overlap scan is
  skipped or warns without blocking.

### Done When
- [ ] Duplicate check reads only local default-branch `.docs/intake/*.md` markers; blocking verdict never requires network
- [ ] Conflicting slug + `duplicate:<ref>` gap id appear in the rejection
- [ ] Waived duplicate lands; open-PR scan is advisory-only

## Story 9 — Waivers name gaps, are fresh, and never cover silently

**Requirement:** FR-8

As an operator, I want to waive a named gap explicitly — and only that gap, only for
this spec — so intentional descoping is possible without weakening the gate.

### Acceptance Criteria

#### Happy Path
- Given a blocked land with gap ids `outcome-2, story-S3`, when a
  `.docs/coherence-waivers/<plan-stem>.md` in the spec's own change set carries
  `Waives: outcome-2, story-S3` and a non-empty `Rationale:`, then land proceeds and
  the waiver is committed with the spec.

#### Negative Paths
- Given a waiver covering only `outcome-2` while `story-S3` is also gapped, when land
  validates, then land is rejected naming the unwaived remainder (`story-S3`).
- Given a waiver naming an unknown gap id (`outcom-2`, typo), when land validates,
  then the waiver is malformed and land is rejected — never silently accepted.
- Given a waiver file that exists on the base branch but is not part of this spec's
  own change set, when land validates, then the waiver does not apply (freshness) and
  land is rejected.
- Given a waiver with an empty `Rationale:`, when land validates, then the waiver is
  malformed and land is rejected.

### Done When
- [ ] Parse-don't-validate: malformed/unknown/partial/stale waivers all reject with distinct reasons
- [ ] Accepted waiver is visible in the spec PR diff alongside the mapping artifact

## Story 10 — Rejections name every gap precisely

**Requirement:** FR-9

As an operator, I want a blocked land to enumerate each gap concretely, so I can route
the fix to the right artifact without re-deriving the analysis.

### Acceptance Criteria

#### Happy Path
- Given a land blocked on three gaps of different classes, when the rejection is
  printed, then all three appear in one report, each with its gap id, the artifact it
  lives in, and the quoted item (bullet text / story title / task id / claim row).

#### Negative Paths
- Given a single gap, when the rejection is printed, then the report contains no
  generic "coherence failed" wording without the specific gap id (vague failure output
  is itself a defect).
- Given a rejection, when the operator re-runs land unchanged, then the identical
  report is produced (deterministic — same input, same gaps, same ids).

### Done When
- [ ] One rejection lists all gaps (no fail-on-first-only), each with id + artifact + quote
- [ ] Gap ids are stable across re-runs on unchanged input

## Story 11 — Technical-track specs are not held to a PRD

**Requirement:** FR-10

As an operator, I want technical-track specs checked on outcomes ↔ stories ↔ tasks
only, so no phantom PRD requirement blocks them.

### Acceptance Criteria

#### Happy Path
- Given a technical-track spec (track marker says `technical`, no PRD in the change
  set), when land validates, then the FR layer is skipped entirely and the remaining
  layers are enforced.

#### Negative Paths
- Given a technical-track spec with an unmapped intake outcome, when land validates,
  then land is still rejected on the outcome gap (skipping the FR layer does not skip
  the others).
- Given a spec with no `.docs/track/` marker in its change set, when land validates,
  then the track defaults exactly as the existing land track-resolution does (product
  ⇒ FR layer required if a PRD exists) — never a crash or silent full skip.

### Done When
- [ ] Required layers derive from committed markers per the ADR (track marker → FR layer)
- [ ] Technical-track spec with clean chain lands; with outcome gap, rejects

## Story 12 — Ideas without an intake issue skip the outcome layer

**Requirement:** FR-11

As an operator, I want chat/CLI-origin specs checked on stories ↔ tasks only, so the
absence of intake outcomes is never treated as a gap.

### Acceptance Criteria

#### Happy Path
- Given a spec with no persisted intake outcomes (no `Source-Ref`, no outcome
  bullets), when land validates, then the outcome layer is skipped and story/task/plan
  layers are enforced.

#### Negative Paths
- Given a no-intake spec with an orphan task, when land validates, then land is
  rejected on `task-<id>` (outcome-layer skip does not weaken other layers).

### Done When
- [ ] No-intake spec with coherent stories/plan lands with zero coherence prompts
- [ ] No-intake spec with orphan task rejects

## Story 13 — S-tier is exempt; coherent M/L specs land silently

**Requirement:** FR-12

As an operator, I want Small-tier specs exempt from the coherence check entirely and
coherent Medium/Large specs to add zero interaction at land, so the gate costs nothing
where it isn't needed and nothing on the happy path.

> **Operator ruling 2026-07-22:** coherence is not needed for S — the step is skipped
> for S-tier exactly like architecture-diagram/review and conflict-check, and the land
> validator does not engage for tier S. The `getSkippableSteps('S')` pinned-set test in
> `s-tier-pipeline-knobs` gains the new step in the same diff that registers it.

### Acceptance Criteria

#### Happy Path
- Given an M- or L-tier spec whose every layer maps cleanly, when land runs, then no
  new prompt, confirmation, or warning is emitted by the coherence rung (silent pass).
- Given an S-tier spec (per its `.docs/complexity/` tier), when the DECIDE flow runs,
  then the coherence-check step is skipped, and when land validates, then no coherence
  artifact is required and no coherence validation runs.

#### Negative Paths
- Given an S-tier spec with no coherence artifact, when land validates, then land
  proceeds — the missing artifact is NOT a gap for tier S.
- Given an M-tier spec misdeclaring nothing (tier file genuinely M) but missing the
  coherence artifact, when land validates, then land is rejected — the S exemption
  never leaks to M/L.

### Done When
- [ ] Coherence step registered as skippable for tier S; `getSkippableSteps('S')` pinned test updated in the same diff
- [ ] Land validator engages only when tier ≠ S (tier read from `.docs/complexity/`, same source as the existing tier/artifact check)
- [ ] Coherent-path M/L land output is unchanged except for the validator's silent pass

## Story 14 — Missing or unreadable evidence blocks exactly like incoherence

**Requirement:** FR-14

As an operator, I want a missing, empty, or unparseable mapping artifact to block
landing, so absence of evidence can never read as a pass.

### Acceptance Criteria

#### Happy Path
- Given a present, well-formed mapping artifact with clean coverage, when land
  validates, then land proceeds.

#### Negative Paths
- Given no coherence artifact for the plan stem, when land validates, then land is
  rejected as missing-coherence-artifact.
- Given an empty (zero-byte or whitespace-only) artifact, when land validates, then
  land is rejected as empty-coherence-artifact.
- Given an artifact whose table cannot be parsed (corrupted markdown), when land
  validates, then land is rejected as unparseable — never skipped, never treated as
  covered.
- Given a legacy re-land of a spec authored before this gate existed (no coherence
  artifact requirement derivable from its own change set), when land validates, then
  the gate does not engage — no retroactive failure (architecture-review condition).
- Given an S-tier spec, when land validates, then the missing-artifact rejection never
  fires (Story 13 exemption takes precedence over fail-closed).

### Done When
- [ ] Missing/empty/unparseable each reject with a distinct reason (M/L tiers)
- [ ] No-retroactivity trigger implemented per the architecture-review condition and covered by a test
- [ ] S-tier exemption ordering covered by a test (exemption checked before fail-closed)
