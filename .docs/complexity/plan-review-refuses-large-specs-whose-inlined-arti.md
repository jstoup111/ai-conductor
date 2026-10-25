# Complexity: Plan review prompt carries an index, not every cited ADR (#3278)

Tier: M

Rationale: The change reshapes one engine prompt and adds an operator override around it, and both of the step's entry points call the same runner:
- `plan-review-runner.ts`: the prompt keeps the plan, stories and the changed decision passages verbatim (a decision whose text differs from the merge base, or any decision of an added ADR), and replaces every other in-scope decision and the coherence artifact with an index of ids, titles and worktree paths. The size refusal names each section, what to change, and the override. Validation keeps reading the full artifacts, so finding grounding is unchanged.
- `plan-review-adr-scope.ts`: splits the in-scope decisions into changed and indexed, comparing each decision passage with the merge-base text of its ADR. `engineer/spec-change-set.ts` already computes the merge base in `resolveIdeaFiles`; the base text of a changed ADR is read from it.
- `types/config.ts` and the closed key lists in `engine/config.ts`: a new top-level `plan_review: { max_prompt_chars }` block, validated and resolved like the existing `prd_audit` block.
- `engineer-cli.ts`: a one-shot `--max-prompt-chars` flag on `compose plan-review`, and the configured budget passed through. `step-runners.ts` passes the configured budget on the `conduct` path.
- `skills/plan-review/SKILL.md`: the reviewer brief says indexed items are out of line and must be opened before a ruling cites them.

There is no new module, persisted schema, event or land rung. It does add a config key and a CLI flag, and it amends the APPROVED `adr-2026-10-10-source-grounded-adversarial-plan-review-step` D3 (the reviewer's inline inputs), so a lightweight architecture review is warranted. Expect 3-4 stories and about 6-8 plan tasks.
