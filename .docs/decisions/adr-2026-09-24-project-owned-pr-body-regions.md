# ADR: Project-owned pull request body regions are declared in the pull request template

**Date:** 2026-09-24
**Status:** APPROVED
**Deciders:** James Stoup (operator), architecture-review for jstoup111/ai-conductor#2616

## Context

FINISH rewrites the pull request body: `author_pr_prose` and the prose judge's repair replace it
wholesale, and the body floor and halt-PR rehabilitation rebuild it. A custom step that contributes
to the body — a release note, a changelog entry, a compliance attestation — therefore loses its
contribution with no error. The single exception is this repository's `release-disposition` step,
protected by a self-host-only snapshot/restore (`self-host/release-metadata-flow.ts`) whose
`snapshotReleaseMetadataBlock` accepts only this repository's `Release-*` schema, and whose restore
runs only on the finish completion repair — after the production `ready_pr` path has already
flipped the pull request to ready.

The engine already owns body regions of its own (reduced build-review coverage by heading, accepted
risk by comment markers, the plan declaration line, the closing reference). No mechanism lets a
project declare a region of its own, and the SHIP draft body ignores the project's pull request
template entirely (`ship-draft-pr.ts` hard-codes a `/pr` shape).

## Options Considered

### Option A: Step declares owned headings in `.ai-conductor/config.yml`
- **Pros:** The step keeps writing the body directly; no template change.
- **Cons:** A section's end is a parsing guess; reserving engine headings needs a denylist; the
  declaration lives apart from the body shape it describes. Operator preferred the template.

### Option B: Step declares a contribution file in config; engine publishes it into a fenced region
- **Pros:** Fully mechanical; format-agnostic.
- **Cons:** Configuration-side declaration, unlike GitHub's own template convention. Operator
  preferred the template.

### Option C: Constrain prose authoring to engine-owned regions; preserve everything else
- **Pros:** No declaration at all.
- **Cons:** The engine cannot name the step whose contribution went missing, and a repository that
  declares nothing no longer gets today's body.

### Option D: Step-keyed regions declared in the project's pull request template (chosen)
- **Pros:** Declaration sits where GitHub already puts body shape; the region's bytes are
  delimited by markers, not parsed; a missing contribution names its step; the engine never
  interprets region contents.
- **Cons:** Config load now reads a second file; the SHIP draft seed must change, and floor
  detection must learn to discount seeded template text.

## Decision

1. **The pull request template is the declaration surface.** A project declares a project-owned
   region by wrapping it, in `.github/pull_request_template.md`, between the single-line markers
   `<!-- ai-conductor:step «key» -->` and `<!-- /ai-conductor:step -->`. No `.ai-conductor/config.yml`
   key is added. A template at any other path, or a template with no markers, declares nothing, and
   every mechanism below is inert.
2. **A region is owned by exactly one declared custom step.** At config load the engine rejects a
   marker whose `«key»` is a built-in step, is not declared under `steps:`, is not ordered before
   `finish`, or appears in more than one region; it also rejects unbalanced or nested markers and a
   region whose template content contains an engine-owned marker or heading. Validation follows the
   custom-step-only, fail-closed pattern of `adr-2026-07-25-custom-step-completion-artifacts` and
   `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`.
3. **The SHIP draft body is seeded from the template.** When the template exists, the draft body is
   the engine floor marker, the template's bytes, the closing-reference placeholder, and the draft
   note; without a template it is today's body. Floor detection measures authored prose net of the
   seeded template bytes, so a seeded draft is still recognized as an unauthored floor.
4. **The engine guarantees the region exists before its owning step runs.** Before an owning step
   dispatches, the engine idempotently inserts the template's region into the retained draft when
   the markers are absent (a reused halt PR, a pull request opened before seeding). The step fills
   content between existing markers and never authors markers.
5. **Capture happens when the owning step succeeds.** When an owning step reports `done`, the engine
   reads the retained draft body and captures the region's exact bytes, persisted under `.pipeline/`
   keyed by pull request URL and step key with the guarded-write discipline of
   `adr-2026-07-11-pipeline-state-durability`. A region that is absent or holds only whitespace and
   HTML comments halts the run naming the step. A capture is authoritative for its pull request once
   taken and is discarded only when its owning step dispatches again.
6. **Every FINISH body rewrite re-inserts every captured region byte-for-byte.** The prose authoring
   effect and the judge's repair effect re-insert regions before their revision is observed, so the
   judged revision already carries them; the body floor, halt-PR rehabilitation, and the finish
   completion repair re-insert after their rewrite. Region content is never interpreted. All writes
   go through the guarded GitHub operation boundary of `adr-2026-09-11-github-operation-ownership`.
   No new publication transition is added, so `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns`
   holds unchanged.
7. **Regions are verified before the ready flip.** Immediately before any ready-for-review flip, the
   engine re-reads the body and compares every captured region; a mismatch it cannot repair halts
   the run naming the step, and the pull request stays draft.
   > **Amended 2026-09-24 by #2616:** D7 governs FINISH's ready-for-review flips — the production
   > `ready_pr` presentation repair and the finish completion repair. The daemon's clear-on-success
   > un-draft runs only after FINISH has already verified every region and is not a verification point.
8. **Engine-owned sections stay engine-owned.** Reduced build-review coverage, accepted risk, the
   plan declaration line, and the closing reference keep their existing upsert paths and can never
   be claimed by a template region.
9. **The `Release-*` snapshot is retired.** This repository's `release-disposition` step declares its
   region in `.github/pull_request_template.md` and becomes an ordinary region owner; the self-host
   snapshot/restore and `.pipeline/release-metadata-snapshot.json` are deleted, leaving no engine code
   that recognizes `Release-*` field names for preservation. The self-host release gate's activation
   and body validation are unchanged.

## Consequences

### Positive
- Any repository can add a custom step that contributes to the pull request body with no engine
  change, using its own section names and formats.
- A dropped contribution fails loudly, naming its step, instead of vanishing.
- One repository's release format leaves the shipped engine's preservation logic.
- Region preservation happens before the ready flip, closing the window in which the release
  check could run against a body missing the block.

### Negative
- Config load reads `.github/pull_request_template.md`; a malformed region blocks the project's
  config load until fixed.
- The draft body for templated repositories changes shape; floor detection gains a template-aware
  measurement that must stay in step with the seed.
- A step whose region is clobbered by a human edit after capture is restored over that edit.

### Follow-up Actions
- [ ] Template region parsing and config-load validation
- [ ] Template-seeded SHIP draft and template-aware floor detection
- [ ] Region ensure-before-dispatch, capture-on-success, persisted captures
- [ ] Re-insertion in every FINISH rewrite path and verify-before-ready
- [ ] Migrate `release-disposition` and this repository's template; delete the `Release-*` snapshot
- [ ] Update the shipped `pr` and `finish` skills' body guidance
