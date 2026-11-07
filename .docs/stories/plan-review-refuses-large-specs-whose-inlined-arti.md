**Status:** Accepted

# Stories: plan review prompt carries an index, not every cited ADR (#3278)

Technical track. Sources: `.docs/track/plan-review-refuses-large-specs-whose-inlined-arti.md`, `.docs/decisions/architecture-review-2026-10-24-plan-review-refuses-large-specs-whose-inlined-arti.md`, and the 2026-10-24 amendment to `adr-2026-10-10-source-grounded-adversarial-plan-review-step` D3.

Terms used below:
- **In-scope decision:** a decision of an ADR the plan cites or the spec changes, as plan review selects today.
- **Changed decision:** an in-scope decision whose passage text differs from the same decision in the ADR at the spec's merge base with the default branch, or any decision of an ADR that does not exist at the merge base.
- **Indexed decision:** every other in-scope decision.

## Story 1: The round-1 prompt inlines what the spec changes and indexes the rest

**Requirement:** Track outcomes 1 and 2 (a Large spec over 400,000 characters is reviewed, and the prompt no longer grows with the full text of every in-scope ADR)

As the plan-review runner, I want the round-1 reviewer prompt to carry the plan, the stories and the changed decisions verbatim, and only an index entry for every indexed decision and for the coherence artifact, so that the prompt grows with what the spec changes rather than with every ADR it touches.

### Acceptance Criteria

#### Happy Path
- Given a spec whose plan cites ADR `adr-a` (decisions D1 to D6, none changed from the merge base) and changes ADR `adr-b` by adding an amendment note inside D2 only, when a round-1 review is dispatched, then the prompt carries every plan task and every story verbatim, carries the passage of `adr-b#D2` verbatim, and carries no passage text beyond each decision's one-line index title for `adr-a#D1` to `adr-a#D6` or for `adr-b`'s other decisions.
- Given the same spec, when a round-1 review is dispatched, then the prompt's index lists `adr-a#D1` to `adr-a#D6` and every unchanged decision of `adr-b`, each with the decision's first line as its title and `.docs/decisions/<adr-stem>.md` as its path, and lists the coherence artifact by its path `.docs/coherence/<plan-stem>.md` without its text.
- Given a spec that adds a new ADR `adr-new` with decisions D1 to D4, when a round-1 review is dispatched, then the passages of all four decisions are carried verbatim.
- Given a spec shaped like #2945 at its land commit (16 in-scope ADRs, 15 of them amended or added, 140,644 characters of in-scope decision text of which 58,497 are in changed decisions), when the round-1 prompt is assembled with the default budget, then it is within 400,000 characters and is dispatched rather than refused.
- Given a round-1 artifact already exists and the plan has since changed, when the round-2 review is dispatched, then the prompt carries only the digest-changed tasks, stories and decisions and the prior blocking and significant findings, exactly as before this change.

#### Negative Paths
- Given no canonical project path is supplied, so the spec's change set is unknown, when a round-1 review is dispatched, then every decision of every ADR the plan cites is carried verbatim as before this change and none is indexed.
- Given the spec's change set cannot be resolved because `git merge-base` against the default branch fails, when a round-1 review is requested, then it fails before any reviewer is dispatched, as before this change.
- Given the merge-base text of one changed ADR cannot be read (`git show` fails for that path), when a round-1 review is dispatched, then every decision of that ADR is carried verbatim and the other ADRs are split into changed and indexed decisions as normal.
- Given a cited ADR that has no `## Decision` section, when a round-1 review is dispatched, then it contributes neither inline passages nor index entries, as before this change.
- Given a spec with no coherence artifact, when a round-1 review is dispatched, then the index carries no coherence entry and the review still dispatches.
- Given an in-scope decision whose passage differs from the merge base only by trailing whitespace on a line, when a round-1 review is dispatched, then it is treated as changed and carried verbatim; given one that differs only by `\r\n` versus `\n` line endings, it is treated as unchanged and indexed, because its parsed passage is identical.

### Done When
- [ ] A runner test over a fixture with one cited unchanged ADR and one ADR amended in D2 asserts the dispatched prompt contains every task and story heading, the `adr-b#D2` passage, an index entry for each other decision with its title and path, and no passage text of any indexed decision.
- [ ] A runner test asserts every decision of an ADR absent at the merge base is inlined.
- [ ] A runner test over a generated fixture with the #2945 shape (a 125,635-character plan, 33,183 characters of stories, a 50,782-character coherence artifact, and 15 changed ADRs carrying 140,644 characters of decision text of which 58,497 are in changed decisions) asserts the assembled round-1 prompt is under 400,000 characters and is dispatched.
- [ ] Runner tests assert the no-canonical-path and unreadable-base-text cases inline every affected decision, and an unresolvable change set fails before dispatch.
- [ ] The existing round-2 runner tests pass unchanged.

## Story 2: The reviewer can still read every in-scope artifact, and grounding is unchanged

**Requirement:** Track outcomes 2 and 4 (the reviewer can read any full artifact it needs, and findings for specs that fit today keep their kind and quality)

As the plan reviewer, I want each indexed item to name a worktree path I can open, and my findings to be validated against the full artifacts, so that moving text out of the prompt removes nothing I can cite.

### Acceptance Criteria

