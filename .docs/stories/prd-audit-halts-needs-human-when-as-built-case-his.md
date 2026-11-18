**Status:** Accepted

# Stories: Remediation history handed off by file

Technical track (no PRD). Each story names the decision of
`architecture-review-2026-11-15-prd-audit-halts-needs-human-when-as-built-case-his` it
delivers, under `adr-2026-09-07-durable-prd-widening-decision-reconciliation` D7.4.

## Story 1: Remediation history of any size reaches the agent in full

**Requirement:** D7.4; review decisions 1, 2, 3, 5

As an operator running a long feature, I want its whole remediation history handed to the remediation agent as files so that an ordinary amount of history never stops the feature.

### Acceptance Criteria

#### Happy Path
- Given a feature with 11 open prior as-built cases whose serialized size is over 8 KiB, when a `gap-plan` remediation dispatch is prepared, then the dispatch runs and the attempt's active history file contains all 11 cases with every source and every repair task.
- Given a feature whose pending as-built findings, prior laps, and refusals together serialize to more than 512 KiB, when a `gap-plan` remediation dispatch is prepared, then the dispatch runs and the attempt's history files contain every pending finding, prior lap, and refusal with no entry shortened or omitted.
- Given a feature with no pending findings, no prior laps, no refusals, and no prior as-built cases, when a `gap-plan` remediation dispatch is prepared, then both history files are still written with empty collections and the dispatch runs.
- Given a remediation attempt whose dispatch is retried after a rejected plan, when the retry is prepared for the same attempt, then it uses the same two history files with unchanged content.
- Given a second remediation attempt on the same feature, when its history files are written, then the first attempt's history files are still present and unchanged.

#### Negative Paths
- Given the history directory cannot be written, when a `gap-plan` remediation dispatch is prepared, then no remediate dispatch runs and the feature halts `mechanical` with a preparation fault naming the history snapshot and the write error.
- Given a history file write that fails after the active file is written but before the resolved file is written, when preparation ends, then no remediate dispatch runs and the fault names the file that failed.
- Given required references or plan tasks that exceed their engine limit, when a `gap-plan` remediation dispatch is prepared, then preparation still stops before invocation naming that dimension, its actual size, and its limit.
- Given a present kickback ledger that is corrupt or unreadable, when a `gap-plan` remediation dispatch is prepared, then preparation stops naming the ledger and no history file is treated as a valid empty history.
- Given a PRD-widening reconciliation dispatch or a `build_review` case-context dispatch, when it is prepared, then no remediation history file is written and its input is unchanged.

### Done When
- [ ] A projection test over a case store with 11 open cases larger than 8 KiB asserts a successful result and that the active history file holds all 11 cases with their sources and repair tasks
- [ ] A projection test over more than 512 KiB of pending findings, prior laps, and refusals asserts a successful result and entry-for-entry equality between the files and the in-memory history
- [ ] A projection test with an injected failing filesystem asserts a `mechanical` halt whose detail names the history snapshot, and that no dispatch was made
- [ ] A test asserts an oversize `tasks` or `required-references` dimension still faults with its dimension, actual, and limit

## Story 2: The engine separates active history from resolved history

**Requirement:** review decision 2

As the remediation agent, I want the history I must act on separated from history that is already resolved so that I load resolved cases only when they matter.

### Acceptance Criteria

#### Happy Path
- Given a case store with one `open`, one `needs-human`, and two `resolved` prior as-built cases, none of whose sources is a current pending finding, when the history files are written, then the active file holds the `open` and `needs-human` cases and the resolved file holds the two `resolved` cases, each in full.
- Given a `resolved` prior as-built case one of whose sources carries the id of a current pending as-built finding, when the history files are written, then that case is in the active file and not in the resolved file.
- Given any mix of prior as-built cases, when the history files are written, then every case appears in exactly one of the two files and the two files together hold exactly the cases the case store holds.
- Given pending as-built findings, prior laps, and refusals, when the history files are written, then all of them are in the active file and none is in the resolved file.

