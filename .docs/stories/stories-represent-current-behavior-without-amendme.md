**Status:** Accepted

# Stories represent current behavior without amendment records

Technical track (no PRD). Complexity tier **S** — at least one negative path per story.

Acceptance criteria below are stated against the harness's *documented contracts* and the machine
check that enforces them, because that is the entire surface of this change: no runtime engine code
path reads the amendment marker. The observable behavior of a contract is what a reader — human or
agent — is instructed to do, and what the acceptance suite asserts about that instruction.

Throughout, **story artifact** means a file under `.docs/stories/`. **Amendment record** means any
in-artifact trace of a superseded assertion: a dated `> **Amended YYYY-MM-DD by #NNN:**` block, an
`**Amended by:**` pointer line, or prose noting what previously held and what changed.

`HARNESS.md` and the `skills/*/SKILL.md` files are agent-executed contracts and are in scope here;
they are the surface the acceptance suite reads. Updating this repository's reader-facing reference
documentation under `docs/` is owned by the configured `maintain-documentation` step and is
deliberately not carried as an acceptance criterion below.

## Story 1: A DECIDE correction replaces story content in place

**Requirement:** Technical intent — story artifacts are authoritative descriptions of current
behavior, not historical records.

As a reader of a story artifact (human or downstream agent), I want the story to state exactly one
description of how the application behaves, so that I never have to decide which of two competing
assertions in the same file is the current one.

### Acceptance Criteria

#### Happy Path

- Given `skills/stories/SKILL.md` describes what to do when a new story supersedes an assertion in
  an accepted story, when that instruction is read, then it directs the author to **replace** the
  superseded content in place and states that the story carries no amendment record.
- Given `HARNESS.md`'s DECIDE artifact amendment section, when it is read, then it names story
  artifacts as replaced in place and carrying no amendment record, distinctly from the additive
  form it prescribes for other DECIDE artifacts.
- Given a story artifact corrected during a DECIDE pass, when the corrected file is inspected, then
  it contains the current behavioral assertion only — the superseded text is absent — and the
  reason for the change is discoverable from git history and the spec PR rather than from the file.
- Given `skills/conflict-check/SKILL.md`'s post-resolution instructions, when they are read, then
  the direction to record what changed and why *inside the story file* is gone, replaced by
  in-place replacement of the affected story content.

#### Negative Paths

- Given the acceptance suite, when `skills/stories/SKILL.md` is checked, then any text instructing
  that the original story assertion is preserved, is not rewritten, or is not deleted causes the
  check to **fail** — the previous additive assertion for stories is inverted, not merely dropped.
- Given the acceptance suite, when `skills/stories/SKILL.md` is checked, then the presence of the
  dated additive amendment template as the instruction for correcting a story causes the check to
  **fail**.
- Given a DECIDE pass that corrects a story, when the author instead appends a dated amendment block
  beside the original assertion, then the story artifact violates the documented contract — the
  contract text provides no form under which that output is compliant.
- Given `HARNESS.md`, when its amendment section is read, then it does not leave story artifacts
  merely unmentioned and therefore governed by the general additive rule; the carve-out is explicit.

### Done When

- [ ] `skills/stories/SKILL.md` instructs in-place replacement for story corrections and states that
      the story carries no amendment record; it contains no instruction to preserve the original
      story assertion and no dated additive template presented as the story correction form.
- [ ] `HARNESS.md`'s DECIDE artifact amendment section carries an explicit story-artifact carve-out
      naming replacement in place and the absence of an amendment record.
- [ ] `skills/conflict-check/SKILL.md` no longer instructs the author to note what changed and why
      inside the story file.
- [ ] `src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts`
      asserts the inverted contract for `skills/stories/SKILL.md`: replacement is required, and
      original-preserved / never-rewrite / never-delete language and the dated additive template are
      absent from the story instruction.
- [ ] The full validation suite (`test/test_harness_integrity.sh`) and the conductor test suite pass.

## Story 2: Other DECIDE artifact types keep the additive amendment convention

**Requirement:** Technical intent — the change is scoped to story artifacts; every other durable
DECIDE contract is unaffected.

As a maintainer of specs, plans, architecture documents, ADRs, conflict reports, and coherence
mappings, I want the additive dated amendment convention to remain in force for those artifacts, so
that a scoped change to stories does not silently strip provenance from artifact types whose durable
contract was never re-examined.

### Acceptance Criteria

#### Happy Path

- Given `skills/architecture-review/SKILL.md`'s accepted-artifact amendment instruction, when it is
  read, then it still prescribes the dated additive form with the original assertion preserved for
  the artifacts it amends, and it scopes that form so it does not apply when the artifact being
  amended is a story.
