**Status:** Accepted

# Stories: Simplify evaluator model routing to a two-way risk switch (#193)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the evaluator's model-routing criterion in the typed model-table metadata, the generated table row, its hand-synced reference mirror, and the shipped `/code-review` evaluator dispatch guidance, which is the only place the evaluator is dispatched. Evaluator fresh-context isolation and the domain-reviewer diff-size routing remain outside this slice.

## Story 1: One risk criterion decides the evaluator's model

As a harness operator dispatching the `/code-review` evaluator, I want a single risk-domain question instead of a two-sided content taxonomy so that a misclassification cannot quietly seat a weaker reviewer on a dangerous diff.

### Acceptance Criteria

#### Happy Path

- Given the typed model-table metadata, when the evaluator row is read, then its Claude cell states one default model plus one risk-domain criterion naming concurrency, state mutation, security, auth, and money, and names no other selection category.
- Given the evaluator row states the two-way switch, when the model-selection table is regenerated from that metadata, then the committed generated region in the harness rules file carries the same cell with no hand edit.

#### Negative Paths

- Given the evaluator row still names any retired selection category such as value objects, pure functions, config, infra, view templates, or complex domain interactions, when the metadata specification runs, then it fails and names the retired category.
- Given the generated model-selection region is edited by hand instead of regenerated from the metadata, when the generator drift check runs, then it exits non-zero and reports the differing row.

### Done When

- [ ] The evaluator metadata row exposes exactly one default model and one risk-domain criterion, and carries no retired selection category.
- [ ] The generator drift check exits zero against the committed generated region, and the reference model table's evaluator cell matches that region verbatim.
- [ ] The evaluator row keeps its supported-host interactive execution path and its unchanged Codex model and effort inheritance placeholders.

## Story 2: Shipped dispatch guidance states the same single criterion

As an implementer following the shipped review guidance, I want the dispatch instructions to state the same one criterion the model table does so that guidance and table cannot disagree about which model reviews a risky diff.

### Acceptance Criteria

#### Happy Path

- Given the code-review dispatch guidance, when its evaluator model selection is read, then it offers exactly two choices, a default and a risk-domain top tier, using the same five risk domains as the metadata row.
- Given the model table's evaluator row, when its rationale is read, then it attributes the evaluator's model to the `/code-review` dispatch alone.

#### Negative Paths

- Given a dispatch line names a Claude model parameter without naming Claude on that same line, when the provider skill contract audit runs, then it rejects the file as unscoped Claude model selection.
- Given the code-review dispatch guidance drops or reworks the fresh-context isolation statement, when the guidance specification runs, then it fails.
- Given the `/pipeline` batch-boundary guidance, when the evaluator routing specification reads it, then it requires no evaluator scaling table and no risk-domain evaluator override there.

### Done When

- [ ] The code-review dispatch guidance names one default model choice and one risk-domain top-tier choice, and no retired content category.
- [ ] The evaluator routing specification asserts the code-review routing and its provider scoping and holds no `/pipeline` evaluator scaling assertion.
- [ ] The provider skill contract audit and the harness integrity suite both exit zero, and the evaluator fresh-context sentence is present and unchanged in the code-review skill.

## Negative-category review

Invalid input is covered by the retired-category and unscoped-model-parameter rejections, which are the two ways this routing text can be written wrong. Data integrity is covered by the generator drift check, which is the mechanism that keeps the generated region and its metadata source from diverging, and by the fresh-context regression criterion that pins the deliberately unchanged surface. Auth, permission, timeout, network, dependency-unavailability, concurrency, resource-exhaustion, partial-failure, deletion-cascade, and idempotency categories are inapplicable: the change adds no runtime code path, no external call, no persistence, and no deletion — it rewrites typed constant strings and shipped guidance prose that are read at authoring time, not executed. Model-availability degradation is not a new failure mode here; the already-approved provider fallback ladder owns it and is only referenced, not modified.