#### Negative Paths
- Given a remediation case store that is present but unreadable or malformed, when the history files would be written for an as-built verdict, then no remediate dispatch runs, the feature halts `needs-human`, and the fault names the store as unreadable instead of writing an empty history.
- Given a round with only a PRD-audit FIXABLE verdict and no as-built verdict, when the history files are written, then neither file contains a prior as-built case section and the dispatch runs.
- Given a `resolved` case whose sources name only findings that are no longer pending, when the history files are written, then the case is in the resolved file only, with its full source summaries.
- Given a `resolved` case in the resolved file, when the history files are written, then no field of that case is summarized, truncated, or dropped relative to the case store.

### Done When
- [ ] A projection test over a store with `open`, `needs-human`, and `resolved` cases asserts which file each case lands in and that each is byte-equal to its in-memory projection
- [ ] A projection test asserts a `resolved` case with a currently pending source finding lands in the active file only
- [ ] A projection test asserts the union of both files equals the stored case set with no duplicates
- [ ] A projection test over an unreadable case store asserts a `needs-human` halt naming the store and that no history file was written

## Story 3: The remediation prompt carries an index, not the history

**Requirement:** review decisions 4, 5

As an operator paying for remediation dispatches, I want the prompt to carry only an index of the history so that the prompt size does not grow with the history.

### Acceptance Criteria

#### Happy Path
- Given a prepared `gap-plan` dispatch, when its prompt input is rendered, then it contains, for each history dimension, the entry ids and the entry count, and it contains the path and SHA-256 digest of the active file and of the resolved file.
- Given a prepared `gap-plan` dispatch with prior as-built cases in the resolved file, when its prompt input is rendered, then each such case is listed by its case id and its source finding ids and by nothing else.
- Given two features whose histories differ in size by a factor of 100 but have the same required references and tasks, when their prompt inputs are rendered, then the prompt inputs differ only by the index entries, paths, and digests.
- Given a prepared `gap-plan` dispatch, when its prompt input is rendered, then the projection version it states is higher than the version stated before this change.

#### Negative Paths
- Given a prepared `gap-plan` dispatch with pending findings, open prior cases, prior laps, and refusals, when its prompt input is rendered, then it contains no `pendingAsBuiltFindings`, `priorAsBuiltCases`, `priorLaps`, or `refusals` collection, and each of those dimensions appears only as ids and a count in the index.
- Given a history file whose content is changed on disk after it was written, when the digest in the prompt index is compared with the file, then they differ, so the change is detectable from the index.
- Given an inlined payload whose total size exceeds the total engine limit, when a `gap-plan` dispatch is prepared, then preparation stops before invocation naming the total dimension, its actual size, and its limit, and the history file sizes are not counted toward that total.
- Given a history dimension with no entries, when the prompt input is rendered, then the index states a count of zero for that dimension instead of omitting it.

### Done When
- [ ] A rendering test asserts the prompt input contains every history entry id, per-dimension counts, both paths, and digests equal to the SHA-256 of the written files
- [ ] A rendering test asserts the prompt input has none of the four history collections and represents each only by ids and a count
- [ ] A rendering test asserts archived resolved cases are listed by case id and source finding ids only
- [ ] A test asserts the total-limit fault measures the inlined payload and ignores history file size

## Story 4: A history size overflow never asks for a human

**Requirement:** D7.4; review decision 6

As an operator, I want a needs-human halt only when I can decide something so that a feature is never stopped on a fault I cannot resolve.

### Acceptance Criteria

#### Happy Path
- Given a prior as-built case naming a repair task id that the active plan no longer declares, when a `gap-plan` dispatch is prepared, then no remediate dispatch runs and the feature halts `needs-human` with a preparation fault naming that task id.
- Given a remediation case store that is present but unreadable, when a `gap-plan` dispatch is prepared for an as-built verdict, then the feature halts `needs-human` with a preparation fault naming the store.
- Given any preparation fault that reports an actual size and a limit, when the halt is written, then its class is `mechanical`.

