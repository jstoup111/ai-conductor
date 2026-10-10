**Status:** Accepted

# Stories: Amendment notes in common header forms are invisible to coverage_binding

Source: jstoup111/ai-conductor#2982. Track: technical (no PRD). Tier: S.

`coverage_binding` turns each amendment note that a feature branch adds to its DECIDE set's specs,
ADRs, and architecture reviews into an amendment claim, so the judge can confirm the plan carries
it. Today only one exact header form is read. A note in any other form never becomes a claim and
is skipped silently. These stories make every amendment-note form already in use become a claim.
Fenced examples and blockquotes that are not amendment notes still never become one.

## Story 1: Every amendment-note header form in use becomes an amendment claim

**Requirement:** #2982 desired outcomes 1, 2, 3

As an operator relying on `coverage_binding`, I want an amendment note to become a claim whatever
header form its author used, so that a plan cannot drop an amended obligation without a refusal.

### Acceptance Criteria

#### Happy Path
- Given an ADR whose branch text adds a blockquoted note headed `**Amended 2026-07-06 (#353, adr-2026-07-06-example-fixture):**`, when amendment claims are assembled, then exactly one claim is produced carrying that ADR's path and the note's full text, header line through its last quoted line.
- Given branch-added blockquoted notes headed with `by #N (qualifier):`, `by` followed by a backticked ADR stem and `(APPROVED) and` with the header wrapped onto the next quoted line, a bold span that closes right after the date (`**Amended 2026-07-03** by …`), `by operator decision (…)`, `during conflict-check:`, `by PR #N:`, and `by owner/repo#N (…)`, when amendment claims are assembled, then each note produces exactly one claim whose text is that whole note.
- Given a branch-added amendment blockquote indented under a list item, whose header and continuation lines each begin with spaces before `>`, when amendment claims are assembled, then one claim is produced whose text includes every indented continuation line.
- Given a branch-added unquoted line beginning `**Amended 2026-08-21 (operator).**` followed by continuation lines and then a blank line, when amendment claims are assembled, then one claim is produced whose text is that line through the last line before the blank line, and nothing after it.
- Given two branch-added amendment headers on consecutive lines of one blockquote, when amendment claims are assembled, then two claims are produced, each starting at its own header.
- Given a branch-added note in the canonical `**Amended 2026-09-24 by #100:**` form with a continuation line, when amendment claims are assembled, then its claim text is identical to the text produced before this change.

#### Negative Paths
- Given a blockquote whose first line begins `**Amendment items 8 and 9`, or a quoted line where `**Amended` appears after other text on that line, when amendment claims are assembled, then neither produces a claim.
- Given an amendment-shaped line with a real date inside a fenced code block delimited by backticks or by tildes, when amendment claims are assembled, then it produces no claim.
- Given a non-canonical amendment note that is byte-identical in the artifact's merge-base text, when amendment claims are assembled, then it produces no claim, while a different non-canonical note added beside it on the branch still produces one.
- Given a non-canonical amendment note in the plan itself, when amendment claims are assembled, then it produces no claim, because D18 excludes the plan's own amendments.

### Done When
- [ ] `assembleAmendmentClaims` returns one claim per branch-added note for each listed header form, with the note's full text and artifact path.
- [ ] Fenced examples, `Amendment`-led quotes, mid-line `Amended`, inherited notes, and plan notes yield no claim.

## Story 2: The coverage_binding step judges a branch-added non-canonical amendment note

**Requirement:** #2982 desired outcome 2

As an operator, I want the `coverage_binding` step itself to send a non-canonical amendment note
to the judge and refuse when the plan does not carry it, so that the amendment check is never
skipped silently.

### Acceptance Criteria

#### Happy Path
- Given a feature branch whose architecture-review artifact, absent at the merge base, contains only an amendment note headed `**Amended 2026-10-09 (operator decision):**`, with the judge enabled and returning `not-carried` with a missing obligation, when the `coverage_binding` step runs, then it refuses `needs-human` and its output names the artifact path, the note's text, and the missing obligation.
- Given the same branch with the judge disabled, when the `coverage_binding` step runs, then it completes without invoking the provider, its envelope records one `amendment` entry with verdict `unjudged`, and one `coverage_binding_amendment_judged` event with verdict `unjudged` is emitted.

#### Negative Paths
- Given a feature branch whose architecture-review artifact contains an amendment-shaped line only inside a fenced code block, with the judge enabled, when the `coverage_binding` step runs, then the envelope records no `amendment` entry and no `coverage_binding_amendment_judged` event is emitted.

### Done When
- [ ] A step-runner test shows a non-canonical branch amendment reaching the judge and refusing `needs-human` on `not-carried`, and recorded `unjudged` with the judge off.
- [ ] A step-runner test shows a fenced example yields no amendment entry or event.
