# Complexity: Done step with an unsatisfied gate verdict loops silently to the selection cap

Tier: S

Rationale: One production file. `src/conductor/src/engine/conductor.ts` gains a post-success
freshness check in `advanceTail`: when the step just dispatched left its unsatisfied gate verdict
unrefreshed, the engine re-derives it through the existing `applyRebaseVerdicts` writer for a `noop`
or `mergeable_skip` rebase outcome (verified side-effect-free: it writes only the satisfied rebase
verdict) and otherwise halts at once with distinct wording. Every artifact-recomputed gate step already
refreshes its verdict after each run, so the check is inert for them. No new event variant, HALT
class, state key, config key, CLI, or schema: it reuses `gate_verdict`, `loop_halt`, and the
`needs-human` halt class, and the existing selection cap stays unchanged for genuine re-fails and
kickbacks. Operator confirmed tier S on 2026-10-29. Risk is bounded to the tail's post-dispatch
transition and is covered by focused conductor tests.