#### Negative Paths
- Given prior as-built cases of any total size, when a `gap-plan` dispatch is prepared, then no preparation fault names the prior-as-built-cases, pending-as-built-findings, prior-laps, or refusals dimension for its size.
- Given a preparation fault from an unreadable kickback ledger or a missing typed verdict, when the halt is written, then its class is `mechanical` and not `needs-human`.
- Given a history snapshot write failure during an as-built round, when the halt is written, then its class is `mechanical` even though prior as-built cases were being written.
- Given an owner task missing from the active plan that no prior as-built case names as a repair task, when a `gap-plan` dispatch is prepared, then the halt class is `mechanical`.

### Done When
- [ ] A conductor test asserts the missing-repair-task fault and the unreadable-case-store fault each halt `needs-human`
- [ ] A conductor test asserts an oversize remaining dimension, an unreadable ledger, and a snapshot write failure each halt `mechanical`
- [ ] A test asserts no projection fault carrying an actual and a limit is ever classed `needs-human`

## Story 5: The remediate skill directs how the history files are read

**Requirement:** review decision 4a

As the remediation agent, I want clear direction on which history file to read and when so that I judge from complete active history and consult resolved history only when needed.

### Acceptance Criteria

#### Happy Path
- Given a `gap-plan` dispatch, when the remediate skill's gap-plan instructions are followed, then the skill directs the agent to read the active history file named in the index in full before judging any finding.
- Given a current finding that may be a recurrence of a resolved case, when the remediate skill's gap-plan instructions are followed, then the skill directs the agent to read the resolved history file before choosing that finding's reconciliation relation.
- Given a prior-case source without a summary, when the remediate skill's gap-plan instructions are followed, then the skill directs the agent to read that text from the pending finding with the same finding id in the active history file.

#### Negative Paths
- Given a `gap-plan` dispatch in which no current finding may be a recurrence of a resolved case, when the remediate skill's gap-plan instructions are followed, then the skill directs the agent not to read the resolved history file.
- Given a history file named in the index that is missing or unreadable to the agent, when the remediate skill's gap-plan instructions are followed, then the skill directs the agent to return a `halt` disposition naming the unreadable file instead of judging from the index alone.
- Given a `build_review` case context or a PRD-widening reconciliation context, when the remediate skill is followed, then the skill directs the agent to those modes' existing inputs and not to any remediation history file.

### Done When
- [ ] `skills/remediate/SKILL.md` gap-plan instructions name the active history file as required reading and the resolved history file as conditional on a possible recurrence
- [ ] The skill's instruction for a source without a summary points at the active history file's pending findings
- [ ] The skill's instructions for `build_review` case contexts and PRD-widening reconciliation are unchanged
- [ ] The harness integrity check for the `remediate` skill passes

## Story 6: Plan validation does not depend on what the agent read

**Requirement:** review decision 7; conditions 2, 3

As an operator, I want the engine to validate the returned plan against its own copy of the history so that an agent that skips or misreads a file cannot pass an incomplete plan.

### Acceptance Criteria

#### Happy Path
- Given a returned plan that names a prior case held only in the resolved history file as a `recurrence`, when the plan is validated, then the prior case id is accepted and its repair-task binding is checked as it is today.
- Given a returned plan that accounts for every pending as-built finding, when the plan is validated, then it is accepted exactly as it is today.

#### Negative Paths
- Given a returned plan that leaves a pending as-built finding without a disposition, when the plan is validated, then it is rejected naming that finding and the existing bounded remediate retry applies.
- Given a returned plan that names a prior case id that is in neither history file, when the plan is validated, then it is rejected naming that case id.
- Given a history file changed or deleted on disk after dispatch, when the returned plan is validated, then the validation result is the same as with the file intact.

### Done When
- [ ] A validation test asserts a `recurrence` bound to an archived resolved case is accepted
- [ ] A validation test asserts an unaccounted pending finding is rejected naming the finding
- [ ] A step-runner test asserts validation gives the same result after the history files are altered or removed
