**Status:** Accepted

# Stories: Browsable Documentation Site

Track: **product** · Complexity: **Medium** · Source: issue #831 supplied in chat

## Story 1: Open the hosted documentation front door

**Requirement:** FR-1

As a prospective user, I want the public documentation URL to open a recognizable landing page so that I can begin learning the project without browsing repository folders.

### Acceptance Criteria

#### Happy Path

- Given the default-branch documentation has published successfully, when a reader requests the public documentation root, then the response is HTTP 200 and identifies the site as AI Conductor documentation.
- Given the landing page is open, when a reader scans its first screen, then the page explains what the documentation covers and offers an obvious path to begin.

#### Negative Paths

- Given the public root would render a missing-page response or non-success status, when publication is evaluated, then delivery is not reported as successful and the failed deployment remains visible.
- Given the root returns a generic page with no AI Conductor identity or starting path, when the landing contract is validated, then repository validation fails.

### Done When

- [ ] A live request to the public documentation root returns HTTP 200 after publication.
- [ ] The returned page contains the AI Conductor documentation title and an observable start path.

## Story 2: Discover every documentation section from the landing page

**Requirement:** FR-2

As a reader, I want the landing page to organize the documentation by purpose so that I can choose the right kind of help quickly.

### Acceptance Criteria

#### Happy Path

- Given the landing page, when its primary navigation is inspected, then quickstart, guides, reference, explanation, runbooks, and contributing are each represented by a working entry.
- Given a section entry, when a reader follows it, then the reader reaches that section's hosted index rather than a repository file-browser page.

#### Negative Paths

- Given any required top-level section is absent, when the navigation contract runs, then it fails and names the missing section.
- Given a section entry targets a missing or repository-browser location, when internal links are checked, then the change fails validation before merge.

### Done When

- [ ] All six required section entries are present on the hosted landing page.
- [ ] Each section entry resolves to a successful hosted section page.

## Story 3: Navigate consistently from every topic

**Requirement:** FR-3

As a documentation reader, I want persistent site navigation on every topic so that I can move elsewhere without returning to the repository.

### Acceptance Criteria

#### Happy Path

- Given any published topic on a desktop viewport, when the page loads, then persistent navigation exposes the documentation home and every top-level section.
- Given any published topic on a narrow mobile viewport, when the reader opens the navigation control, then the same home and top-level section destinations are available and usable.

#### Negative Paths

- Given a topic lacks the metadata needed to appear within site navigation, when the navigation contract runs, then validation fails and names that topic.
- Given navigation is unavailable or unusable at a narrow viewport, when responsive behavior is verified, then the story is not accepted even if desktop navigation works.

### Done When

- [ ] Representative pages from every section expose the same home and section navigation on desktop.
- [ ] The same navigation destinations are usable at a narrow mobile viewport.

## Story 4: Prevent orphaned documentation topics

**Requirement:** FR-4

As a maintainer, I want every maintained topic represented in site navigation so that useful guidance cannot silently become undiscoverable.

### Acceptance Criteria

#### Happy Path

- Given the current repository documentation corpus, when navigation coverage is enumerated, then every human-facing Markdown topic maps to exactly one reachable place in the hosted hierarchy.
- Given a new topic is added with valid navigation membership, when repository validation runs, then it passes without requiring a hand-maintained duplicate content list.

#### Negative Paths

- Given an existing or new topic has no navigation membership, when repository validation runs, then it fails and prints the orphaned path.
- Given one topic is represented more than once under conflicting parents, when repository validation runs, then it fails and identifies the ambiguous membership.

### Done When

- [ ] A deterministic enumeration reports zero orphaned current topics.
- [ ] A fixture or scoped failure case proves that an unregistered topic is rejected with its path.

## Story 5: Keep repository Markdown authoritative

**Requirement:** FR-5

As a contributor, I want hosted documentation to come from the same Markdown reviewed with feature changes so that the live site cannot drift from repository truth.

### Acceptance Criteria

#### Happy Path

- Given a maintained documentation paragraph changes in a feature pull request and reaches the default branch, when publication completes, then the hosted topic shows that merged paragraph.
- Given the site source is inspected, when content-bearing files are enumerated, then documentation prose exists only in the normal repository Markdown surface.

#### Negative Paths

- Given generated site output, a separate wiki, or another out-of-repository content surface is proposed as an authoritative source, when source ownership is validated, then the change is rejected.
- Given hosted prose differs from the corresponding merged Markdown after publication completes, when live verification compares a representative marker, then verification fails and reports the mismatch.

