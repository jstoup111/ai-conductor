**Status:** Accepted

# Stories: Surface evidence-path overlap as suggested dependencies at intake filing time

**PRD:** .docs/specs/surface-evidence-path-overlap-as-suggested-depende.md
**Architecture review:** .docs/decisions/architecture-review-2026-09-28-surface-evidence-path-overlap-as-suggested-depende.md

FR-17 (filing guidance for acting on a refusal) is documentation. Under the stories documentation
boundary it has no story here; the refusal output itself carries the how-to-decide instructions
(Story 10).

Scope: the overlap check and its decision rule apply to filings made through the operator- and
agent-facing intake filer command. Engine-internal filings made by the daemon on its own (for
example review-deferral and beyond-scope follow-up issues) are unchanged and are never refused
(Story 10).

## Story 1: The filer recognizes file paths cited as evidence

**Requirement:** FR-1

As a filer, I want the paths my intake cites as evidence to be recognized, so that overlap is judged on the files I actually pointed at.

### Acceptance Criteria

#### Happy Path

- **Given** an intake body citing `src/engine/foo.ts:41` inline, **When** the overlap check runs, **Then** `src/engine/foo.ts` is among the recognized cited paths with the line suffix removed
- **Given** no target checkout is available and an intake title citing `bin/tool` and a body citing `./docs/guide.md#L10`, **When** the overlap check runs, **Then** both `bin/tool` and `docs/guide.md` are recognized cited paths
- **Given** a target checkout in which `src/engine/foo.ts` exists, **When** the body also contains the prose token `and/or` and the URL `https://github.com/o/r/pull/5`, **Then** only `src/engine/foo.ts` is recognized and neither the prose token nor the URL is treated as a cited path

#### Negative Paths

- **Given** an intake body whose only path-shaped token is `lib/gone.rb` and the target checkout has no such file at the base ref or in any scanned branch diff, **When** the overlap check runs, **Then** no cited paths are recognized and no suggestion is produced
- **Given** an intake body that cites `helper.ts` while an open issue cites `helperx.ts`, **When** the overlap check runs, **Then** no suggestion is produced because paths match only on exact equality after normalization
- **Given** an intake body that cites no path-shaped token at all, **When** the overlap check runs, **Then** it finds zero cited paths and the filing proceeds with no suggestion and no prompt

### Done When

- [ ] A fixture intake citing a path with a `:line` suffix yields exactly that path without the suffix
- [ ] A fixture intake containing a URL and slash-bearing prose yields no path candidates from them when a target checkout is available
- [ ] A fixture pair of near-identical file names yields no match

## Story 2: Open issues that cite the same paths are suggested

**Requirement:** FR-2

As a filer, I want open issues that cite the same evidence paths to be suggested as dependencies, so that I learn about parallel work before my issue exists.

### Acceptance Criteria

#### Happy Path

- **Given** open issue #1579 citing `src/review/rubric.ts` and a new intake citing `src/review/rubric.ts`, **When** the overlap check runs, **Then** #1579 is suggested with shared path `src/review/rubric.ts`
- **Given** open issue #1487 citing two of the three paths the new intake cites, **When** the overlap check runs, **Then** #1487 is suggested listing exactly those two shared paths

#### Negative Paths

- **Given** a **closed** issue citing the same path as the new intake, **When** the overlap check runs, **Then** the closed issue is not suggested
- **Given** an open issue in a different repository citing the same path, **When** filing targets this repository, **Then** that issue is not suggested
- **Given** open issues whose cited paths share no path with the new intake, **When** the overlap check runs, **Then** none of them is suggested

### Done When

- [ ] A replay fixture of the #1529/#1580 vs #1579 case yields #1579 as a suggestion for each of #1529 and #1580
- [ ] A closed-issue fixture yields no suggestion

## Story 3: In-flight spec and daemon branches that change the cited paths are reported

**Requirement:** FR-3

As a filer, I want unmerged in-flight work that changes the files I cite to be surfaced, so that I do not spec against code another feature is rewriting.

### Acceptance Criteria

#### Happy Path

