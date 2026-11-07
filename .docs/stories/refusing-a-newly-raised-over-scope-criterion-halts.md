**Status:** Accepted

# Stories: Every rendered over-scope criterion can be decided, and a rejected entry names its own recovery (#3548)

Technical track; no PRD. Acceptance criteria derive from issue #3548's desired outcomes, the operator-confirmed
scope in `.docs/track/refusing-a-newly-raised-over-scope-criterion-halts.md`, and
`adr-2026-09-07-durable-prd-widening-decision-reconciliation` D1, D3 and D4 as amended by #3548.

Terms used below:
- A "cleared block" is the fenced `over-scope-decisions` JSON array in `.pipeline/HALT.cleared` that the next PRD-audit lap captures.
- A "story criterion" is a story-numbered criterion such as `S3.17`. An "NC criterion" is a no-owner ordinal such as `NC-2`.
- An "offer reference" is the `offerEntryId`, `originalCaseId` and `originalSource` fields the engine renders for an entry backed by a persisted offer in `.pipeline/remediation-cases.json`.
- "Well-formed history" means `.pipeline/accepted-widenings.json` and `.pipeline/remediation-cases.json` both read and validate.

## Story 1: A story-criterion decision is recorded even when the block also holds offer-backed NC entries

As an operator answering an over-scope halt, I want my accept or refuse on a newly raised story criterion recorded on the next lap even when the same halt also carries a previously offered NC criterion, so that I can answer every criterion the halt shows me in one clear.

### Acceptance Criteria

#### Happy Path
- Given a persisted `.pipeline/prd-audit.json` verdict grading `S3.17` and `NC-2` as outside-visible OVER_SCOPE, and a cleared block holding `S3.17` with `decision: "refuse"`, a rationale and no offer reference, and `NC-2` with `decision: "accept"`, a rationale and an offer reference matching its persisted offer, when the next PRD-audit lap captures the block with a resolved machine owner, then both decisions are appended to `accepted-widenings.json` and one `prd_widening_reconciled` event with `outcome: "imported"` is emitted for each.
- Given that capture succeeded, when the same lap routes the over-scope findings, then `S3.17` is classified refused by criterion name and `NC-2` is classified accepted, and no capture-recovery halt is written.
- Given a persisted verdict grading `S4.2` as outside-visible OVER_SCOPE and a cleared block holding `S4.2` with `decision: "accept"` and no offer reference beside an offer-backed `NC-1` entry left pending, when the next lap captures it, then the `S4.2` decision is recorded and `S4.2` no longer blocks the PRD-audit gate.

#### Negative Paths
- Given the same mixed block where the `S3.17` entry has an empty rationale, when capture runs, then no decision is recorded for `S3.17`, the `NC-2` decision is still recorded, and the halt names `S3.17` with a missing-rationale reason rather than `malformed-history`.
- Given a mixed block where the operator deleted the offer reference from the `NC-2` entry, when capture runs, then no decision is recorded for `NC-2`, the `S3.17` decision is still recorded, and the halt names `NC-2` with a changed-offer-reference reason.
- Given the same decided mixed block captured once, when an identical `HALT.cleared` is captured again on a later lap, then `accepted-widenings.json` still holds exactly one decision for `S3.17` and one for `NC-2`.
- Given a mixed block with a decided `S3.17` entry and no resolvable machine owner, when capture runs, then no decision is recorded for any entry and the halt names `S3.17` with the missing-operator reason.
- Given a cleared block, mixed or story-only, with a decided offerless entry for `S9.9` that is not an outside-visible OVER_SCOPE finding in the persisted `.pipeline/prd-audit.json` verdict, when capture runs, then nothing is recorded for `S9.9`, the halt names `S9.9` as a criterion the halt never offered, and every valid sibling decision is still recorded.
- Given a cleared block with a decided offerless `S3.17` entry and a `.pipeline/prd-audit.json` that is absent or unreadable, when capture runs, then nothing is recorded for `S3.17`, and the halt names `S3.17` with a recovery that says to leave the entry pending so the next audit offers it again.

### Done When
- [ ] A capture test with a decided offerless story entry beside a matching offer-backed NC entry asserts two appended decisions and two `imported` events.
- [ ] A routing test asserts the captured story decision classifies the story criterion as refused, or as accepted, by criterion name.
- [ ] Capture tests assert that one rejected entry (missing rationale, or a stripped NC offer reference) never prevents its sibling's decision from being recorded.
- [ ] A replay test asserts the second capture of an identical cleared block appends no duplicate decision.
- [ ] Capture tests assert an offerless story entry whose criterion is not an outside-visible OVER_SCOPE finding in the persisted verdict, or whose verdict is absent or unreadable, records nothing and names its criterion, while siblings are recorded.

## Story 2: An entry left pending is inert in every block shape

As an operator, I want to decide only some of the criteria in a halt and leave the rest pending, so that a partial answer records what I decided instead of rejecting the whole block.

### Acceptance Criteria

#### Happy Path
- Given a persisted verdict grading `S1.2` and `S1.3` as outside-visible OVER_SCOPE and a cleared block of only story criteria with `S1.2` decided `refuse` with a rationale and `S1.3` left `pending`, when capture runs, then a decision is recorded for `S1.2`, none is recorded for `S1.3`, and the next over-scope halt renders `S1.3` again as pending.
- Given a cleared block of only story criteria where every entry is decided, none carries an offer reference, and every criterion is an outside-visible OVER_SCOPE finding in the persisted verdict, when capture runs, then each decision is recorded with the same criterion-and-summary provenance the existing legacy import records.

