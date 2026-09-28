**Status:** Accepted

# Stories: Project-owned pull request body regions survive finish

**Track:** Technical
**Source:** jstoup111/ai-conductor#2616
**Architecture:** `.docs/decisions/architecture-review-2026-09-24-preserve-project-owned-pr-body-sections-through-fi.md`; `adr-2026-09-24-project-owned-pr-body-regions` D1–D9

A "region" below is the text in a pull request body between `<!-- ai-conductor:step «key» -->` and
`<!-- /ai-conductor:step -->`, where «key» is the region's owning step. "The template" is
`.github/pull_request_template.md` in the project root. "An owning step" is a custom step that the
template names in a region marker. "Empty" means the region holds nothing but whitespace and HTML
comments.

## Story 1: The template declares step-owned regions, and bad declarations stop config load

As a maintainer of any repository, I want to declare the pull request body regions my custom steps own inside my own pull request template, so that I control my body shape without an engine change and a broken declaration fails loudly instead of being ignored.

### Acceptance Criteria

#### Happy Path

- Given a repository whose template wraps a section in markers naming custom step `compliance-attest`, and `compliance-attest` is declared under `steps:` and ordered before `finish`, when the project config loads, then loading succeeds and `compliance-attest` is recorded as the owner of that region.
- Given a template with two regions naming two different declared custom steps ordered before `finish`, when the project config loads, then loading succeeds and each step owns exactly its own region.
- Given a repository whose template contains no region markers, when the project config loads, then loading succeeds and no step owns a region.
- Given a repository with no file at `.github/pull_request_template.md` and a marked template at the repository root instead, when the project config loads, then loading succeeds and no step owns a region.

#### Negative Paths

- Given a template region whose marker names built-in step `finish`, when the project config loads, then loading fails with an error naming the marker key `finish` and stating that built-in steps cannot own a region.
- Given a template region whose marker names `release-disposiiton` and no step of that name is declared, when the project config loads, then loading fails with an error naming `release-disposiiton` as an undeclared step.
- Given a template region naming a declared custom step whose `after:` places it after `finish`, when the project config loads, then loading fails with an error naming that step and stating that a region owner must run before `finish`.
- Given a template with two regions that both name `compliance-attest`, when the project config loads, then loading fails with an error naming `compliance-attest` as owning more than one region.
- Given a template with an opening region marker and no closing marker, when the project config loads, then loading fails with an error naming the unclosed region's step key.
- Given a template with a region opened inside another region, when the project config loads, then loading fails with an error naming both step keys as nested.
- Given a template region whose content contains the heading `## Reduced build-review coverage` or the accepted-risk start marker, when the project config loads, then loading fails with an error naming the region's step key and the engine-owned text it contains.

### Done When

- [ ] A fixture repository with a marked template and matching declared custom step loads, and the loaded config reports the step as the region's owner.
- [ ] Each of the seven invalid-template fixtures fails config load with an error message containing the offending step key.
- [ ] A fixture with an unmarked template and a fixture with no `.github/pull_request_template.md` both load with zero region owners.

## Story 2: The SHIP draft body is seeded from the template

As a maintainer, I want the draft pull request opened at SHIP to start from my own pull request template, so that my step-owned regions exist before my steps run and the draft reflects my repository's conventions.

### Acceptance Criteria

#### Happy Path

- Given a repository with a template, when SHIP opens the draft pull request, then the created body contains the engine floor marker, the template's bytes unchanged, the closing-reference placeholder comment, and the SHIP draft note.
- Given a repository without a template, when SHIP opens the draft pull request, then the created body is byte-identical to the body SHIP creates today for the same feature description.
- Given a template-seeded draft whose body has not been authored, when FINISH observes the pull request, then the body is classified as the engine floor and prose authoring is selected.

#### Negative Paths

