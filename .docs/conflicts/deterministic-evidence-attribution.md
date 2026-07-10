# Conflict Check: Deterministic Build Evidence Attribution (#433)

**Date:** 2026-07-09
**Stories checked:** `.docs/stories/deterministic-evidence-attribution.md` (7 stories) against the
full `.docs/stories/` corpus, `.docs/specs/`, prior `.docs/conflicts/` reports, and remote
`spec/*` branches (BSP convention — only `spec/resolve-417-...` is related, and its content is
already merged to main as the 2026-07-07 grammar stories).
**Result:** PASSED — zero blocking conflicts; two degrading interactions found and resolved
(operator-selected resolutions applied 2026-07-09).

## Conflict 1: ST-020 advisory-write mechanism superseded

**Stories involved:** Story 7 (pipeline SKILL step 0 delegates to CLI) vs
`features/pipeline/ST-020-factory-orchestration.md` (as amended 2026-07-05 by #302)
**Type:** behavioral overlap
**Severity:** degrading
**Confidence:** 95% (grounded in ST-020's amendment text: "retains only advisory
`pending`/`in_progress` scheduling writes" — a hand-edit instruction our Story 7 mechanizes)

Same actor, same scheduling semantics; only the write mechanism changes (hand-edit → engine-owned
CLI). Not mutually exclusive — a supersession of mechanism.

**Resolution (selected: amendment note):** appended a dated 2026-07-09 amendment note to ST-020
mirroring its existing 2026-07-05 note, pointing to the APPROVED #433 ADR and stories. History
preserved; no criteria rewritten.

## Conflict 2: #418 subject⇒trailer mismatch visibility under auto-stamp

**Stories involved:** Story 4/5 (auto-stamp + validation hooks) vs
`2026-07-07-evidence-gate-task-id-grammar.md` (tdd COMMIT checklist: subject-referenced task must
have a matching trailer, agent amends on mismatch)
**Type:** behavioral overlap
**Severity:** degrading
**Confidence:** 90% (inferred interaction: auto-stamp fills the trailer with the *current* task id,
so a subject naming a different task no longer fails the agent's checklist visibly)

**Resolution (selected: warn-only hook check):** added a negative-path scenario to Story 5 — the
`commit-msg` hook warns (stderr, exit 0) when the subject references a task id different from the
trailer id. Non-blocking, consistent with the bundling warning; #418's checklist prose is
unchanged and remains the agent-facing documentation.

## Verified-clean pairs (reasoned, not assumed)

- **`prd-audit-kickback-preserves-task-status.md` (#302 seeding):** seeding preserves
  `in_progress` rows; `task start` validates against the seeded set and writes through the same
  atomic pattern. The CLI never stamps `completed`, so the engine's completion authority
  (H4/H6/H7) is untouched. Compatible.
- **Rebase-flow stories (`post-rebase-build-invalidation-...`, /rebase skill):** the sanctioned
  finish-time rebase replays commits with their existing trailers; `prepare-commit-msg` abstains
  while `rebase-merge`/`rebase-apply` exists. No restamping of replayed history. Compatible.
- **`harness-daemon-profile.md` / provisioning stories:** Story 6 asserts the existing
  namespace + `bin/setup` contract is unchanged and hook wiring is fail-open — no new blocking
  dependency at `prepareWorktree`. Compatible.
- **`add-a-judgement-gate-at-the-build-manual-test-seam.md` (#367) and the requeued #403
  (in-dispatch engine rebuild):** different subsystem (manual_test gate / dist staleness). The
  hooks deliberately invoke no engine dist, so #403's staleness class cannot affect them; a future
  #403 fix composes without touching these surfaces. Compatible.
- **Resource contention on `.pipeline/`:** `current-task` is a new file written only by the
  `task` CLI (and cleared at seed time); `task-status.json` writers remain engine code paths
  (seed, CLI) using temp+rename. No second semantic assigned to an existing resource.

## Re-check

After applying both resolutions, the full scan was re-run over the amended files: zero blocking,
zero new interactions. Degrading items are resolved (not merely accepted).
