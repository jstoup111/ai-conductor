**Status:** Accepted

# Stories for shorter spec reviews (#3419)

## Story 1: Read each criterion once

**Requirement:** FR-1

### Acceptance Criteria

#### Happy Path
- Given a Medium spec with a criterion supported by two tasks, when a reviewer traces either task to its criterion, then both references lead to the same story passage and its full wording occurs once across the authored artifacts.
- Given a referenced criterion, when its author moves it or edits its wording, then its ID continues to resolve to that criterion and its current wording.

#### Negative Paths
- Given a mapped criterion is removed and another now occupies its former position, when land checks the mapping, then it reports the removed ID and refuses the mapping.
- Given a task check moved within its task during revision, when a reviewer follows its existing reference, then the reference still identifies that check.

### Done When
- [ ] Compare the criterion occurrences and referenced check identities before and after reordering.

## Story 2: Identify what to read from the file list

**Requirement:** FR-2

### Acceptance Criteria

#### Happy Path
- Given a new opted-in product spec, when a reviewer opens the changed-file list, then requirements, stories, architecture and plan summary appear together in reading order, separately from full tasks and bookkeeping.

#### Negative Paths
- Given a technical-track spec without a PRD, when the reviewer opens its reading set, then the remaining applicable review files are identifiable and no required link points to an absent PRD.

### Done When
- [ ] Inspect the two file listings and follow links to material decisions and findings.

## Story 3: Measure the complete reading burden

**Requirement:** FR-3

### Acceptance Criteria

#### Happy Path
- Given equivalent Medium and Large specs in both layouts, when reviewers compare all required reading, then each new reading set is measurably shorter and preserves the decisions, acceptance criteria and delivery scope.

#### Negative Paths
- Given a summary that moves a required decision into a linked document, when the comparison is made, then the linked material counts toward the new total.

### Done When
- [ ] Record both before-and-after character totals with the counted files and eliminated repeated passages for each example.

## Story 4: Name every criterion missing proof

**Requirement:** FR-4

### Acceptance Criteria

#### Happy Path
- Given a complete mapping to existing task completion checks and valid dispositions, when the author lands the spec, then the coherence check accepts it.

#### Negative Paths
- Given two uncovered criteria, when land checks the spec, then the refusal identifies both by ID and canonical wording.
- Given duplicated criterion IDs, a dangling check, or a check attributed to the wrong task, when the author attempts land, then each invalid reference prevents acceptance and the diagnostic identifies the affected entry.

### Done When
- [ ] Inspect land results for a complete example and each independently corrupted example, including existing waiver behavior.

## Story 5: Give each gate its full evidence

**Requirement:** FR-5

### Acceptance Criteria

#### Happy Path
- Given a spec with material decisions and task-level proof, when plan review, PRD audit and coverage judgement run, then they can assess the same obligations and read the same substantive evidence as for the equivalent legacy spec.

#### Negative Paths
- Given an indexed plan-review input that requires inline fallback, when review starts, then it receives the full executable plan and the referenced evidence.
- Given a real but irrelevant completion check, when coverage is judged, then the reference can be resolved and the judgement can still reject it as insufficient.

### Done When
- [ ] Capture the evidence available through each normal gate entry point and compare the judged obligation and finding on a fixed defective example.

## Story 6: Author the same layout on both routes

**Requirement:** FR-6

### Acceptance Criteria

#### Happy Path
- Given equivalent opted-in features with a description different from the plan stem, when authored through composer and interactive conduct, then both resolve the complete feature-specific evidence before BUILD.

#### Negative Paths
- Given an interrupted authoring session and a changed project layout setting, when the author resumes, then the feature keeps its initial selection and BUILD cannot consume a partial registration.
- Given an uncommitted criterion edit, when the author runs pre-registration review, then it sees the edited criterion.

### Done When
- [ ] Compare the resolved artifacts at handoff for both routes, including after retry.

## Story 7: Keep existing specs usable during adoption

**Requirement:** FR-7

### Acceptance Criteria

#### Happy Path
- Given a legacy spec with no manifest and another with a version-one manifest, when the project opts in, then both still review, build and ship using their existing artifacts.

#### Negative Paths
- Given a new-format spec with a malformed manifest and a similarly named legacy file, when a reader opens the spec, then it reports the manifest failure without borrowing the legacy file.

### Done When
- [ ] Exercise discovery and downstream reads against a mixed history and verify the default layout for a new feature in an unconfigured project.

## Story 8: Clean up both plan files after shipment

**Requirement:** FR-8

### Acceptance Criteria

#### Happy Path
- Given a shipped feature eligible for cleanup, when the operator previews its cleanup PR, then the summary, full plan, prunable mappings and manifest are selected together and durable requirements, stories, architecture and decisions remain readable after merge.

#### Negative Paths
- Given an open PR editing only the summary, when cleanup selects candidates, then the whole feature is deferred.
- Given an unshipped feature or a malformed shipped manifest, when cleanup runs, then neither feature contributes a deletion.
- Given both plan files have been pruned, when shipment audit requests the historical plan, then it recovers the executable plan with its completion checks.

### Done When
- [ ] Inspect selected and deferred paths for mixed-layout features, read retained files, and recover the full plan through historical lookup.