#### Happy Path
- Given a round-1 prompt with indexed decisions, when the reviewer receives it, then the `INDEX` section's heading states that its items are not inlined, that each is read from its listed worktree path, and that an item must be opened before a finding quotes or relies on it.
- Given a finding whose contradiction evidence quotes a passage from an indexed decision and a passage from a plan task, when the finding is validated, then it is accepted, because grounding checks quotes against the full text of every in-scope ADR.
- Given a round-1 review completes, when the review artifact is written, then its reviewed digest covers the full plan, stories, coherence artifact and every in-scope ADR text, so the land rung's staleness check behaves as before this change.

#### Negative Paths
- Given a finding that quotes text present in no plan, story, in-scope ADR or source file, when the finding is validated, then it is rejected as ungrounded, as before this change.
- Given a finding whose reference names an indexed decision `adr-a#D3` that exists, when the finding is validated, then the reference is accepted exactly as a reference to an inlined decision would be.
- Given a finding whose reference is `the coherence index entry`, which names no task, story or ADR decision, when the finding is validated, then it is rejected as before this change.

### Done When
- [ ] `skills/plan-review/SKILL.md` describes the index and the open-before-citing rule.
- [ ] A validator test asserts a contradiction finding quoting an indexed decision is accepted when the prompt omitted that decision's text.
- [ ] A runner test asserts the reviewed digest written after an indexed round equals the digest computed over the same full artifacts before this change.

## Story 3: The operator can raise the prompt budget in config or for one run

**Requirement:** Track outcome 3 (a supported way to proceed when a review is refused for size)

As an operator, I want to raise the plan-review prompt budget persistently in config or once on the command line, so that a size refusal is never a dead end.

### Acceptance Criteria

#### Happy Path
- Given no budget is configured and no flag is passed, when a review is assembled, then the budget is 400,000 characters.
- Given `.ai-conductor/config.yml` sets `plan_review: { max_prompt_chars: 600000 }`, when `ai-conductor compose plan-review --project <name> --worktree <path>` runs, then a 450,000-character prompt is dispatched rather than refused.
- Given the same config, when the `conduct` plan_review step runs, then the same 600,000-character budget applies.
- Given config sets 600,000 and the operator runs `compose plan-review ... --max-prompt-chars 800000`, when the review is assembled, then the budget for that run is 800,000, and a later run without the flag uses 600,000.

#### Negative Paths
- Given config sets `plan_review.max_prompt_chars` to `0`, `-1`, `1.5` or `"large"`, when the config is loaded, then loading fails with an error naming `plan_review.max_prompt_chars` and stating it must be a positive integer.
- Given config sets an unknown key under `plan_review`, such as `plan_review.max_chars`, when the config is loaded, then loading fails naming the unknown key, as for other closed config blocks.
- Given the operator passes `--max-prompt-chars abc` or `--max-prompt-chars 0`, when `compose plan-review` parses its flags, then it exits 1 naming the flag and stating it takes a positive integer, and no reviewer is dispatched.
- Given the operator passes `--max-prompt-chars 800000` together with `--accept <id>` or `--acknowledge`, when `compose plan-review` parses its flags, then it exits 1 stating the flag applies only to a review run, and the review artifact is unchanged.
- Given `steps.plan_review.max_prompt_chars` is set instead of the top-level block, when the config is loaded, then loading fails naming the unknown step key, as for any unknown step key.

### Done When
- [ ] Config tests assert the default, a valid value, and each invalid value and unknown key above.
- [ ] CLI tests assert flag precedence over config, rejection of invalid values, and rejection alongside `--accept` or `--acknowledge`.
- [ ] A step-runner test asserts the configured budget reaches the runner on the `conduct` path.
- [ ] The `compose plan-review` help text names `--max-prompt-chars`.

## Story 4: An over-budget prompt is refused with what to change, before any dispatch

**Requirement:** Track outcome 3 (a refusal names what to change and the supported override)

As an operator, I want a size refusal to tell me which sections are large, by how much the budget is exceeded, and exactly how to proceed, so that I can act without reading the engine source.

### Acceptance Criteria

#### Happy Path
- Given a round-1 prompt of 452,000 characters and a 400,000 budget, when the review is assembled, then it is refused before any provider is dispatched, and the message states the prompt size, the budget, and the size of each section: plan, stories, inline ADR decisions, index, candidates, and prior findings when present.
- Given the same refusal, when the message is read, then it names the largest section, and names both overrides with a value that would admit this prompt: `--max-prompt-chars 452000` for one run and `plan_review.max_prompt_chars` in `.ai-conductor/config.yml`.
- Given the refusal, when the operator reruns with `--max-prompt-chars 452000`, then the review dispatches.

#### Negative Paths
- Given an over-budget prompt, when the review is refused, then no `plan_review_dispatched` event is emitted, no provider session is started, and `.docs/plan-review/<plan-stem>.md` is unchanged.
- Given an over-budget prompt under the `conduct` step runner, when the review is refused, then the step fails with the same message text that `compose plan-review` prints.
- Given a prompt exactly equal to the budget, when the review is assembled, then it is dispatched, not refused.

### Done When
- [ ] A runner test asserts the refusal text contains the prompt size, budget, every section size, the largest section's name, and both override forms with the admitting value.
- [ ] A runner test asserts zero executor calls, zero dispatch events and an unchanged review artifact on refusal.
- [ ] A runner test asserts a prompt equal to the budget dispatches.