- **Given** an unmerged `feat/daemon-«slug»` branch whose diff since its merge base changes `src/halt/markers.ts`, **When** a new intake citing `src/halt/markers.ts` is filed, **Then** that branch is reported as an overlap with shared path `src/halt/markers.ts`
- **Given** an unmerged `spec/«slug»` branch (local or remote-tracking) whose diff changes a cited path, **When** the overlap check runs, **Then** that branch is reported as an overlap with the shared path

#### Negative Paths

- **Given** a `feat/daemon-«slug»` branch with zero commits ahead of the base ref, **When** the overlap check runs, **Then** it is not reported even if its tree contains the cited path
- **Given** a branch outside the spec and daemon conventions (for example `fix/«name»`) that changes a cited path, **When** the overlap check runs, **Then** it is not reported
- **Given** a branch that has no merge base with the base ref, **When** the overlap check runs, **Then** that branch is skipped with a skip note naming it and the remaining branches are still compared
- **Given** a squash-merged `feat/daemon-«slug»` branch that still has commits ahead of the base ref and whose shipped record for «slug» exists on the base ref, **When** the overlap check runs, **Then** that branch is not reported and does not count toward the branch bound

### Done When

- [ ] A fixture repository with one overlapping daemon branch and one non-overlapping spec branch reports only the daemon branch
- [ ] A merged branch in the fixture is never reported, including a squash-merged branch whose shipped record is on the base ref

## Story 4: An in-flight overlap traces to its originating issue or stays advisory

**Requirement:** FR-4

As a filer, I want an overlapping in-flight branch to be offered as its originating issue when one is known, so that I can link a real dependency rather than a branch name.

### Acceptance Criteria

#### Happy Path

- **Given** an overlapping `feat/daemon-«slug»` branch whose own `.docs/intake/«slug».md` on that branch carries `Source-Ref: owner/repo#1477` for an open issue in the target repository, **When** the overlap check runs, **Then** #1477 is offered as a linkable suggestion with the branch's shared paths
- **Given** an overlapping branch whose tree has no `.docs/intake/«slug».md` for its own slug, **When** the overlap check runs, **Then** the overlap is shown as advisory naming the branch and shared paths and it requires no decision

#### Negative Paths

- **Given** an overlapping branch whose intake marker has an unparseable Source-Ref line, **When** the overlap check runs, **Then** the overlap is advisory only and the filing is not refused on its account
- **Given** an overlapping branch whose Source-Ref names a closed issue, **When** the overlap check runs, **Then** the overlap is advisory only and no link is offered
- **Given** an overlapping branch whose Source-Ref names an issue in a different repository than the filing target, **When** the overlap check runs, **Then** the overlap is advisory only and no link is offered

### Done When

- [ ] A fixture replay of the #1016 vs in-flight #1477 case offers #1477 as a linkable suggestion
- [ ] A marker-less overlapping branch appears in output as advisory and never causes a non-interactive refusal

## Story 5: A suggestion reached by more than one route is shown once

**Requirement:** FR-5

As a filer, I want each suggested issue listed once, so that I make one decision per issue.

### Acceptance Criteria

#### Happy Path

- **Given** issue #1487 is both an open-issue overlap on `a.ts` and the traced issue of an in-flight branch overlapping on `b.ts`, **When** suggestions are shown, **Then** #1487 appears exactly once listing shared paths `a.ts` and `b.ts`

#### Negative Paths

- **Given** the same issue reached by two routes that share the same path, **When** suggestions are shown, **Then** that path is listed once for that issue and not duplicated

### Done When

- [ ] A fixture with one issue reachable by both routes produces a single suggestion with the union of shared paths

## Story 6: Suggestions are ranked and capped

**Requirement:** FR-6

As a filer, I want the strongest overlaps first and a bounded list, so that the decision stays fast.

### Acceptance Criteria

#### Happy Path

- **Given** three linkable suggestions sharing 3, 1 and 2 paths respectively, **When** they are shown, **Then** they appear in order of 3, 2, 1 shared paths
- **Given** eight linkable suggestions, **When** they are shown, **Then** the top five by shared-path count are shown and the output states that 3 more were omitted

#### Negative Paths

