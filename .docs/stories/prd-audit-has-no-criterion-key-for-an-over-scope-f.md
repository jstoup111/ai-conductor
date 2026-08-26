**Status:** Accepted

# Stories: PRD-audit no-owner OVER_SCOPE findings

Technical track — derived from issue jstoup111/ai-conductor#1848, the 2026-08-25
architecture review, and the amended ADRs
`adr-2026-08-24-over-scope-decision-block-and-durable-refusals` (D4) and
`adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` (D3).

## Story 1: The no-owner findings section parses

As the conductor, I want `parsePrdAuditReport` to read the report's
`## Findings without an owning criterion` section so that an audit reporting an unplanned
change with no owning story criterion is parseable on the first attempt.

### Acceptance Criteria

#### Happy Path
- Given a report with a valid Verdict Table and a no-owner section whose `Finding`-headed table has one row keyed NC.1 graded OVER_SCOPE with relation outside-visible and evidence text, when the report is parsed, then the parse succeeds and the result contains the NC.1 finding with its grade, intent relation, and evidence alongside the Verdict Table findings
- Given a report whose no-owner section contains two rows keyed NC.1 and NC.2, when the report is parsed, then both findings are returned and each is distinguishable by its key

#### Negative Paths
- Given a no-owner section row graded PASS instead of OVER_SCOPE, when the report is parsed, then that row is rejected with a named diagnostic stating the section admits only OVER_SCOPE and sibling rows are still returned
- Given a Verdict Table row keyed NC.1 (an NC key outside the no-owner section), when the report is parsed, then that row is rejected with a named diagnostic and sibling rows are still returned
- Given a well-formed report (every row keyed by a valid, unique story criterion) with no `## Findings without an owning criterion` section, when the report is parsed, then parsing behaves exactly as before this change and returns only Verdict Table findings

### Done When
- [ ] A fixture report containing the exact section shape taught by `skills/prd-audit/SKILL.md` parses with the NC finding present in the result
- [ ] A fixture without the section produces a parse result identical in shape and content to today's parser output for the same input
- [ ] The parse result type exposes NC findings distinguishably from criterion findings

## Story 2: Duplicate keys reject per-row

As the conductor, I want rows carrying a duplicated key rejected individually so that no two
findings in a parseable report share an identity and recording a decision about one can never
match another.

### Acceptance Criteria

#### Happy Path
- Given a report where every Verdict Table criterion and every NC ordinal appears exactly once, when the report is parsed, then no duplicate-key diagnostics are produced

#### Negative Paths
- Given a Verdict Table with two rows keyed S1.3 (one PASS, one OVER_SCOPE), when the report is parsed, then both S1.3 rows are rejected with a diagnostic naming S1.3 as duplicated and all other rows are still returned
- Given a no-owner section with two rows keyed NC.1, when the report is parsed, then both NC.1 rows are rejected with a diagnostic naming NC.1 as duplicated and all other rows are still returned

### Done When
- [ ] A fixture reproducing issue #1848 case (2) — S1.3 and S4.1 each graded both PASS and OVER_SCOPE — parses with those four rows rejected, the duplicates named, and the remaining rows consumed
- [ ] No parse result ever contains two findings with the same key

## Story 3: Rejected rows are salvaged as diagnostics and still block

As the operator, I want a report whose only defect is some unrecognized or duplicated rows to
keep its correctly-parsed findings, while the rejected rows visibly block, so that one bad row
no longer costs the whole audit but can never be silently dropped.

### Acceptance Criteria

#### Happy Path
- Given a 57-row report where two rows carry invented keys (OS.1, OS.2) as in issue #1848 case (1), when the report is parsed, then the 55 valid rows are returned as findings and the two rejected rows are returned as diagnostics carrying the row's key text and the rejection reason

#### Negative Paths
- Given a parse result containing one or more rejected-row diagnostics, when the prd_audit gate evaluates the report, then the gate does not pass and the resulting halt body names each rejected row and its reason
- Given a parse result with rejected rows and all parsed findings graded PASS, when the prd_audit gate evaluates the report, then the gate still does not pass — salvage never converts a rejected row into a passing report
- Given a report missing its `**PRD:**` marker or missing the Verdict Table entirely, when the report is parsed, then the whole report is still a mechanical fault exactly as today, not a per-row rejection

