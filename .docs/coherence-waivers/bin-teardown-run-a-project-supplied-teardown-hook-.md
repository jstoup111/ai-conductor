# Coherence Waiver: bin-teardown-run-a-project-supplied-teardown-hook-

Waives: FR-12

Rationale: FR-12 requires that the teardown hook be documented for project maintainers wherever
the existing setup hook and the per-worktree identity are already documented. It has no story and
no plan task, and that is a deliberate consequence of two skill boundaries rather than an
oversight.

The `stories` skill's documentation boundary states plainly: "Do not create stories, requirements,
acceptance criteria, Done-When items, or notes for writing or updating ordinary project
documentation… When documentation accompanies functional work, omit the documentation portion
entirely and write stories only for the functional behavior." The `plan` skill's boundary is
stricter still: "Never create plan tasks, subtasks, requirements, verification items, or notes for
writing or updating ordinary project documentation—even when it accompanies functional work."
Authoring a story or a task for FR-12 would violate both.

Those boundaries are correct for this repository because documentation here is owned by a wired
gating step, not by per-feature tasks. `.ai-conductor/config.yml:114-119` configures
`maintain-documentation` with `after: rebase`, `enforcement: gating`, and
`completion_artifact: .pipeline/maintain-documentation-pass`, pointing at
`.agents/skills/maintain-documentation/SKILL.md`. The build cannot reach finish without that step
passing, so CLAUDE.md's Documentation Upkeep rule — "Every change that adds or alters user-facing
behavior MUST update the relevant documentation in the same PR" — is enforced by machinery on this
feature's own PR rather than by a task someone could skip.

The specific pages that step must update are already recorded in two authored artifacts, so the
requirement is not lost by being waived here: the architecture review's Condition 5
(`.docs/decisions/architecture-review-2026-08-07-bin-teardown-run-a-project-supplied-teardown-hook-.md`)
and the plan's Technical Approach both enumerate `docs/reference/environment.md`,
`docs/reference/configuration.md` (including the deliberate divergence whereby a zero value for
`teardown_timeout_seconds` falls back to the default rather than acting as an opt-out, unlike its
sibling `auth_park_timeout_minutes`), `docs/guides/running-the-daemon.md`,
`docs/runbooks/worktree-and-evidence-recovery.md`, and `docs/contributing/testing.md`.

Marking `fr-12` as covered by inventing a story or task citation would be a false traceability
claim of exactly the kind the coherence artifact exists to prevent. It is recorded as a gap and
waived, with the real delivery route named.