- Given a template-seeded draft whose template text exceeds 400 characters and no prose has been authored, when FINISH observes the pull request, then the body is still classified as the engine floor rather than authored prose.
- Given a template-seeded draft into which authoring wrote 1,000 characters of prose while leaving the floor marker in place, when FINISH observes the pull request, then the body is classified as authored prose rather than the engine floor.
- Given a template whose own text contains a line identical to a floor placeholder, when SHIP seeds the draft and FINISH later observes it unauthored, then the body is classified as the engine floor and the template line is still present exactly once.

### Done When

- [ ] A SHIP fixture with a template captures the create invocation and its body contains the template bytes verbatim between the floor marker and the closing-reference placeholder.
- [ ] A SHIP fixture without a template captures a create body byte-identical to the current `shipDraftPrBody` output.
- [ ] Floor classification returns floor for an unauthored seeded draft built from a template longer than 400 characters, and returns authored for the same draft with 1,000 characters of added prose.

## Story 3: The engine makes sure a region exists before its owning step runs

As a maintainer, I want my step to always find its region in the draft body, so that the step only fills in content and never has to write markers itself.

### Acceptance Criteria

#### Happy Path

- Given a retained draft pull request whose body lacks the `compliance-attest` region, as a reused halt pull request does, when `compliance-attest` is about to dispatch, then the body gains the template's `compliance-attest` region exactly once and every other byte of the body is unchanged.
- Given a retained draft whose body already contains the `compliance-attest` region with content, when `compliance-attest` is about to dispatch, then no pull request body edit is issued and the region's content is unchanged.
- Given a step that owns no region, when it is about to dispatch, then no pull request body read or edit is issued on its behalf.

#### Negative Paths

- Given a retained draft lacking the region and the guarded GitHub operation boundary refuses the body edit, when `compliance-attest` is about to dispatch, then the step is not dispatched and the run halts with a reason naming `compliance-attest` and the refusal.
- Given the retained draft body cannot be read because GitHub is unavailable, when `compliance-attest` is about to dispatch, then the step is not dispatched and the run halts with a reason naming `compliance-attest` and the failed read.
- Given no retained draft pull request exists for the branch because every early publish failed, when `compliance-attest` is about to dispatch, then the step is not dispatched and the run halts with a reason naming `compliance-attest` and the missing draft, rather than leaving FINISH to create the pull request.

### Done When

- [ ] A fixture reused-halt body without the region receives exactly one body edit whose result contains the template region once and preserves every other byte.
- [ ] A fixture body already holding the region records zero body edits before dispatch.
- [ ] Refused-edit, failed-read, and missing-draft fixtures each record no step dispatch and a halt reason containing `compliance-attest`.

## Story 4: A region is captured when its owning step succeeds

As a maintainer, I want the engine to take a copy of my step's contribution the moment the step succeeds, so that later rewrites cannot lose it and a step that reported success without contributing is caught at once.

### Acceptance Criteria

#### Happy Path

- Given `compliance-attest` reports `done` and its region holds `Attested-By: security-bot`, when the engine processes that completion, then a capture holding the region's exact bytes is persisted for that pull request and step key.
- Given a persisted capture and the conductor process restarts before FINISH, when the resumed run reaches FINISH, then the persisted capture is used and no new capture is taken from the current body.
- Given a persisted capture for `compliance-attest` and the step is dispatched again, when the second run reports `done` with different region content, then the capture holds the second run's bytes and not the first run's.

#### Negative Paths

- Given `compliance-attest` reports `done` and its region markers have been removed from the body, when the engine processes that completion, then the run halts with a reason naming `compliance-attest` and a missing region, and FINISH is not dispatched.
- Given `compliance-attest` reports `done` and its region is empty, when the engine processes that completion, then the run halts with a reason naming `compliance-attest` and an empty region, and FINISH is not dispatched.
- Given `compliance-attest` reports `done` and the body read fails, when the engine processes that completion, then no capture is persisted and the run halts with a reason naming `compliance-attest` and the failed read.
- Given `compliance-attest` ends `failed`, when the engine processes that outcome, then no capture is taken and no region halt is raised for it.
- Given a persisted capture recorded for a different pull request URL, when FINISH runs for the current pull request, then that capture is not used for the current pull request.

