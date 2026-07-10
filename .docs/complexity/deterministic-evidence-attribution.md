# Complexity: Deterministic build evidence attribution (#433)

Tier: M

Rationale: touches four coordinated surfaces — a new `conduct-ts task` CLI subcommand
(engine-owned status transitions + `.pipeline/current-task` stamp), two new git hooks
(`prepare-commit-msg`, `commit-msg`) wired per-worktree via `core.hooksPath` in
`prepareWorktree`, a pipeline-SKILL step-0 change, and lockstep with the evidence gate's
#418 id grammar (`TASK_ID_PATTERN`, `Evidence: satisfied-by`). No external integrations,
no auth, no schema/API changes — so not L; the gate interplay and multi-surface wiring
rule out S. Lightweight architecture review + conflict-check required; operator confirmed
M on 2026-07-09.
