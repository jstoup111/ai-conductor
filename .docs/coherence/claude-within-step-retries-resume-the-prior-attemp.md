# Coherence: Claude Declares No Resume (#1071)

Plan stem: `claude-within-step-retries-resume-the-prior-attemp`. Tier M, technical track — the
`fr` row class is omitted (no PRD; acceptance criteria live in the stories). The `outcome` row
class is omitted as well: no intake-outcome bullets are staged in this worktree, so there are no
`outcome-<n>` ids to resolve against. The intake issue's six desired outcomes are traced
narratively below. Story ids are the `## Story ST-1071-N:` headings in
`.docs/stories/claude-within-step-retries-resume-the-prior-attemp.md`; task ids `1`–`16` are the
`### Task N:` headers in the plan, and each plan task cites exactly one story id on its
`**Story:**` line.

This feature depends on spec PR **#1069** (issue #903); plan task-1 asserts that dependency
mechanically and halts the build if it is unmet.

| Row class | Id | Counterpart id(s) | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| story | story-ST-1071-1 | task-1, task-2, task-3, task-4, task-15 | covered | Prerequisite assertion, RED/GREEN on the Claude declaration, argv deletion, and the inversion of the Claude assertions #1069 preserved |
| story | story-ST-1071-2 | task-5, task-14 | covered | Per-invocation minting and the retirement of the bookkeeping it makes vestigial |
| story | story-ST-1071-3 | task-6, task-7, task-8, task-9 | covered | RED/GREEN on both dispatch paths #1069's capability gate never reaches |
| story | story-ST-1071-4 | task-10, task-11 | covered | RED/GREEN on context-carrying `runInteractive` at both operator-facing call sites |
| story | story-ST-1071-5 | task-12, task-13 | covered | Guards for recovery classification, `session_policy` scoping, run-id stability, and artifact-sourced retries |
| story | story-ST-1071-6 | task-16 | covered | Closes the divergence #1069 named, across six documents, then runs the validation suite |
| task | task-1 | story-ST-1071-1 | covered | Asserts #1069's capability seam exists; halts the build if it does not |
| task | task-2 | story-ST-1071-1 | covered | RED: a Claude within-step retry must cold-start |
| task | task-3 | story-ST-1071-1 | covered | GREEN: `ClaudeProvider.supportsSessionResume = false` |
| task | task-4 | story-ST-1071-1 | covered | Deletes Claude's `--resume` argv branch, mirroring #1069's Codex treatment |
| task | task-5 | story-ST-1071-2 | covered | GREEN: `prepare()` mints per invocation, always `resume: false` |
| task | task-6 | story-ST-1071-3 | covered | RED: branch-member retry, both `providerSessions` and scalar paths |
| task | task-7 | story-ST-1071-3 | covered | GREEN: branch executor never requests resume; `sessionExpired` re-run stays non-consuming |
| task | task-8 | story-ST-1071-3 | covered | RED: legacy scalar retry and inherited `session-created` marker |
| task | task-9 | story-ST-1071-3 | covered | GREEN: scalar cold start; marker persists but no longer implies resume |
| task | task-10 | story-ST-1071-4 | covered | RED: interactive prompt must carry step name and failure reason |
| task | task-11 | story-ST-1071-4 | covered | GREEN: threads `retryHint` content into both call sites, drops `resume: true` |
| task | task-12 | story-ST-1071-5 | covered | Guards `sessionExpired` recovery for both providers and `session_policy` once-per-step |
| task | task-13 | story-ST-1071-5 | covered | Guards run-id stability and proves a cold retry completes from committed artifacts |
| task | task-14 | story-ST-1071-2 | covered | Retires vestigial bookkeeping; gated behind every guard and behavior task |
| task | task-15 | story-ST-1071-1 | covered | Inverts the Claude half of the pinned assertions #1069 preserved |
| task | task-16 | story-ST-1071-6 | covered | Six-document amendment, CHANGELOG, waiver contingency, validation suite |

All rows covered; zero gaps.

## Intake outcome trace (narrative — no staged bullets to key `outcome-<n>` rows against)

- **A Claude step's 2nd+ attempts start with no conversational memory, observable from the
  dispatch** → ST-1071-1, ST-1071-2, ST-1071-3 → tasks 2, 3, 4, 5, 6, 7, 8, 9. The declaration
  flip plus the argv deletion plus per-invocation minting, applied on all three dispatch paths.
- **A retried attempt still has what it needs, from committed artifacts and the retry prompt**
  → ST-1071-5 → task 13. `buildSystemPrompt` already re-sends the full step prompt with a
  `RETRY:` prefix; task 13 proves it empirically rather than assuming it.
- **No attempt fails on a session-identifier collision between attempts of the same step** →
  ST-1071-2, ST-1071-5 → tasks 5, 12. This is the finding #1069 deferred here by name.
- **Interactive recovery paths still open on a session that knows what just failed and why** →
  ST-1071-4 → tasks 10, 11. Both call sites named: `conductor.ts:4785` and `:5808`.
- **Telemetry for a feature stays correlated across process restarts** → ST-1071-5 → task 13.
  `conductor.run.id` stability plus no per-invocation write to `.pipeline/conduct-session-id`.
- **Claude and Codex retry semantics described identically, no provider-conditional exception**
  → ST-1071-6 → task 16. This is the outcome #1069 could not satisfy alone — its own
  Consequences name the divergence it creates — and which this feature closes.

## Verification notes

- **Every intake outcome reaches at least one task.** The shortest chain is the telemetry
  outcome → ST-1071-5 → task 13; the longest is the memory-isolation outcome → three stories →
  eight tasks.
- **Every task cites exactly one story.** Verified against the plan's `**Story:**` lines — no
  comma-separated lists, which would register only the first id.
- **No orphan story; no orphan task.** All six stories appear in the task column; all sixteen
  tasks appear in a story row.
- **The dependency is mechanical, not prose.** Task 1 asserts #1069's capability seam and halts
  if absent, so the ordering constraint cannot be silently violated by a builder.
- **The two contradictions the conflict check found are closed by deliverables.** ST-1071-6 /
  task 16 amend the two accepted stories and both ADRs; task 15 inverts the assertions #1069
  deliberately preserved.
- **The one un-derisked assumption is traced.** ADR Decision 4's premise — that no autonomous
  step depends on conversational recall (92% confidence) — is carried by ST-1071-5 → task 13,
  written to fail honestly rather than be worked around by restoring resume.
- **A finding against the dependency is recorded, not buried.** #1069's claim that
  `runProviderInvocation` is "the single place resume is decided" does not hold for the two
  scalar paths; ST-1071-3 owns them, and the architecture review's F3 states the correction.