### Done When

- [ ] A completion fixture with region content persists a capture whose bytes equal the region bytes read from the body.
- [ ] A restart fixture reuses the persisted capture and records zero body reads for capture at FINISH.
- [ ] Missing-region, empty-region, and failed-read completion fixtures each halt with a reason containing `compliance-attest` and record no FINISH dispatch.

## Story 5: Every FINISH body rewrite keeps each captured region byte-for-byte

As a maintainer, I want my step's contribution to be present unchanged after FINISH rewrites the pull request body, so that FINISH prose authoring can never silently erase it.

### Acceptance Criteria

#### Happy Path

- Given a capture for `compliance-attest`, when prose authoring writes a body that omits the region, then the revision the prose judge evaluates contains the region with bytes identical to the capture.
- Given a capture, when the prose judge's repair rewrites the body without the region, then the body observed after the repair contains the region with bytes identical to the capture.
- Given a capture, when the body floor or halt pull request rehabilitation rewrites the body, then the body after that rewrite contains the region with bytes identical to the capture.
- Given captures for two steps, when prose authoring omits both regions, then the resulting body contains each region exactly once with bytes identical to its capture.
- Given prose authoring already left the region intact, when the authoring effect completes, then no additional body edit is issued and the prose judge runs exactly once for that revision.

#### Negative Paths

- Given a capture, when prose authoring keeps the region markers but changes the text between them, then the region is restored to the captured bytes and the altered text is gone.
- Given a capture, when prose authoring writes the region twice, then the resulting body contains the region exactly once with the captured bytes.
- Given a capture whose content is in a format the engine has never seen, such as `Compliance-Attestation: signed 2026-09-24`, when prose authoring omits it, then it is restored byte-for-byte like any other region.
- Given a capture, when the guarded GitHub operation boundary refuses the re-insertion edit, then the run halts with a reason naming the region's step and the refusal and the pull request is not marked ready.

### Done When

- [ ] An authoring fixture whose provider output omits the region yields a judged revision containing the captured bytes.
- [ ] Judge-repair, body-floor, and halt-rehabilitation fixtures each end with the region present once and byte-identical to the capture.
- [ ] An authoring fixture that preserved the region records zero re-insertion edits and exactly one judge session.
- [ ] A refused re-insertion fixture halts naming the step and records no ready-for-review call.

## Story 6: Regions are verified before the pull request is marked ready

As a maintainer, I want the engine to confirm every contribution is intact before the pull request leaves draft, so that no check or reviewer ever sees a ready pull request missing it.

### Acceptance Criteria

#### Happy Path

- Given every captured region is intact, when the production `ready_pr` publication transition runs, then the body is re-read, every region compares equal to its capture, and the pull request is marked ready.
- Given a region was edited after the last FINISH rewrite, when the production `ready_pr` publication transition runs, then the region is restored to its captured bytes, the re-read body compares equal, and only then is the pull request marked ready.
- Given every captured region is intact, when the finish completion repair runs, then regions are verified before its ready-for-review call.

#### Negative Paths

- Given a region cannot be restored because the guarded edit is refused, when the production `ready_pr` publication transition runs, then the pull request stays draft and the run halts with a reason naming the region's step.
- Given the re-read after a restore still differs from the capture, when the production `ready_pr` publication transition runs, then the pull request stays draft and the run halts with a reason naming the region's step and a verification mismatch.
- Given the verification read fails, when the finish completion repair runs, then no ready-for-review call is issued and the run halts naming the region's step and the failed read.

### Done When

- [ ] A fixture built from the production `ready_pr` composition, not a hand-built repair, records a region verification read before the ready-for-review call.
- [ ] A fixture with an edited region records one restore edit, then a matching re-read, then the ready-for-review call, in that order.
- [ ] Refused-restore, persistent-mismatch, and failed-read fixtures each record no ready-for-review call and a halt reason naming the step.

## Story 7: Engine-owned sections keep working beside project regions