- Given `skills/conflict-check/SKILL.md`'s accepted-artifact amendment instruction, when it is read,
  then it still prescribes the dated additive form for non-story DECIDE artifacts, and it directs
  in-place replacement when the artifact being amended is a story.
- Given `HARNESS.md`, when its amendment section is read, then the additive dated form remains the
  stated rule for accepted DECIDE artifacts other than stories, with the correction placed beside
  the original assertion and no separate amendment record created.
- Given the acceptance suite's parameterized contract check, when it runs, then the
  `architecture-review` and `conflict-check` rows still assert the additive dated form, unchanged in
  substance from before this change.

#### Negative Paths

- Given `skills/architecture-review/SKILL.md`, when its amendment instruction is checked, then
  removal of the dated additive template or of the original-preserved language causes the acceptance
  check to **fail** — the story carve-out must not generalize.
- Given `skills/conflict-check/SKILL.md`, when its amendment instruction is checked, then a carve-out
  written broadly enough to cover specs, plans, architecture documents, ADRs, or coherence mappings
  causes the acceptance check to **fail**; only story artifacts are exempted.
- Given a DECIDE pass correcting an accepted spec or ADR, when the author replaces the superseded
  text in place, then that output violates the documented contract for those artifact types, which
  continues to require the correction beside the preserved original.

### Done When

- [ ] `skills/architecture-review/SKILL.md` retains the dated additive template and the
      original-preserved language, with an explicit story-artifact exception.
- [ ] `skills/conflict-check/SKILL.md` retains the dated additive template and the
      original-preserved language for non-story artifacts, with an explicit story-artifact exception.
- [ ] `HARNESS.md` states the additive rule for accepted DECIDE artifacts other than stories.
- [ ] The acceptance suite's `architecture-review` and `conflict-check` contract rows still assert
      the additive form and pass unmodified in substance.
- [ ] No file under `.docs/specs/`, `.docs/plans/`, `.docs/architecture/`, `.docs/decisions/`,
      `.docs/conflicts/`, or `.docs/coherence/` is rewritten by this change.

## Story 3: Legacy story amendment blocks converge when DECIDE next touches the story

**Requirement:** Technical intent — existing story artifacts remain usable and unambiguous after the
upgrade, without a bulk rewrite whose correctness cannot be established mechanically.

As an operator upgrading to the release carrying this change, I want existing story files that
already contain amendment blocks to be resolved by the next DECIDE pass that amends them, so that
the corpus converges under human judgment at the moment someone is already reading the file — and no
automated rewrite guesses which superseded sentence an amendment block replaced.

### Acceptance Criteria

#### Happy Path

- Given `skills/stories/SKILL.md`, when its story correction instruction is read, then it directs
  the author, when amending a story that still carries pre-existing amendment blocks, to resolve
  those blocks into the story's current behavioral text in the same DECIDE pass.
- Given a story artifact that carries pre-existing amendment blocks, when a DECIDE pass amends any
  part of that file, then the resulting file contains no amendment blocks — each one has been folded
  into the current behavioral assertion it corrected.
- Given a story artifact that carries pre-existing amendment blocks and is not amended by any DECIDE
  pass, when the release is installed, then that file is left byte-for-byte unchanged and remains
  readable — the upgrade performs no bulk rewrite of it.
#### Negative Paths

- Given the upgrade path, when a consumer installs the release carrying this change, then no
  migration step, codemod, or `bin/migrate` block rewrites story files — an automated rewrite is
  explicitly not part of the delivered change, because an amendment block's narrative prose does not
  identify which superseded sentence it replaced.
- Given a DECIDE pass that amends a story still carrying legacy amendment blocks, when the author
  updates only the assertion they came to change and leaves the other legacy blocks in place, then
  the story artifact violates the documented contract — the instruction covers every block in the
  file that pass touches, not only the one being corrected.
- Given a legacy amendment block whose narrative does not make clear which original sentence it
  superseded, when the resolving DECIDE pass cannot determine the current behavior with confidence,
  then the author raises it under the correctness-and-assumption gate rather than guessing — an
  unresolvable block blocks on operator judgment instead of being silently deleted.

### Done When

- [ ] `skills/stories/SKILL.md` carries the converge-on-touch instruction, scoped to every legacy
      amendment block in a story file the DECIDE pass amends.
- [ ] The delivered change adds no codemod, migration block, or script that rewrites files under
      `.docs/stories/`.
- [ ] Story files under `.docs/stories/` that carry legacy amendment blocks and are not amended by
      this change remain byte-for-byte unchanged in the diff.