#### Negative Paths
- Given a cleared block whose entries are all `pending`, mixing offer-backed NC entries and offerless story entries, when capture runs, then no decision is recorded and no capture defect is reported.
- Given a `HALT.cleared` in a retired format (a single-line `OVER_SCOPE_ACCEPT:` marker, or a fenced block that is not a JSON array), when capture runs, then nothing is recorded and the halt reports the `unsupported-history` reason.
- Given a cleared block of only story criteria with a pending entry, when capture runs, then the halt never reports `unsupported-history` and never tells the operator to upgrade the conductor.

### Done When
- [ ] A capture test asserts a pure story block with one decided and one pending entry records exactly one decision and no defect.
- [ ] A capture test asserts an all-pending mixed block records nothing and reports no defect.
- [ ] The existing legacy-import and retired-format capture tests still pass unchanged.

## Story 3: A rejected cleared-block entry halts with its own reason, its criterion and a recovery that fits

As an operator whose cleared decision was rejected, I want the halt to name what was wrong, which criterion it was, and how to fix that entry, so that I do not restore history files that were never damaged.

### Acceptance Criteria

#### Happy Path
- Given a cleared entry for `NC-2` whose offer reference does not match its persisted offer, when capture rejects it, then the halt names the changed-offer-reference reason and `NC-2`, and its recovery tells the operator to correct that entry against the latest halt or leave its decision pending before clearing again.
- Given a cleared entry for `S3.17` with an empty rationale, when capture rejects it, then the halt names `S3.17` and a recovery that asks for a rationale on that entry.
- Given two entries for the same offer, when capture rejects the second, then the halt names the duplicated entry's criterion and a recovery that asks the operator to keep one entry per criterion.
- Given a cleared block whose fenced JSON does not parse, when capture rejects it, then the halt names an unreadable decision block and a recovery that asks the operator to repair the block's JSON before clearing again.
- Given one entry rejected for a changed offer reference and another rejected for a missing rationale, when the halt is written, then it names both reasons, each with its own criterion and recovery.
- Given any rejected entry whose criterion is readable, when capture emits the rejection event, then that event's `sourceId` is the criterion instead of `prd-audit:entry`.

#### Negative Paths
- Given well-formed history and any rejected cleared-block entry, when the halt is written, then it never reports `malformed-history` and never tells the operator to restore widening history from a known-good copy.
- Given a rejected entry whose criterion is readable, when the halt is written, then it never says "affected no specific record".
- Given a cleared array element that is not a JSON object, when capture rejects it, then the halt names an unreadable decision entry, not `malformed-history`, and every readable sibling entry is still captured.
- Given a capture defect kind with no recovery reason assigned to it, when the engine is compiled, then the build fails rather than falling back to a default reason.

### Done When
- [ ] Each capture defect kind (`malformed-block`, `malformed-entry`, `changed-offer-reference`, `duplicate-offer-entry`, `invalid-decision`, `missing-rationale`, `missing-operator`, `offer-read-failed`, `write-failed`, `unsupported-legacy-clear`, and the new kinds for a criterion the halt never offered and for an unreadable offered set) has an assigned recovery reason, and a test asserts none of them yields `malformed-history`.
- [ ] A conductor-level test asserts the S3.17/NC-2 reproduction from #3548 with a bad `S3.17` entry halts naming `S3.17` and a non-`malformed-history` reason.
- [ ] A test asserts a halt with two defect kinds renders both reasons with their criteria.

## Story 4: Genuinely malformed widening history still halts as malformed-history

As an operator, I want a widening history that really is corrupt to keep halting with the restore-history recovery, so that the fix for cleared-block defects never hides real corruption.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/accepted-widenings.json` that is not valid JSON and a `HALT.cleared` with a valid decided entry, when the next PRD-audit lap enters, then no decision is recorded and the halt reports `malformed-history` naming `.pipeline/accepted-widenings.json` and `.pipeline/remediation-cases.json`.

#### Negative Paths
- Given `.pipeline/accepted-widenings.json` declaring an unknown version, when the lap enters, then the halt reports `unsupported-history`, not `malformed-history`, and the file is left byte-for-byte unchanged.
- Given `.pipeline/accepted-widenings.json` whose feature identity names a different feature, when the lap enters, then the halt reports the `foreign-feature` reason, not `malformed-history`, and the file is left byte-for-byte unchanged.
- Given a decision or case write that fails while migrating stored history, when the lap enters, then the halt reports `persistence-failed`, not `malformed-history`.
- Given well-formed history and a cleared block that mixes a rejected entry with a valid one, when the lap enters, then the valid decision is recorded and the existing history files are not rewritten except by that append.

### Done When
- [ ] A conductor-level test with corrupt `accepted-widenings.json` asserts a `malformed-history` halt and no appended decision.
- [ ] Every stored-history migration failure reason has an assigned recovery reason, and a test asserts only `corrupt-history` yields `malformed-history`.
- [ ] Conductor-level tests assert an unknown store version halts `unsupported-history` and a foreign-feature store halts `foreign-feature`, each leaving the file unchanged.
