# Track: engine-cannot-represent-more-than-one-branch-step-

Track: technical

Scope boundary: The stack-aware foundation of jstoup111/ai-conductor#2940, trimmed to what later critical-path tickets consume but do not own, and limited to what a real production entry point reaches:

1. **An N=1 golden byte-identity suite.** It proves that a feature with no child produces the same outputs as today. A feature has no child when `stacked_prs.enabled` is off, when its plan is unsliced, or when its plan is sliced but the flag is off.
   - **Covered outputs:** persisted state files, gate verdict paths, events, `daemon status`, the dashboard, PR bodies and the shipped-record Cost block.
   - **Excluded:** interval timings and the shipped-record Time block derived from them.
2. **One shared feature-branch identity parser.**
   - It replaces the four independent slug parsers (finish-record, halt-PR reconciliation, daemon halt-PR operations, GitHub-operations CLI). Every branch consumer adopts it: finish-record, worktree creation and teardown, park, halt-PR reconciliation, intake overlap and the GitHub-operations scope check.
   - A child branch `feat/c<k>/<slug>` (child ids 1–9, a fixed engine ceiling independent of config) resolves to its feature and never to a wrong or colliding slug. The leaf keeps today's `feat/daemon-<slug>`.
   - **Child-branch behaviors in this ticket:**
     - finish-record refuses a child branch;
     - park never deletes a child branch, and refuses a whole candidate whose worktree lists one;
     - a child authorizes GitHub writes only for its own feature, and only when the leaf exists.
   - Leak triage needs no change: it only uses branches to explain stray files and never reports a branch as a leak.
3. **Per-child storage under `.pipeline/children/<k>/`,** written only for a child whose state already exists, so that no child overwrites another's.
   - It covers step status (`conduct-state.json`), region gate verdicts (`acceptance_specs`, `build`, `test_suite`, `build_review`) and kickback-ledger entries.
   - A fresh-session ledger clear also covers child ledgers.
4. **An optional `child` field on the event spine,** absent when there is no child.
5. **An optional `--child <k>` on three recovery CLIs,** accepted only for a valid child id whose child state already exists. Without the flag, each command behaves exactly as today.
   - **`rewind --to <step> --child k`** rewinds only region steps. It demotes child k's region from the target, every region step of each existing child above k, and every downstream whole-feature step. It never touches children below k.
   - **`task start|done <id> --child k`** validates the task's slice membership against k. Engine-appended remediation tasks are accepted, and a worktree with no recorded slice membership is refused.
   - **`kickback-budget inspect --child k`** reads child k's entries. `raise` and `reset` take no `--child`.
   - The stalled-feature runbook and CLI reference document the child form, and single-PR recipes stay unchanged.

The umbrella ADR also fixes contracts that later tickets implement:
- the active-child rule (derived from git branch state);
- the per-site base override (the parent is the previous declared slice position; fail closed when it is missing);
- child-capable test-suite evidence and remediation cases;
- per-child caps;
- leaf-only placement of whole-feature rubrics such as security;
- position immutability once children exist;
- the reserved `feat/c<k>` namespace;
- the operator config key `stacked_prs.max_slices` (default 1, warn above 5, refuse 10 or more).

Excluded:
- active-child resolution and its survival across restarts, the base-override implementation, engine-site child wiring, child-capable test-suite evidence and remediation cases, per-child caps, leaf-only rubric placement, the position-immutability guard, halt records written to the leaf with a `Child:` field, and `raise`/`reset --child` (all #2942);
- the `stacked_prs.max_slices` key and its land enforcement (#2941);
- the child-to-PR map, retained-draft-at-leaf publication, lifting finish-record's child refusal, and child-branch teardown and removal (#2945);
- restack (#2943);
- fix routing (#2944);
- any consumer of `stacked_prs.enabled`.

Repair obligations stay feature-wide, consistent with #2944.

This is engine identity and state machinery plus operator recovery-CLI flags and runbooks, with no end-user product requirement (the same classification as the #2723 slice-manifest precedent). Acceptance criteria therefore live in stories, and no PRD is authored.

**Operator-selected approach:** an orthogonal child context. `StepName` is kept, per-child stores are nested, and an optional event field is added. This was chosen over a typed step identity, a unified base resolver, or a git-config branch registry. Child branch naming `feat/c<k>/<slug>` was chosen by the operator over `feat/daemon/<slug>/c<k>` and `feat/daemon-<slug>--c<k>`. The operator also chose to ship only what the recovery CLIs reach and to fix the remaining contracts in the ADR, over deriving the active child now or wiring every engine site to a "no child" value.
