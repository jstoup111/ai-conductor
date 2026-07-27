# Coherence: Cold-Start Within-Step Retries (#1071)

Plan stem: `claude-within-step-retries-resume-the-prior-attemp`. Tier M, technical track —
the `fr` row class is omitted (no PRD; acceptance criteria live in the stories). The
`outcome` row class is omitted as well: no intake-outcome bullets are staged in this
worktree, so there are no `outcome-<n>` ids to resolve against. The intake issue's six
desired outcomes are traced narratively in the section below, and structurally through the
ADR and the architecture review. Story ids are the `## Story ST-1071-N:` headings in
`.docs/stories/claude-within-step-retries-resume-the-prior-attemp.md`; task ids `1`–`18` are
the `### Task N:` headers in the plan, and each plan task cites exactly one story id on its
`**Story:**` line.

| Row class | Id | Counterpart id(s) | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| story | story-ST-1071-1 | task-1, task-2, task-3, task-4, task-11, task-12, task-15 | covered | RED/GREEN on `prepare()`, the artifact-sourced-retry acceptance test, the cleanup, and the acceptance inversions all cite ST-1071-1 |
| story | story-ST-1071-2 | task-5, task-6 | covered | RED/GREEN on the `group-core.ts` branch resume authority |
| story | story-ST-1071-3 | task-7, task-8 | covered | RED/GREEN on the legacy scalar authority and `session.ts` argv selection |
| story | story-ST-1071-4 | task-13, task-14 | covered | RED/GREEN on context-carrying `runInteractive` at both call sites |
| story | story-ST-1071-5 | task-9, task-10 | covered | Survival guards for `sessionExpired` recovery and OTel run-id stability |
| story | story-ST-1071-6 | task-16, task-17, task-18 | covered | Contract-document amendments, `HARNESS.md` + `CHANGELOG`, validation suite |
| task | task-1 | story-ST-1071-1 | covered | Characterizes today's behavior at all three resume authorities before any change |
| task | task-2 | story-ST-1071-1 | covered | RED: provider-scope retry must cold-start with a fresh id |
| task | task-3 | story-ST-1071-1 | covered | GREEN: `prepare()` mints per invocation, always `resume: false` |
| task | task-4 | story-ST-1071-1 | covered | Inverts `provider-session.test.ts:178-195` and `provider-execution.test.ts:164` |
| task | task-5 | story-ST-1071-2 | covered | RED: branch-member retry, both `providerSessions` and scalar paths |
| task | task-6 | story-ST-1071-2 | covered | GREEN: branch executor never resumes; `sessionExpired` re-run stays non-consuming |
| task | task-7 | story-ST-1071-3 | covered | RED: scalar retry and inherited `session-created` marker |
| task | task-8 | story-ST-1071-3 | covered | GREEN: scalar cold start; marker persists but no longer implies resume |
| task | task-9 | story-ST-1071-5 | covered | Guards `sessionExpired` classification and non-consuming `session_reset`, both providers |
| task | task-10 | story-ST-1071-5 | covered | Guards `conductor.run.id` stability and no per-invocation write to `conduct-session-id` |
| task | task-11 | story-ST-1071-1 | covered | Acceptance: a cold-started retry completes from committed artifacts alone |
| task | task-12 | story-ST-1071-1 | covered | Removes resume bookkeeping with no consumer; gated behind every guard task |
| task | task-13 | story-ST-1071-4 | covered | RED: interactive prompt carries step name and failure reason |
| task | task-14 | story-ST-1071-4 | covered | GREEN: threads `retryHint` content into both call sites, drops `resume: true` |
| task | task-15 | story-ST-1071-1 | covered | Inverts the acceptance-level resume assertions in both acceptance suites |
| task | task-16 | story-ST-1071-6 | covered | Supersedes ADR §2 and amends both accepted story files |
| task | task-17 | story-ST-1071-6 | covered | `HARNESS.md` + `CHANGELOG` + release-waiver contingency |
| task | task-18 | story-ST-1071-6 | covered | Mandatory `test/test_harness_integrity.sh` and full suite |

All rows covered; zero gaps.

## Intake outcome trace (narrative — no staged bullets to key `outcome-<n>` rows against)

- **A Claude step's 2nd+ attempts start with no conversational memory, observable from the
  dispatch** → ST-1071-1, ST-1071-2, ST-1071-3 → tasks 2, 3, 4, 5, 6, 7, 8. One story per
  resume authority; each asserts `resume === false` plus a distinct session id at the
  dispatch seam.
- **A retried attempt still has what it needs, from committed artifacts and the retry
  prompt** → ST-1071-1 → task 11. ADR Decision 4 is the contract; task 11 is its dedicated
  acceptance test.
- **No attempt fails on a session-identifier collision between attempts of the same step** →
  ST-1071-1, ST-1071-5 → tasks 3, 9. Minting moves with the flag; `SESSION_IN_USE_RE` and
  non-consuming `session_reset` survive.
- **Interactive recovery paths still open on a session that knows what just failed and why**
  → ST-1071-4 → tasks 13, 14. Both call sites named: `conductor.ts:4785` and `:5808`.
- **Telemetry for a feature stays correlated across process restarts** → ST-1071-5 → task 10.
  `conductor.run.id` stability plus no per-invocation write to `.pipeline/conduct-session-id`.
- **Claude and Codex retry semantics described identically, no provider-conditional
  exception** → ST-1071-6 → tasks 16, 17.

Each of the three named documents in the last outcome — the fresh-session-scope ADR §2,
`.docs/stories/fresh-session-per-step.md`, and `per-step-provider-routing-927.md` ST-927-7 —
is an explicit deliverable of task-16, plus `HARNESS.md:237-241` in task-17.

## Verification notes

- **Every intake outcome reaches at least one task.** The shortest chain is the telemetry
  outcome → ST-1071-5 → task-10; the longest is the memory-isolation outcome → three stories
  → seven tasks.
- **Every task cites exactly one story.** Verified against the plan's `**Story:**` lines — no
  comma-separated lists, which would register only the first id.
- **No orphan story.** All six stories appear in the task column.
- **No orphan task.** All eighteen tasks appear in a story row.
- **The two conflict-check contradictions are closed by a deliverable.** ST-1071-6 and
  task-16 exist so the accepted #325 story and ST-927-7 are amended rather than left to
  contradict this spec.
- **The one un-derisked assumption is traced.** ADR Decision 4 (no autonomous step depends on
  conversational recall; 90% confidence, inferred from `buildSystemPrompt` re-sending the full
  prompt) is carried by ST-1071-1 → task-11, which is written to fail honestly rather than be
  worked around by restoring resume.