- **Given** eight linkable suggestions where three are omitted by the cap, **When** a non-interactive filer has decided all five shown suggestions, **Then** the issue is created and the omitted three do not cause a refusal
- **Given** two suggestions with equal shared-path counts, **When** they are shown, **Then** their order is deterministic across repeated runs (lower issue number first)

### Done When

- [ ] A fixture with eight suggestions shows five and reports "3 more omitted"
- [ ] Two runs over the same fixture produce identical suggestion order

## Story 7: Dependencies already named are not suggested again

**Requirement:** FR-7

As a filer who already knows a dependency, I want it treated as accepted, so that I am not asked about it twice.

### Acceptance Criteria

#### Happy Path

- **Given** a filing that already names `owner/repo#1579` as a dependency and #1579 overlaps, **When** the overlap check runs, **Then** #1579 is not shown as a suggestion and is linked as a dependency

#### Negative Paths

- **Given** a non-interactive filing whose only overlapping issue is already named as a dependency, **When** the filing runs, **Then** it is not refused and the issue is created
- **Given** a filing that names #1579 as a dependency while #1487 also overlaps, **When** the filing runs non-interactively, **Then** only #1487 is listed as undecided in the refusal

### Done When

- [ ] A fixture filing with every overlap pre-named files successfully without a prompt or refusal

## Story 8: A filing with no overlap behaves exactly as today

**Requirement:** FR-8

As a filer, I want a no-overlap filing to cost me nothing extra, so that the check adds no burden in the common case.

### Acceptance Criteria

#### Happy Path

- **Given** an intake whose cited paths overlap no open issue and no in-flight branch, **When** it is filed interactively, **Then** no overlap prompt appears and the issue, labels and dependency outcome are the same as filing without the check
- **Given** the same no-overlap intake filed non-interactively, **When** the filing runs, **Then** it exits successfully and the output differs from today's by at most one line confirming the overlap check ran

#### Negative Paths

- **Given** a no-overlap intake filed with no dependencies named, **When** the filing completes, **Then** the output still reports the explicit "dependencies: none" decision
- **Given** a no-overlap intake, **When** the filing runs non-interactively, **Then** no additional input is required and the exit status is 0

### Done When

- [ ] A no-overlap fixture filing produces the same created-issue request, labels and dependency calls as the pre-change filer
- [ ] Its output contains at most one additional line

## Story 9: An interactive filer accepts or declines each suggestion

**Requirement:** FR-9

As an operator filing from a terminal, I want to accept or decline each suggestion before the issue is created, so that the dependency decision happens while context is warm.

### Acceptance Criteria

#### Happy Path

- **Given** an interactive filing with suggestions #1579 and #1487, **When** the operator accepts #1579 and declines #1487, **Then** the issue is created with #1579 linked as a dependency and #1487 reported as declined
- **Given** an interactive filing with one suggestion, **When** the operator accepts it, **Then** it is linked exactly as a dependency named up front would be

#### Negative Paths

- **Given** an interactive prompt for a suggestion, **When** the operator enters an answer that is neither accept nor decline, **Then** the same suggestion is asked again and nothing is created until a valid answer is given
- **Given** an interactive prompt, **When** the input stream closes before every suggestion is answered, **Then** no issue is created and the filer exits non-zero listing the undecided suggestions
- **Given** only advisory (non-linkable) overlaps, **When** filing interactively, **Then** they are shown but the operator is not prompted for them

### Done When

- [ ] An interactive fixture with scripted answers creates one issue whose dependency calls contain exactly the accepted issues
- [ ] A closed-input fixture creates no issue

## Story 10: A non-interactive filing with undecided suggestions is refused before creation

**Requirement:** FR-10

As an agent filing without a terminal, I want a deterministic refusal that lists what I must decide, so that overlaps are never filed past silently.

### Acceptance Criteria

#### Happy Path

- **Given** a non-interactive filing with undecided linkable suggestion #1579 sharing `src/review/rubric.ts`, **When** the filing runs, **Then** no issue is created, the exit status is non-zero, and the output lists #1579 with `src/review/rubric.ts` and states how to accept it or decline it on a re-run

#### Negative Paths

