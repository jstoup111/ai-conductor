# Coherence: Kernel-enforced live-checkout containment (#1301)

**Date:** 2026-08-17
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD; the stories file carries the
requirement layer directly).
**Outcome source:** the `## Desired outcome` bullets of jstoup111/ai-conductor#1301, staged
verbatim into `.pipeline/intake-outcomes.md` and carried into the spec by the `.docs/intake/`
marker landed with this branch.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-3, story-4 | covered | "A live-checkout change made by an operator/interactive session is distinguished from one made by a self-host dispatch." Story 3 puts every dispatch inside a namespace where the live checkout is read-only, so the two writers become structurally distinct rather than two identical diff entries; story 4 is where the guard acts on that distinction. |
| outcome | outcome-2 | story-4, story-2 | covered | "A change positively attributable to something other than the running dispatch does not halt the build; detection of a genuine self-host leak is unchanged." Story 4's happy paths assert no halt for the git-ignored and untracked cases under a proven verdict. Detection is unchanged because story 2 permits `contained` only on a two-sided kernel proof, and story 4's negative path keeps the provider-state surface halting as today. |
| outcome | outcome-3 | story-5, story-2 | covered | "Where attribution is impossible, the guard still halts — fail-closed is preserved." Story 5's happy path asserts today's halt under every unavailable verdict; story 2's negative paths force every probe failure mode to collapse to `contained: false`, so no failure can be read as attribution. |
| outcome | outcome-4 | story-5 | covered | "The halt reason names the attribution evidence." Story 5 requires each of the four unavailable reasons to be reachable from a test and present in the halt reason, and requires the reason be a strict superset of today's so no existing diagnostic is lost. |
| outcome | outcome-5 | story-4, story-1 | covered | "Config-like paths remain fingerprinted; not resolved by widening the exclusion list." Story 4's Done-When requires a diff review confirming no exclusion entry was added and that `LIVE_CHECKOUT_VOLATILE` is unchanged. Story 1 imports that list rather than editing it, so the fix cannot drift into an exclusion. |
| outcome | outcome-6 | story-5, story-4 | covered | "Regression coverage: a dispatch that writes the live checkout still halts; an operator edit during a dispatch does not." The second half is story 4's happy paths. The first half is covered in both regimes and the mechanism shifts: story 5's negative paths keep the post-hoc halt for an uncontained dispatch, and additionally require that a contained dispatch's live-checkout write fails with EROFS naming the path. The dispatch is stopped in both cases; under containment it is stopped at the write rather than after the step. |
| story | story-1 | task-2, task-12 | covered | Task 2 builds `deriveBindSet` with bind-ordering, existing-path and walk-pruning tests against a real fixture tree; task 12 proves against real bwrap that the carve-out stays writable, which is the acceptance criterion unit tests with an injected runner cannot reach. |
| story | story-2 | task-1, task-3, task-5 | covered | Task 1 defines the discriminated verdict; task 3 implements the two-sided probe and its three verdict cases; task 5 covers all four failure modes and forbids any of them reaching the `contained: true` constructor. |
| story | story-3 | task-4, task-6 | covered | Task 4 covers the command rewrite and environment preservation; task 6 covers both provider branches, `CODEX_HOME` preservation, teardown identity, and the unwrapped fallback. |
| story | story-4 | task-7, task-8 | covered | Task 7 threads the verdict with a default that leaves existing call sites unchanged; task 8 covers the git-ignored incident path, the untracked path, and the provider-state negative path. |
| story | story-5 | task-9, task-11 | covered | Task 9 covers the reason superset, the preserved PR #1127 tracked-edit amnesty, and the uncontained leak case; task 11 proves the EROFS denial against a real bind set. |
| story | story-6 | task-10, task-13 | covered | Task 10 covers the config key's default, override and malformed-value behavior. Task 13 corrects CLAUDE.md's Daemon Operations Safety section. The three `docs/` pages in story 6's Done-When are delivered by this repository's maintain-documentation custom step, as the plan's "Not in this plan" section records. |
| task | task-1 | story-2 | covered | Verdict type with discriminant narrowing. |
| task | task-2 | story-1 | covered | Bind-set derivation, ordering assertion, existence filter, pruned node_modules discovery. |
| task | task-3 | story-2 | covered | Two-sided probe: pass, writable-live-root failure, unwritable-worktree failure. |
| task | task-4 | story-3 | covered | Command rewrite with byte-equal environment passthrough. |
| task | task-5 | story-2 | covered | Absent binary, non-zero exit, timeout and unparseable output all collapse to unavailable. |
| task | task-6 | story-3 | covered | Both provider branches wrapped at the shared return shape, plus the unwrapped fallback. |
| task | task-7 | story-4 | covered | Verdict parameter with a default that preserves existing call-site behavior. |
| task | task-8 | story-4 | covered | No halt on ignored and untracked drift under a contained verdict; provider state still halts. |
| task | task-9 | story-5 | covered | Halt reason names the containment evidence and remains a superset of today's. |
| task | task-10 | story-6 | covered | Default-on config lever with malformed-value fallback. |
| task | task-11 | story-5 | covered | Real bwrap run proves a live-checkout write is denied; skipped and reported when bwrap is absent. |
| task | task-12 | story-1 | covered | Real bwrap run proves worktree, .git and .pipeline stay writable. |
| task | task-13 | story-6 | covered | CLAUDE.md Daemon Operations Safety section 5 corrected for the new behavior. |
| adr | adr-2026-08-17-structural-live-checkout-containment | story-2, story-3, story-4, story-5, story-6 | covered | Its six numbered decisions map one-to-one onto the stories: decision 1 to story 1, decision 2 to story 2, decision 3 to story 3, decision 4 to stories 4 and 5, decision 5 to story 5, decision 6 to story 6. Review conditions C1 through C5 are each carried by a named story Done-When. |