### Done When

- [ ] The hosted page for a representative marker matches the merged Markdown after publication.
- [ ] No generated site output or duplicate documentation content source is committed or configured as authoritative.

## Story 6: Publish merged documentation automatically

**Requirement:** FR-6

As a maintainer, I want merged documentation changes to publish automatically so that the public site stays current without a release ritual.

### Acceptance Criteria

#### Happy Path

- Given a documentation change merges to the default branch, when the host observes that update, then a Pages deployment starts automatically without an operator publish command.
- Given the deployment succeeds, when the public topic is requested after completion, then it reflects the merged change.

#### Negative Paths

- Given the hosted build dependency or build step is unavailable, when publication runs, then the deployment has a visible failed status and is not represented as successful.
- Given a default-branch change has produced no deployment event, when publication evidence is checked, then the feature is not considered operationally verified and the missing event is reported.

### Done When

- [ ] A default-branch documentation commit produces a Pages deployment without manual publishing.
- [ ] The completed deployment exposes the merged representative change at the public URL.

## Story 7: Keep unmerged changes off the public site

**Requirement:** FR-7

As a reader, I want the public site to represent only accepted default-branch content so that work in progress cannot replace authoritative guidance.

### Acceptance Criteria

#### Happy Path

- Given a feature branch changes a distinctive documentation marker, when the branch is pushed but not merged, then the public site continues showing the default-branch marker.
- Given that feature branch later merges and publication succeeds, when the public topic is refreshed, then the new marker becomes visible.

#### Negative Paths

- Given a non-default branch update, when repository publication events are inspected, then no public deployment may use that branch as its source.
- Given an unmerged marker appears on the public site, when source provenance is checked, then verification fails and the publication configuration is treated as incorrect.

### Done When

- [ ] A non-default branch push leaves the public site's representative marker unchanged.
- [ ] The same marker becomes public only after merge and successful default-branch publication.

## Story 8: Reach hosted docs from the project overview

**Requirement:** FR-8

As a newcomer on the repository landing page, I want a prominent hosted-documentation link while retaining source links so that I can choose the rendered site or inspect Markdown directly.

### Acceptance Criteria

#### Happy Path

- Given the root project overview's Documentation section, when a reader scans its opening content, then a clearly labeled hosted-documentation link points to the public landing page.
- Given a reader prefers repository source, when the same section is inspected, then useful direct links to the in-repository topics remain available.

#### Negative Paths

- Given the hosted link is absent or points anywhere other than the successful public landing page, when the front-door contract is checked, then acceptance fails.
- Given adding the hosted link removes the existing source-topic index, when documentation discoverability is compared, then acceptance fails because source readers lost navigation.

### Done When

- [ ] The Documentation section exposes a prominent link to the HTTP-200 hosted landing page.
- [ ] The existing categorized source-topic links remain present and valid.

## Story 9: Surface broken navigation and publication

**Requirement:** FR-9

As a maintainer, I want broken site structure and failed publication to be visible so that the documentation site cannot silently rot.

### Acceptance Criteria

#### Happy Path

- Given valid site metadata and internal links, when repository validation runs, then navigation coverage and link checks pass with explicit success.
- Given the default branch publishes successfully, when repository deployment status is inspected, then it identifies the successful Pages deployment.

#### Negative Paths

- Given a topic loses required navigation metadata or an internal target, when repository validation runs, then it exits non-zero and names the file and violated contract.
- Given the hosted build cannot load its presentation dependency or render the site, when Pages processes the default-branch change, then deployment status is failed and the last successful site is not replaced by a false-success result.

### Done When

- [ ] Scoped negative tests prove missing navigation metadata and broken internal targets fail repository checks with actionable paths.
- [ ] Publication failure is observable through Pages deployment status, while live third-party probes remain opt-in smoke/manual checks.

## Verify-Claims Ledger

### Claims

- [verified] FR-1 through FR-9 map one-to-one to Stories 1 through 9 — checked against the approved PRD.
- [verified] The external publication and presentation failure modes in Stories 6 and 9 follow the approved architecture and ADR.
- [verified] Issue #787's accepted stories explicitly left Pages wiring to issue #831, so these stories do not duplicate its documentation-relocation scope.

### Assumptions

- None pending. Expected behavior is grounded in the approved PRD, operator-approved ADR, and verified existing Pages boundary.

Verdict: CLEAR