As a maintainer, I want the engine's own pull request body sections to behave exactly as today when my regions are present, so that preserving my content never costs build-review evidence or issue linking.

### Acceptance Criteria

#### Happy Path

- Given a capture for `compliance-attest` and reduced build-review coverage to report, when FINISH publishes, then the body contains both the reduced build-review coverage section and the region with its captured bytes.
- Given a capture and accepted build-review risk, when FINISH publishes, then the accepted-risk section is written between its markers and the region is unchanged.
- Given a capture and a feature sourced from an intake issue, when the closing reference and plan declaration line are written, then both appear and the region is unchanged.

#### Negative Paths

- Given a step wrote the text `## Reduced build-review coverage` inside its region at run time, when the engine upserts its reduced build-review coverage section, then the region's bytes are unchanged and the engine's section is written outside every region.
- Given a region is positioned last in the body, when the engine appends its reduced build-review coverage section, then the section is written after the region's closing marker and the region's bytes are unchanged.

### Done When

- [ ] A publication fixture with a captured region and reduced coverage produces a body containing one coverage section outside the region and the region byte-identical to its capture.
- [ ] Accepted-risk, closing-reference, and plan-declaration fixtures each leave the region byte-identical to its capture.

## Story 8: A repository that declares no regions gets exactly today's FINISH

As a maintainer of a repository that has not adopted step regions, I want FINISH to behave exactly as it does today, so that this change costs me nothing.

### Acceptance Criteria

#### Happy Path

- Given a repository whose template has no region markers, when a feature runs from SHIP through FINISH, then the final pull request body is byte-identical to the body today's engine produces for the same inputs.
- Given a repository with no template, when a feature runs from SHIP through FINISH, then no region capture file is written and no region verification read is issued.

#### Negative Paths

- Given a repository with no region markers and a custom step that writes its own text into the body without markers, when FINISH prose authoring omits that text, then the text is not restored and no region halt is raised.
- Given a repository with no region markers, when the production `ready_pr` publication transition runs, then it issues exactly the GitHub operations it issues today.

### Done When

- [ ] An unmarked-template fixture and a no-template fixture each produce a final body byte-identical to a baseline recorded from the current engine for the same inputs.
- [ ] The no-template fixture records zero capture writes and zero region verification reads.

## Story 9: This repository's release metadata survives finish as an ordinary region

As the maintainer of ai-conductor, I want the `release-disposition` step's block to survive FINISH through the same region mechanism any repository uses, so that release workflows keep reading it and the engine carries no knowledge of this repository's release format.

### Acceptance Criteria

#### Happy Path

- Given this repository's template wraps the release metadata and migration sections in a `release-disposition` region and the step writes a `note` disposition, when FINISH completes, then the body's region is byte-identical to what the step wrote.
- Given the step wrote a `note` disposition with a `## Migration` section holding a runnable migration fence, when the release metadata check parses the finished body, then it accepts the disposition and the migration.
- Given a merged pull request whose body carries the region, when the release pull request workflow collects release candidates, then it reads the same category, semver, and note the step wrote.

#### Negative Paths

- Given prose authoring rewrites the body without any `Release-` lines, when FINISH reaches the ready flip, then the region is restored before the pull request is marked ready and the self-host release gate does not halt.
- Given `release-disposition` reports `done` and its region is empty, when the engine processes that completion, then the run halts with a reason naming `release-disposition` and an empty region.
- Given a `.pipeline/release-metadata-snapshot.json` left by an earlier engine version holds a different block, when FINISH restores regions, then the region holds the bytes captured from this run's step and the stale file's block does not appear in the body.

### Done When

- [ ] A self-host fixture whose authoring output drops the release block ends FINISH with the region byte-identical to the step's write, and the release metadata parser accepts the body.
- [ ] The release candidate collector returns the step's category, semver, and note from a body carrying the region.
- [ ] A fixture seeded with a stale `.pipeline/release-metadata-snapshot.json` ends FINISH with no trace of the stale block in the body.
