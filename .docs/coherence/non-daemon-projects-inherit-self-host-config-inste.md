# Coherence: Deterministic project-config scaffolding (#683)

Plan stem: `non-daemon-projects-inherit-self-host-config-inste`. Tier M, technical track — the
`fr` row class is omitted (no PRD; acceptance criteria live in the stories). The `outcome` row
class is also omitted: there are no staged intake-outcome bullets in this worktree, so the four
"Desired outcome" bullets of intake issue `jstoup111/ai-conductor#683` are traced narratively
below rather than as resolvable rows. Story ids `S1`–`S6` are the `## Story <n>:` headings in the
stories file; task ids `1`–`6` are the plan's task tree.

| Row class | Id | Counterpart id(s) | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| story | story-S1 | task-1 | covered | Task 1 authors the project-scoped template and its guard test |
| story | story-S2 | task-2 | covered | Task 2 adds the shared writer and calls it from `runCreate`, with the leak-guard assertion |
| story | story-S3 | task-3 | covered | Task 3 adds `conduct-ts config init` and repoints the bootstrap skill at it |
| story | story-S4 | task-4 | covered | Task 4 replaces the `bin/migrate` remedy in the missing-config message |
| story | story-S5 | task-5 | covered | Task 5 updates quickstart, multiprovider, configuration.md, cli.md, and CHANGELOG |
| story | story-S6 | task-6 | covered | Task 6 corrects decision 016 and sweeps for other seeding claims |
| task | task-1 | story-S1 | covered | Template asset + template-content guard test |
| task | task-2 | story-S2 | covered | Shared writer helper + `runCreate` wiring + scaffold-set and leak-guard assertions |
| task | task-3 | story-S3 | covered | `config init` dispatch, idempotence, refuse-to-clobber, non-git rejection |
| task | task-4 | story-S4 | covered | `loadConfig` missing-file message; malformed-config classification unchanged |
| task | task-5 | story-S5 | covered | Documentation reconciliation + CHANGELOG entry |
| task | task-6 | story-S6 | covered | Decision 016 correction |

All rows covered; zero gaps.

## Intake outcome trace (narrative)

The four "Desired outcome" bullets of `jstoup111/ai-conductor#683`, each mapped to the stories
that satisfy it:

1. **A newly bootstrapped / created project starts self-host-free.** Covered by S1 (the template
   forbids the self-host keys), S2 (a scaffolded repo's config is asserted to contain none of
   them — the issue's literal observable), and S3 (the same seed reaches existing repos).
2. **Self-host keys never originate from a copy of the harness repo's config.** Covered by S1/S2/S3
   — the writer resolves only `templates/project-config.yml.template` — and by S5, which deletes
   the hand-copy-from-the-checkout instruction that was the sole route by which the harness config
   could become the source.
3. **Documented behavior matches reality.** Covered by S4 (the stale `bin/migrate` remedy), S5
   (quickstart, multiprovider, configuration.md, cli.md), and S6 (the false decision-016 claim).
4. **Negative path — a genuine self-host build still gets its full guardrail config, and a
   consumer can still set any key by hand.** Covered by S1 and S2, which assert both
   `templates/ai-conductor-config.yml.template` and the harness's own `.ai-conductor/config.yml`
   are unchanged, and by S3's refuse-to-clobber criterion, which preserves an operator's hand-set
   keys. Self-host activation is a positive-only realpath match (`detector.ts:46-57`) and is
   untouched — recorded as an invariant in the architecture doc and a prerequisite in the plan.

## Notes on deliberate non-coverage

The issue's Hypotheses section proposed making the self-host guardrail keys auto-detected or
rejected in consumer configs. That is **intentionally not traced to a story or task** — it is
recorded as a rejected alternative in `adr-2026-07-27-project-config-scaffolder.md` with its
rationale (most keys are already self-guarding; hard-rejecting the four harmful ones would break
the harness's own config and conflicts with outcome O4's "a consumer can still set any of these
keys by hand"). Defence-in-depth for already-polluted configs is named there as follow-up work,
not silently dropped.

The issue's README complaint (`README.md:891-1026`) is likewise **not traced**: that section was
deleted by `2dd65cd7f` (#1030) and no longer exists. Recorded as finding F3 in the architecture
review.

`loadMergedConfig`'s early return on a missing project config (`config.ts:1674`), discovered
during exploration, is out of scope by design and recorded in the conflict report as a
follow-up — it is not an outcome of #683 and changing it would touch #967's seam.

Verdicts confirmed against the stories and plan files in this worktree.
