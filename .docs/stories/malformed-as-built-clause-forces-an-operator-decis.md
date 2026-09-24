**Status:** Accepted

# Stories: malformed-as-built-clause-forces-an-operator-decis

Technical track (no PRD). Source: issue jstoup111/ai-conductor#2424. Tier S. Scope boundary: an
as-built governing reference names a whole ADR decision, and a sub-decision is cited as its parent
decision, mirroring the ADR parser's existing collapse of dotted headings; the architecture-review
skill states that rule as judgement guidance. No new halt class, no as-built mechanical-fault
allowance, no change to DESIGN or unknown-ADR handling.

## Story 1: A dotted decision cite resolves to its whole ADR decision

As the SHIP as-built remediation route, I want a REMEDIABLE finding that governs a decision
subsection (`D5.2`) to be cited and resolved as decision 5 so that a reviewer output variance does
not become a needs-human halt on work the approved ADR already requires.

### Acceptance Criteria

#### Happy Path
- Given an APPROVED ADR `adr-x` whose `## Decision` section declares decision 5 with a sub-decision written `D5.2`, when a REMEDIABLE finding governed by that sub-decision carries the reference `{kind: "adr-decision", stem: "adr-x", decision: 5}`, then validation resolves it to decision 5 and the finding enters the bounded remediation route against decision 5
- Given the same ADR, when the as-built projection lists its decisions, then decision 5 appears as the whole-number decision id that a reference cites for any of its sub-decisions
- Given the same ADR, when a REMEDIABLE finding references decision 5 directly, then it resolves to decision 5 exactly as a sub-decision cite does

#### Negative Paths
- Given an APPROVED ADR `adr-x` that declares decisions 1 through 4 only, when a REMEDIABLE finding references `adr-x` decision 9, then the structured result is rejected naming the finding's `reference.decision` field and listing the declared decision ids, the attempt is scored `absent` and reruns, and on exhaustion the step halts needs-human naming the as-built step and that field
- Given an APPROVED ADR `adr-x` that declares decision 5, when a REMEDIABLE finding gives `decision` as a non-number such as `"5.2"` or `"5.a"`, then the structured result is rejected naming the finding's `reference.decision` field and stating that a whole-number decision id is required, and the attempt is scored `absent` and reruns
- Given an ADR `adr-x` whose status is DRAFT, when a REMEDIABLE finding references `adr-x` decision 5, then the structured result is rejected naming the finding's `reference.stem` field and the ADR's status
- Given an active plan containing task `5.2`, when a REMEDIABLE finding carries the reference `{kind: "plan-task", taskId: "5.2"}`, then it resolves as the plan task `5.2` and never as an ADR decision

### Done When
- [ ] A contract test asserts an ADR reference to decision 5 resolves against an APPROVED ADR declaring decision 5 with a `D5.2` sub-decision, and the finding enters the remediation route against decision 5
- [ ] A contract test asserts that decision 9 against an ADR without decision 9, a non-number decision, and a DRAFT ADR are each rejected with a field-named diagnostic, and that plan-task `5.2` still resolves as a plan task
- [ ] A test through the dispatch path asserts a rejected reference scores `absent`, reruns, and halts needs-human naming the field on exhaustion

## Story 2: The as-built review contract states the whole-decision cite rule

As the architecture-review skill, I want the as-built section to say that a governing reference
names a whole ADR decision and that a sub-decision is cited as its parent decision so that reviewers
cite the resolvable decision and know what a sub-decision cite means.

### Acceptance Criteria

#### Happy Path
- Given a reviewer reading the as-built section of `skills/architecture-review/SKILL.md`, when they reach the guidance on governing references, then the text states as judgement guidance that a reference names a whole ADR decision and that a sub-decision such as `D3.2` is cited as decision 3, with no clause grammar or cell-formatting rule

#### Negative Paths
- Given the skill validation suite (`test/test_harness_integrity.sh` skill checks), when the amended SKILL.md is checked, then the suite passes with no new failure attributable to the amended section and the as-built format audit finds no governing-clause grammar

### Done When
- [ ] `skills/architecture-review/SKILL.md`'s as-built section carries the whole-decision rule and the sub-decision-cites-parent rule in bare prose as judgement guidance
- [ ] `test/test_harness_integrity.sh` passes on the changed skill file
