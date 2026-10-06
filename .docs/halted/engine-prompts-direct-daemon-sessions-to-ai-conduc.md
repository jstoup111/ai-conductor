# Halt record

Status: halted
Slug: engine-prompts-direct-daemon-sessions-to-ai-conduc
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-engine-prompts-direct-daemon-sessions-to-ai-conduc
Head SHA: c1ae9a7859ede1d9e329a6ee14b4b06b27889dd2
Halted at: 2026-10-06T10:53:06.943Z

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

Claim: adr-2026-09-11-github-operation-ownership#D5
Text: ### D5 — Remote Git writes carry the same constraints

Resolve actual push destination and all affected refs before authorization. Refuse ambiguous implicit destinations, broad/mirror pushes, or multi-ref writes with any unauthorized target before invoking a mutating transport. Named remote deletion is a write, as is a force-with-lease push. Preserve existing force-push restrictions and leases; ownership is an additional gate, not permission to weaken them.

Local reads, commits, and worktree actions remain on their existing paths. Owned publication may proceed when all affected remote targets are authorized; there is no requirement to centralize every local Git command.

5. *Loud credential fallback, not a retry.* A typed bot-auth refusal is raised at the runner
   boundary as a result kind, never matched downstream on text (adr-2026-09-05 D5,
   adr-2026-08-18 D1). Its triggers are: the token file is missing or unreadable, `gh`
   reports 401, 403, or bad credentials, or git reports an authentication or permission
   denial. Each trigger uses conservative patterns backed by verbatim fixtures
   (adr-2026-07-22-auth-failure-classification-observed-401-patterns D1). On that refusal,
   and only then, the same authorized invocation runs once more with the operator's
   credential, and a warning event is emitted on the ConductorEvent spine. Because the
   operation, target, actor, and payload do not change, this is a substitution within one
   authorized call, not a D1 retry. It uses no retry budget and triggers no escalation
   (adr-2026-07-04 D2). Ambiguous failures, such as timeouts and transport errors, never fall
   back, so an external effect is never repeated (adr-2026-08-01-engine-owned-resumable-finish-publication

5. *No bot, no change.* With no bot configured, no co-author value is written and the helper
   adds nothing, so daemon commits stay byte-for-byte what they are today.
Task ids: 16, 17
Done when checks: Production-wrapper fixtures for ordinary PATH-resolved raw mutations from a managed session and an inheriting child script record an attributable attempt before the single fake process call and a correlated terminal result when observed; executing REST field-implied writes produces mutation observations, and executing GraphQL, alias, extension or opaque-input calls not safely classifiable as read-only produces possible-bypass observations. | Transport fixtures assert byte-identical argv and stdin/stdout/stderr forwarding, original exit status and termination-signal behavior, exactly one underlying call and no recursion, retry, rewrite, redirect or new command-blocking policy. | Failure, timeout and lost-terminal-result fixtures report failed or unknown observations instead of successful remote writes; exit zero is only observed CLI success and never verified remote state. | Injected observation-storage failure emits a bounded degraded-telemetry diagnostic while the underlying invocation is forwarded exactly once with original transport behavior. | Before mutating argv tests run, a benign production-wrapper invocation proves the real transport adapter reaches the injected fake; the same isolation holds if classification or guard logic is absent. | Known read-only raw gh calls and authorized guarded-path calls complete through their expected transport with zero unguarded-mutation observations, while raw mutation fixtures still produce observations. | A refused guarded operation produces zero raw-observer fallback calls and zero mutation calls; no whole-session authorization or public skip-observation flag is introduced. | Guarded and unguarded executable-resolution fixtures invoke the resolved real transport once without recursive wrapper entry or duplicate mutation, and guarded calls retain existing authorization actor and operator/bot credential selection. | Static-audit fixtures admit only the identified private observation passthrough; adding a neighboring raw call in the same file, a skill-directed raw write or an unregistered harness caller still fails validation.
Conflict: Tasks 16 and 17 require exactly one resolved underlying transport invocation with no retry, while the claim requires an authorized invocation to run once more with the operator credential after a typed bot-auth refusal.
```