### Done When
- [ ] A fixture with mixed valid and invalid rows produces both the salvaged findings and the named diagnostics from one parse call
- [ ] A gate-level test proves a report with any rejected row cannot satisfy the prd_audit gate, and the halt/blocking reason text contains each rejected row's key text and reason
- [ ] Report-level fault fixtures (no PRD marker, no table) still return the whole-report mechanical-fault result

## Story 4: NC decisions bind key and summary; mismatch re-asks

As the operator, I want my accept/refuse decision on a no-owner finding to apply on a later
audit lap only when both its key and its summary match the re-reported finding, so that a
decision I recorded never silently applies to a different finding.

### Acceptance Criteria

#### Happy Path
- Given an accepted decision recorded for NC.1 with summary "unplanned npm test change", when a later lap's report lists NC.1 with the identical summary and relation outside-visible, then the finding classifies as accepted and does not block
- Given a criterion-keyed decision for S4.1, when a later lap re-reports S4.1 OVER_SCOPE with different summary wording, then the decision still applies (criterion-only matching for story-criterion keys is unchanged)

#### Negative Paths
- Given an accepted decision recorded for NC.1 with summary "unplanned npm test change", when a later lap's report lists the same substance renumbered as NC.2, then the finding classifies as blocking-undecided and the halt offers a fresh decision entry for it
- Given an accepted decision recorded for NC.1, when a later lap's report lists NC.1 with a reworded summary, then the finding classifies as blocking-undecided and the operator is re-asked — the recorded decision is never applied to the mismatched finding
- Given a `HALT.cleared` decision entry naming a key the current report does not flag, when decisions are harvested, then nothing is recorded for that entry and the defect is surfaced by name (existing D7 behavior over the widened key space)

### Done When
- [ ] `accepted-widenings.json` entries for NC keys carry the summary they bind to, and the matcher requires both fields for NC entries while criterion entries keep criterion-only matching
- [ ] Tests cover apply-on-match, re-ask-on-renumber, and re-ask-on-reword for NC entries
- [ ] Last-decision-wins holds per matched identity for NC entries as it does for criteria

## Story 5: No-owner findings route uniformly and never become work

As the conductor, I want NC findings to flow through the same relation, classification,
decision-block, and recording machinery as criterion findings so that an outside-visible
unplanned change is decided by the operator and any other unplanned change is recorded
without blocking.

### Acceptance Criteria

#### Happy Path
- Given a parsed NC.1 finding with intent relation outside-visible and no recorded decision, when the prd_audit gate evaluates the report, then the halt's over-scope-decisions block contains an entry for NC.1 with its summary and relation, pending decision
- Given a parsed NC.1 finding with relation within or outside-harmless, when the prd_audit gate evaluates the report, then NC.1 is recorded and does not block

#### Negative Paths
- Given a refused decision for NC.1, when the next lap re-reports NC.1 with matching summary, then the halt names NC.1 as refused — rework required, and does not re-offer a pending entry for it
- Given a parsed NC finding of any relation, when routing computes follow-up work, then no plan task is appended and no kickback names the NC finding as work — it routes only to the operator decision block

### Done When
- [ ] `overScopeRelations` and `classifyOverScopeCriterion` accept NC keys with unchanged semantics for criterion keys
- [ ] An end-to-end fixture drives report → parse → gate → halt block → cleared decision → recorded → next-lap non-blocking for an NC finding
- [ ] No code path appends plan tasks or emits kickback work for an NC finding

## Story 6: The skill-taught shape and the parser-accepted shape are the same shape

As a spec author, I want the prd-audit skill's documented section format and the parser's
accepted grammar proven identical by fixture so that an audit written by following the skill
parses on the first attempt.

### Acceptance Criteria

#### Happy Path
- Given the section format exactly as documented in `skills/prd-audit/SKILL.md` (including its NC key contract added in this change), when a report following it verbatim is parsed, then it parses with zero rejected rows
- Given the skill text after this change, when it is read, then it teaches the NC.«n» key form and no longer claims the engine cannot route no-owner findings

#### Negative Paths
- Given a report following the OLD skill guidance (the section present but rows without NC keys), when the report is parsed, then those rows are rejected with diagnostics naming the missing/invalid key — not a whole-report mechanical fault

### Done When
- [ ] A fixture is generated from (or byte-verified against) the SKILL.md example and parses clean
- [ ] `skills/prd-audit/SKILL.md` documents the NC key contract, and its "engine cannot route those findings today (#1848)" caveat is removed in the same diff as the parser change
- [ ] Harness validation (`test/test_harness_integrity.sh`) passes with the skill edit
