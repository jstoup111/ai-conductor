# Coherence: Codex fresh-session-per-step contract (#903)

Plan stem: `codex-fresh-session-per-step-contract`. Tier M, technical track — the `fr` row class is omitted (no PRD; acceptance criteria live in the stories). The `outcome` row class is omitted (no staged intake-outcome bullets in this worktree); issue #903's four desired outcomes are traced narratively below the table instead. Story ids `S1`–`S4` are the `## Story <id>` headings in the stories file; task ids `1`–`10` are the plan's task tree.

| Row class | Id | Counterpart id(s) | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| story | story-S1 | task-1, task-2, task-3, task-4, task-7, task-10 | covered | Tasks 1–4 build and gate the capability; 7 annotates the superseded rule; 10 documents it |
| story | story-S2 | task-8 | covered | Task 8 is the multi-attempt acceptance test; S2 requires verification, not new code — the retry prompt is already self-contained |
| story | story-S3 | task-4 | covered | Task 4 emits the deduped `session_policy` diagnostic and covers S3's happy path plus both negative paths |
| story | story-S4 | task-1, task-5, task-6, task-8, task-9 | covered | Task 1 adds the contract-level regression, 5 the faithful fake, 6 the amended suites, 8 the end-to-end run, 9 the opt-in real-CLI probe |
| task | task-1 | story-S1, story-S4 | covered | Capability field on `LLMProvider` + the failing contract test that is S4's negative path |
| task | task-2 | story-S1 | covered | Per-adapter declarations; S1's Claude negative path depends on `true` here |
| task | task-3 | story-S1 | covered | Argv branch deletion + always-`--cd`; S1 happy path asserts both |
| task | task-4 | story-S1, story-S3 | covered | Single-seam resume gate (S1 happy + all three negative paths) and the suppression diagnostic (S3) |
| task | task-5 | story-S4 | covered | Shared faithful fake that mints its own thread id — the fidelity gap named in S4's context |
| task | task-6 | story-S4 | covered | Amends `conductor.test.ts:9082-9245` and `per-step-provider-routing-927.acceptance.test.ts:922-973` per S4's happy path (amend, not delete) |
| task | task-7 | story-S1 | covered | Annotates the prior ADR §2 and two story files; discharges Conflict 1's resolution |
| task | task-8 | story-S2, story-S4 | covered | End-to-end 2-attempt Codex run asserting S2's happy path and both of its negative paths |
| task | task-9 | story-S4 | covered | Opt-in real-Codex help probe re-checking the ADR's central assumption |
| task | task-10 | story-S1 | covered | `docs/explanation/architecture.md` + CHANGELOG, per the repo's documentation-upkeep and changelog gates |

**Issue #903 desired outcomes (narrative trace, no staged outcome ids):**

- *Codex runs start each executed step from the intended fresh context* → S1, tasks 3 and 4. The capability gate forces `resume:false` and the deleted argv branch makes a resume unconstructable.
- *Retries preserve only the intended step-local context* → S2, task 8. The retry prompt is `RETRY: <reason>` plus the full step system prompt (`step-runners.ts:1901`), asserted end-to-end over a two-attempt Codex step.
- *Stale/missing/in-use session failures recover or halt with clear diagnostics* → S2, S3, task 4. The failure class is removed at source (S2 NP-1), the defensive classifier is retained (S2 NP-2), and suppression is made legible by the `session_policy` diagnostic.
- *Accepted behavior covered by fake-provider tests and an optional real-Codex smoke* → S4, tasks 1, 5, 6, 8, 9.

All rows covered; zero gaps. Every story maps to at least one task and every task cites at least one story. Verdicts confirmed against the stories, plan, ADR, and conflict-check files in this worktree.

**Conflict-resolution traceability:** Conflict 1 (unqualified retry-resume rule) → task 7 + the ADR's "Amends prior decisions" section. Conflict 2 (#1042 ownership overlap) → the plan's non-goals (keep `forceFreshSession`, keep `CODEX_SESSION_EXPIRED_RE`) and S1's third negative path (both suppressors compose).