- **Given** a refused non-interactive filing, **When** GitHub is inspected afterwards, **Then** no issue, label or dependency link was created by that run
- **Given** a non-interactive filing whose only overlaps are advisory, **When** the filing runs, **Then** it is not refused and the issue is created with the advisory overlaps shown
- **Given** the daemon files an engine-internal follow-up issue citing a path that an open issue also cites, **When** that filing runs, **Then** no overlap check runs, it is never refused, and it creates the issue exactly as before this feature

### Done When

- [ ] A non-interactive fixture with one undecided suggestion records zero create, label or dependency operations and exits non-zero
- [ ] An engine-internal filing fixture with an overlapping open issue creates its issue and receives no overlap check
- [ ] The refusal output names each undecided issue, its shared paths, and both re-run options

## Story 11: A non-interactive re-run with every suggestion decided files the issue

**Requirement:** FR-11

As an agent filing without a terminal, I want to accept or decline each suggestion on a re-run, so that I can complete the filing.

### Acceptance Criteria

#### Happy Path

- **Given** a prior refusal listing #1579 and #1487, **When** the agent re-runs naming #1579 as a dependency and declining #1487, **Then** the issue is created with #1579 linked and #1487 recorded as declined
- **Given** a prior refusal listing #1487, **When** the agent re-runs declining #1487, **Then** the issue is created with no dependency link

#### Negative Paths

- **Given** a prior refusal listing #1579 and #1487, **When** the agent re-runs deciding only #1579, **Then** the filing is refused again listing only #1487 as undecided
- **Given** a re-run on which a new overlapping issue #1600 has appeared since the refusal, **When** the agent re-runs deciding only #1579 and #1487, **Then** the filing is refused listing #1600 as undecided

### Done When

- [ ] A two-step non-interactive fixture (refuse, then fully-decided re-run) creates exactly one issue
- [ ] A partially-decided re-run creates no issue

## Story 12: Declines are reported as explicit decisions

**Requirement:** FR-12

As an operator reviewing a filing, I want every declined suggestion named in the output, so that "considered and declined" is distinguishable from "never checked".

### Acceptance Criteria

#### Happy Path

- **Given** a filing in which #1487 was declined and #1579 accepted, **When** the filing completes, **Then** the output names #1487 as declined and #1579 as linked
- **Given** a filing in which every suggestion was declined and no dependency was named, **When** the filing completes, **Then** the output names each declined issue and also reports "dependencies: none"

#### Negative Paths

- **Given** a filing that declined #1487, **When** the created issue body is inspected, **Then** it equals the body the pre-change filer submits for the same input with no declined-overlap text added
- **Given** an accepted suggestion whose dependency link then fails to record on GitHub, **When** the filing completes, **Then** the link failure is reported exactly as it is for the same dependency named up front

### Done When

- [ ] A fixture filing with one decline and one accept prints both decisions
- [ ] The created-issue body in the fixture equals the body the pre-change filer submits for the same input

## Story 13: Declining an issue that was not suggested is rejected

**Requirement:** FR-13

As a filer, I want a mistyped decline to be caught, so that it cannot silently hide a real suggestion.

An invalid decline is fatal while an invalid dependency reference only warns. That asymmetry is
deliberate: a bad dependency reference loses one link, but a bad decline could suppress the very
suggestion the check exists to surface.

### Acceptance Criteria

#### Happy Path

- **Given** suggestion #1579, **When** the filer declines #1579, **Then** the decline is accepted as a valid decision

#### Negative Paths

- **Given** suggestions #1579 only, **When** the filer declines #1597, **Then** nothing is created and the filer exits non-zero naming #1597 as not a current suggestion
- **Given** a decline value that is not an `owner/repo#N` reference, **When** the filing runs, **Then** nothing is created and the filer exits non-zero naming the malformed value
- **Given** an advisory-only overlap on a branch with no traced issue, **When** the filer declines a number unrelated to any suggestion, **Then** nothing is created and the invalid decline is named

### Done When

- [ ] A fixture declining an unsuggested issue records zero create operations and exits non-zero

## Story 14: A failure inside the check never blocks filing

**Requirement:** FR-14

As a filer, I want a broken or partial check to degrade to a note, so that I never lose an intake because the check itself failed.

### Acceptance Criteria

#### Happy Path

