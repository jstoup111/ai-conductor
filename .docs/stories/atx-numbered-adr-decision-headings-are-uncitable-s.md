**Status:** Accepted

# Stories: ATX-numbered ADR decision headings are citable

Source: jstoup111/ai-conductor#2390. Track: technical (no PRD). Tier: S.

An ADR may head its decisions `### 1. Title`, `### 2. Title`, and so on. Approved
adr-2026-09-02-adr-decision-citability-contract decision 2 lists ATX `###`-heading decisions among the
accepted citable shapes, but the shared decision parser recognizes only the `D`-prefixed heading, so
every decision headed by a bare number is uncitable. Such an ADR cannot be amended (the land
citability rung refuses it), carried in an obligation table, or cited by an as-built finding. These
stories make the bare-number ATX heading citable without disturbing any shape that is citable today.

## Story 1: The decision parser yields ATX-numbered headings as citable decision ids

**Requirement:** #2390 desired outcomes 1, 4

As a DECIDE author, I want an ADR whose decisions are headed `### <n>. <title>` to yield those numbers
as decision ids, so that its decisions can be cited exactly like decisions in every other accepted shape.

### Acceptance Criteria

#### Happy Path
- Given an ADR whose `## Decision` section heads its decisions `### 1. First`, `### 2. Second`, and `### 3. Third`, when the decision parser reads it, then it returns the decision ids 1, 2, and 3, and the passage recorded for id 2 begins with the `### 2. Second` heading line.
- Given an ADR whose `## Decision` section contains the heading `### **4. Termination.**`, when the decision parser reads it, then it returns decision id 4.
- Given the APPROVED ADRs in the repository's ADR corpus, when the corpus compatibility guard runs, then every number that opens an ATX heading in an ADR's `## Decision` section is one of that ADR's citable decision ids, and every id the pre-change parser returned for each ADR is still returned.

#### Negative Paths
- Given an ADR whose `## Decision` section contains only the heading `### 12. Twelfth`, when the decision parser reads it, then the returned ids are exactly 12, never 1 or 2.
- Given an ADR whose `## Decision` section contains only the headings `### 2.1 Sub-point` and `### Step 1. Prepare`, when the decision parser reads it, then it returns no decision id.
- Given an ADR whose only `### 5. Fifth` headings sit inside a fenced code block in the `## Decision` section or under a later `## Consequences` section, when the decision parser reads it, then it returns no decision id 5.

### Done When
- [ ] `artifacts.test.ts` asserts the ids and the id-2 passage start for a three-heading ATX-numbered ADR, and id 4 for the emphasized heading.
- [ ] `artifacts.test.ts` asserts the `### 12.`, `### 2.1`, `### Step 1.`, fenced, and out-of-section cases return no wrong id.
- [ ] `adr-decision-corpus.test.ts`'s numbered-decision guard counts ATX-numbered headings and passes over the real corpus, and its frozen-predicate guard still passes.

## Story 2: An ADR headed by ATX numbers can be amended and landed with an obligation row per decision

**Requirement:** #2390 desired outcome 2

As a DECIDE author amending an APPROVED ADR whose decisions are headed `### <n>. <title>`, I want the
spec to land without renaming those headings, and its obligation table to require exactly one row
per heading, so that the ADR that actually governs a subsystem can be the one that is amended.

### Acceptance Criteria

#### Happy Path
- Given a spec worktree whose diff modifies an existing APPROVED ADR whose decisions are headed `### 1. First` through `### 3. Third`, with no heading renamed, when the spec is landed, then the land gate does not refuse the ADR as uncitable and the land completes, returning the spec's slug.
- Given a Medium-tier spec whose diff adds an APPROVED ADR whose decisions are headed `### 1. First` and `### 2. Second`, and whose plan's Architecture Obligation Coverage table has one valid row each for `<adr-stem>#D1` and `<adr-stem>#D2`, when the spec is landed, then the coherence gate accepts the obligation coverage and the land completes.

#### Negative Paths
- Given the same Medium-tier spec with the `<adr-stem>#D2` row removed from the Architecture Obligation Coverage table, when the spec is landed, then the land is refused with an error naming `<adr-stem>#D2 (missing)`.
- Given a spec worktree whose diff modifies an APPROVED ADR whose `## Decision` section has only prose under an unnumbered `### Approach` heading, when the spec is landed, then the land is refused with the "no citable decision" error naming that ADR file.

### Done When
- [ ] `land-spec.test.ts` asserts `landSpec` resolves for a modified ATX-numbered ADR and rejects the unnumbered-heading ADR with "no citable decision" naming the file.
- [ ] A `landSpec` test over a Medium-tier coherent chain asserts the two-row table lands and the table without the `#D2` row is refused naming `#D2 (missing)`.

## Story 3: An as-built finding can cite an ATX-numbered decision and the projection carries its text

**Requirement:** #2390 desired outcome 3

As the as-built reviewer, I want a finding that cites `adr-<stem>` decision `<n>` against an ADR
headed `### <n>. <title>` to resolve, and the projected governing decision to carry that heading's own
text, so that I can hold shipped code to the decision that actually governs it.

### Acceptance Criteria

#### Happy Path
- Given an APPROVED ADR whose decisions are headed `### 1.` through `### 4.`, when an as-built BLOCKED verdict carries a REMEDIABLE finding whose governing reference is that ADR's decision 4, then as-built reference resolution accepts the verdict unchanged.
- Given a plan that cites that ADR, when the as-built projection is built, then the ADR's projected governing decisions are ids 1, 2, 3, and 4, and decision 2's text is its heading title and body without the `### 2. ` prefix and without any text of decision 3.

#### Negative Paths
- Given the same ADR, when an as-built finding cites its decision 9, then resolution rejects the verdict at field `findings[0].reference.decision` with the requirement naming declared decision ids `1, 2, 3, 4`.
- Given an APPROVED ADR that heads decision 1 `### 1. First` and later carries a decision index line `**D1** — First summary.`, when the as-built projection is built, then decision 1 is projected once and its text is the `### 1.` heading's title and body, not the index summary.

### Done When
- [ ] `as-built-contract.test.ts` asserts decision 4 resolves and decision 9 is rejected naming ids `1, 2, 3, 4` for an ATX-numbered ADR.
- [ ] `as-built-projection.test.ts` asserts the projected ids 1-4, decision 2's prefix-free text bounded before decision 3, and the single heading-sourced decision 1 when an index line follows.
