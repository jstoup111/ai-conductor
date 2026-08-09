# Coherence Waiver: no-operator-command-to-reseal-a-protected-decide-a

Waives: outcome-5

Rationale: outcome-5 of intake `jstoup111/ai-conductor#1281` asks that
`docs/runbooks/stalled-or-stuck-feature.md` document the recovery as a command and that the CLI
reference document the new flags. It has no story and no plan task, and that is a deliberate
consequence of two skill boundaries rather than an oversight.

The `stories` skill's documentation boundary states plainly: "Do not create stories, requirements,
acceptance criteria, Done-When items, or notes for writing or updating ordinary project
documentation… When documentation accompanies functional work, omit the documentation portion
entirely and write stories only for the functional behavior." The `plan` skill's boundary is
stricter still: "Never create plan tasks, subtasks, requirements, verification items, or notes for
writing or updating ordinary project documentation—even when it accompanies functional work."
Authoring a story or a task for outcome-5 would violate both.

Those boundaries are correct for this repository because documentation here is owned by a wired
gating step, not by per-feature tasks. `.ai-conductor/config.yml:114-119` configures
`maintain-documentation` with `after: rebase`, `enforcement: gating`, and
`completion_artifact: .pipeline/maintain-documentation-pass`, pointing at
`.agents/skills/maintain-documentation/SKILL.md`. The build cannot reach finish without that step
passing, so CLAUDE.md's Documentation Upkeep rule — "Every change that adds or alters user-facing
behavior MUST update the relevant documentation in the same PR" — is enforced by machinery on this
feature's own PR rather than by a task someone could skip.

The documentation obligation is additionally recorded as Condition 5 of
`.docs/decisions/architecture-review-2026-08-09-no-operator-command-to-reseal-a-protected-decide-a.md`,
which names both target files explicitly: the `npx tsx` heredoc recipe at
`docs/runbooks/stalled-or-stuck-feature.md:694-733` is to be replaced by the command form
(including the commit-first constraint), and `docs/reference/cli.md` is to document the new flags.
Unmet conditions are blocking at `/finish`, so the obligation carries a second enforcement point
independent of the gating step.

Precedent: `.docs/coherence-waivers/bin-teardown-run-a-project-supplied-teardown-hook-.md` waives
`FR-12` on identical reasoning.