- **Given** the open-issue read fails, **When** a non-interactive filing runs with no other overlaps, **Then** the issue is created and the output names the skipped open-issue comparison and why
- **Given** more than 500 open issues or more than 100 unmerged branches, **When** the overlap check runs, **Then** it compares up to the bound, reports the comparison as partial, and filing proceeds

#### Negative Paths

- **Given** the open-issue read times out while an in-flight branch yields undecided linkable suggestion #1477, **When** a non-interactive filing runs, **Then** it is refused for #1477 only and the output also names the skipped open-issue comparison
- **Given** the base ref of the target checkout cannot be resolved, **When** the filing runs, **Then** the in-flight comparison is skipped with a note and the open-issue comparison still runs
- **Given** every part of the check fails, **When** a non-interactive filing runs, **Then** the issue is created exactly as today and each skipped part is named in the output

### Done When

- [ ] A fixture with a failing tracker read files successfully and prints a skip note
- [ ] A fixture with a failing tracker read plus an undecided branch suggestion refuses only for that suggestion

## Story 15: The in-flight comparison uses the target repository's own checkout

**Requirement:** FR-15

As a filer in a consumer project, I want in-flight work compared in that project's checkout, so that the harness's own branches never produce suggestions for my repository.

### Acceptance Criteria

#### Happy Path

- **Given** the filer is invoked from a checkout whose origin is `acme/widgets` and filing targets `acme/widgets`, **When** the overlap check runs, **Then** the in-flight comparison uses that checkout's branches
- **Given** the filer is invoked from an unrelated directory and exactly one registered project's remote resolves to the target `acme/widgets`, **When** the overlap check runs, **Then** the in-flight comparison uses that registered project's checkout

#### Negative Paths

- **Given** filing targets `acme/widgets` and neither the invoking directory nor any registered project matches it, **When** the overlap check runs, **Then** the in-flight comparison is skipped with a note and the harness's own branches are never compared
- **Given** two registered projects whose remotes both resolve to `acme/widgets`, **When** the invoking directory does not match, **Then** the in-flight comparison is skipped with a note naming the ambiguity
- **Given** the invoking directory is a checkout of a different repository than the filing target, **When** the overlap check runs, **Then** that checkout's branches are not compared

### Done When

- [ ] A fixture filing into a consumer repo from the harness directory never enumerates the harness repository's branches
- [ ] A fixture with an ambiguous registry reports the skip and still runs the open-issue comparison

## Story 16: Each overlap check and its outcome is observable afterwards

**Requirement:** FR-16

As an operator, I want each check's outcome recorded on the event record the filer already persists, so that I can audit what was suggested and decided.

### Acceptance Criteria

#### Happy Path

- **Given** a filing with two suggestions, one accepted and one declined, **When** the filing completes, **Then** the filer's existing event record holds one overlap-check entry giving the suggestion count, the accepted issue, the declined issue and no skipped parts
- **Given** a refused non-interactive filing, **When** it exits, **Then** the event record holds an overlap-check entry marking the outcome as refused with the undecided issues

#### Negative Paths

- **Given** a filing in which the open-issue comparison was skipped, **When** the filing completes, **Then** the overlap-check entry names the skipped part and its reason
- **Given** a no-overlap filing, **When** it completes, **Then** exactly one overlap-check entry is recorded with zero suggestions and the check itself writes no separate file or log

### Done When

- [ ] Each fixture filing appends exactly one overlap-check event to the filer's existing event record
- [ ] The check's own writes are limited to that one event

## Story 17: The plan-time overlap scan is unchanged

**Requirement:** FR-3

As an engineer running DECIDE, I want the plan-time overlap scan to keep its current behavior, so that adding daemon branches at filing time does not change DECIDE output.

### Acceptance Criteria

#### Happy Path

- **Given** a repository with an unmerged spec branch overlapping candidate files, **When** the DECIDE-time overlap scan runs, **Then** it reports that spec branch exactly as before this feature

#### Negative Paths

- **Given** a repository with an unmerged daemon build branch overlapping candidate files, **When** the DECIDE-time overlap scan runs, **Then** the daemon branch is not reported because the scan's branch set stays exactly today's `spec/*` set

### Done When

- [ ] A regression fixture shows the DECIDE-time scan's branch set and rendered report are identical before and after the change
