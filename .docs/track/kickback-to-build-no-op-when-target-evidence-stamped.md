# Track: Kickback to build is a no-op when the target task's evidence is still stamped (#647)

Track: technical

## Rationale

Internal daemon/engine correctness fix. A blocking SHIP-gate review (`architecture_review_as_built`,
`prd_audit`, `finish`) routes rework back to `build` via the remediation kickback machinery
(`src/conductor/src/engine/conductor.ts:3046-3097` for as-built/finish, `:2920-3016` for prd_audit,
`planRemediation` at `:871-930`). But the build step's completion is derived from on-disk task
evidence (`autoheal.ts` `deriveCompletion` ~`:791`, via `gate-verdicts.ts` `checkGateCompletion`),
and when the kicked-back task(s) are already evidence-complete the re-entered build gate passes
instantly with zero new commits — so the "self-heal in BUILD" does nothing. The re-review re-runs on
byte-identical code and returns the same verdict; this loops until the kickback cap
(`MAX_KICKBACKS_PER_GATE`, `conductor.ts:196-201`) or a retry budget is exhausted. Live incident
2026-07-13 (feature `2026-07-12-wiring-reachability-gate`, kickback
`adr-2026-07-12-wiring-check-gate→build` 19:45Z): build gate-passed in 23s, worktree tip unchanged,
6 identical BLOCKED as-built reviews, retries burned, operator intervention.

No user-facing product capability, no new command, no new config surface (a config *flag* to
disable the new escalation is additive/optional). Acceptance criteria live directly in stories. →
**technical track** (skip `/prd`).

## Approaches weighed (explore)

1. **Escalate the silent no-op; keep remediation's existing "new gap task" self-heal (chosen).**
   Two deterministic guards at the existing kickback→build seam, reusing signals the engine already
   records: (a) a **route-into-no-op guard** — when `planRemediation` routes to `build`, recompute
   build completion from disk *after* the append+re-seed; if build is already satisfied (the append
   was empty or an idempotent no-op on an already-complete `rem-*` task), do not route into a
   guaranteed no-op — HALT with the gap ledger; (b) a **zero-progress + unchanged-verdict
   escalation** — when a build re-entered via a kickback ends with no net progress
   (`headShaAfterBuild == headShaBeforeBuild` AND `lastResolvedCount` unchanged, `conductor.ts:1642`,
   `:2139`, `:2243`) AND the re-run gate verdict/reviewer finding is unchanged from the prior
   kickback's, HALT (with both artifacts) instead of re-kicking. Reuses tested primitives
   (`currentCommitSha`, `countResolvedTasks`, `readVerdict`, `kickbackCounts`). Fixes the incident
   class deterministically without touching the completion-evidence authority.

2. **Literally invalidate the target task's completion stamp on kickback (rejected — tangled).**
   The kickback does **not** carry the offending plan-task id: the remediation disposition `id` is an
   FR/ADR id (`adr-2026-07-12-wiring-check-gate`), and the tasks it emits are *new* `rem-<source>-<id>`
   ids (`remediation-append.ts:96-97`), never a reference to the plan task that was wrongly stamped.
   Deriving "which existing plan task does this prose ADR finding map to" is an LLM matching project.
   Worse, completion is **trailer-authoritative** (`autoheal.ts` header: "authoritative source of task
   completion — deriveCompletion() (trailer + …)"), so deleting a task-evidence *stamp* does not
   demote a task that also has a commit trailer — stamp surgery is not a reliable small fix and drags
   in the completion-derivation core. Explicitly a non-goal (see stories/plan).

3. **Cap-only (bump/lower `MAX_KICKBACKS_PER_GATE`).** Rejected: turns an infinite loop into a
   shorter loop that still burns N wasted reviews + retries and still dead-ends in a generic
   "retries exhausted" HALT that does not say *what input never changed* (issue Outcome 3). Does not
   distinguish "did work / reviewer wrong" from "did nothing / silently complete."

4. **Make the /remediate agent always emit a fresh unstamped task (prompt fix).** Rejected per
   CLAUDE.md deterministic-first: idempotent upsert on a still-blocking gap is correct behaviour
   (one task per logical gap, `remediation-append.ts:100-127`); the engine — not prompt discipline —
   must decide what to do when a re-dispatch cannot produce new work.

Filer hypotheses from #647 enter as candidates per the Embedded Design Divergence Rule; the issue's
Outcome 1 clause "**or records a new gap work-item**" is already implemented by remediation-append —
approach 1 makes that path *loud when it produces nothing* rather than adding a parallel stamp-
invalidation mechanism. Outcomes 2 and 3 are implemented in full.
