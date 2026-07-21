# Intake origin: no-diff-task-evidence-stamp

Source-Ref: jstoup111/ai-conductor#733
Owner: jstoup111

Routed to `ai-conductor`. Spec authored from the daemon forensic evidence on issue
#733 — a recurring `no_task_progress (N→N)` build-stall class that auto-parked
**5 of 6** freshly-dispatched builds from the 2026-07-21 spec batch (#241, #721,
#149, #148, #576); only #695 shipped.

**Root cause (one class, two stamping holes).** The build completion gate accepts
**only** an `evidenceStamps` sidecar entry as proof a task is done
(`artifacts.ts:1024-1036`) — a task's on-disk `completed`/`skipped` row is never
trusted. A task that legitimately produces **no code diff of its own** (a "GREEN +
full-suite check" verification task, or an already-satisfied contract pinned as
skipped) has no deterministic route to that stamp:

- `deriveCompletion` stamps only a Task-trailered commit whose diff overlaps the
  task's declared paths, an `Evidence: satisfied-by <sha>` no-op commit, or a
  judged-closure `semantic-verified` stamp.
- An `Evidence: skipped <reason>` commit sets `status:'skipped'` but writes **no
  stamp** (`autoheal.ts:747-753`).
- The verify-only judged-closure lane arms **only** on the literal
  `**Verify-only:** yes` marker (`conductor.ts:3289-3295`).

So a no-diff task authored as `**Type:** verification` (the convention the #718-batch
session used) or closed via `Evidence: skipped` can never be stamped → the gate
flags it forever → `no_task_progress` → auto-park. The one feature that shipped
(#695) happened to mark its verify task `**Verify-only:** yes`; the divergence is a
plan-authoring convention the engine does not recognize — exactly the prompt-discipline
dependence CLAUDE.md's Design Principle forbids.

**Fix.** Two small deterministic engine edits at the stamping layer so the gate's
`evidenceStamps` currency is obtainable for every legitimately no-diff task without
author discipline: (A) `Evidence: skipped` commits mint a stamp; (B)
`**Type:** verification` tasks are recognized as verify-only-eligible (union with the
existing marker), so the judged-closure lane arms for them. Both preserve the
derive-from-git invariant (a bare self-reported `skipped` row with no commit still
gets nothing).

See `.docs/decisions/adr-2026-07-21-no-diff-task-evidence-stamp.md` and
`.docs/conflicts/no-diff-task-evidence-stamp.md`.
