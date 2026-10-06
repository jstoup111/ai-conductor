# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-06T12:10:03.620Z
Slug: engine-prompts-direct-daemon-sessions-to-ai-conduc
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-engine-prompts-direct-daemon-sessions-to-ai-conduc
Head SHA: af6da4190a25f02569a2ae7770b42fd201583010
Halted at: 2026-10-06T11:17:28.587Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: plan tasks conflict with sealed criteria or ADR decisions.

Claim: adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D8
Text: ### D8 — Bootstrap asks; `conduct-ts config init` writes

`conduct-ts config init` gains optional flags (`--test-suite-mode`,
`--test-suite-drift-budget <preset>`, presets: `strict` = today, `tolerant` = the budgetable
categories at a documented bound) that substitute the answers into the generated
`test_suite.verification` block. The bootstrap skill asks the operator both questions
(auto-mode: `strict` without prompting) and records the answers **through the CLI** — the
hand-authoring prohibition stands. This amends
`adr-2026-07-27-project-config-scaffolder`'s bare-copy decision: the template remains the
sole source shape; `config init` becomes a parameterized instantiation of it rather than a
byte copy, still deterministic and refuse-to-clobber.

**Amended 2026-09-14 by #2218 (guided bootstrap setup):** D8's ask-then-record pattern is
extended from the two `test_suite.verification` answers to every project-config setting the
bootstrap walkthrough asks about. The hand-authoring prohibition, the template as sole source
shape, idempotence, and refuse-to-clobber are all unchanged.

**D8.1** — Read ruling. The interview's `config read` calls, including the `spec_owner`
identity read, run only from the operator's unmarked shell session. The daemon-session guard's
allowlist stays closed to `config`; a marked session's `config read` is refused, and that
refusal is the approved behavior, not a reachability defect.

**D8.2** — Write ruling. The interview's `config init` flag answers and its
`config set spec_owner` call run only from the operator's unmarked shell session. No `config`
write is sanctioned from a daemon-managed session, and no guard exemption is added for bootstrap.

**D8.3** — Re-run ruling. A re-run of the interview is the same operator-invoked path: its
per-key `config read` inspection and its refuse-to-clobber `config init` run from the operator's
shell. Declaring the engine-managed prelude an unsupported path for the guided interview is the
chosen resolution: the allowlist in `src/conductor/src/execution/daemon-session.ts` is not
widened, and no step-scoped exemption or engine-performed write is introduced. The managed
prelude's pre-existing auto-mode `config init` call predates this feature (the merge-base skill
already invoked it), is unchanged by this amendment, and is out of its scope.
Task ids: 6
Done when checks: Initialized-project runProjectPrelude fixtures reach supported refresh with no provider direction to execute config reads, initialization or writes; the managed refresh branch never runs the operator configuration interview. | An unmarked operator bootstrap fixture reaches the existing runConfigInit writer on an uninitialized project and retains successful guided initialization through the same validated CLI options. | Missing required configuration makes runProjectPrelude report operator bootstrap required before launching any provider and writes no replacement project or machine configuration. | Unreadable or invalid required configuration produces a named setup problem, zero provider launches and no ready result; before/after project and machine configuration snapshots remain unchanged. | Initialized configuration with non-default operator choices remains byte-identical after managed refresh and after an unmarked operator re-run; existing runConfigInit no-clobber fixtures retain their behavior.
Conflict: Task 6 requires missing required configuration to report operator bootstrap required before provider launch and make no project or machine configuration writes; the claim retains an engine-managed prelude auto-mode `config init` call.
```
