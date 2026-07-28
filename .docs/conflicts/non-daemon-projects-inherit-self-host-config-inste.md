# Conflict Check: Deterministic project-config scaffolding (#683)

**Verdict: CLEAR — no blocking conflicts.** Three adjacencies are noted below with the seam that
keeps them disjoint. Two internal overlaps within this spec's own stories are resolved by
ordering.

## Internal consistency (stories 1-6)

| Pair | Potential conflict | Resolution |
|---|---|---|
| Story 1 (template) × Story 2 (`create` writes it) | Story 2 asserts the scaffolded file matches the template, so it cannot land before the template exists | Ordering dependency: Story 1 precedes Story 2. Recorded in the plan's dependency tree |
| Story 2 (`create`) × Story 3 (`config init`) | Both write the same asset; a duplicated write implementation would drift | Both call one shared writer helper; `create` and `config init` differ only in their pre-conditions (empty target vs refuse-to-clobber existing file) |
| Story 4 (error message) × Story 3 (`config init`) | Story 4's message names `conduct-ts config init`, which Story 3 introduces | Ordering dependency: Story 3 precedes Story 4, else the message names a command that does not exist |
| Story 5 (docs) × Stories 2-4 | Docs describe behavior the code stories introduce | Docs land in the same PR, after the behavior stories, per the repo's same-PR documentation rule |

No two stories claim the same file for contradictory purposes. `registry-cli.ts` is touched only
by Story 2; `config.ts` only by Story 4; the templates directory only by Story 1.

## External adjacencies

**#967 — daemon merged configuration (`.docs/plans/2026-07-26-daemon-merged-config-967.md`).**
That work consumes `loadMergedConfig` in `runDaemonMode` and explicitly commits to not changing
`mergeConfigs` or the merge semantics. This spec does **not** modify `loadMergedConfig`,
`mergeConfigs`, or `user-config.ts` — it changes only the missing-file *message* inside
`loadConfig` (Story 4). Disjoint. **No conflict.**

> Noted for the record, deliberately out of scope: `loadMergedConfig` returns early when the
> project config is missing (`config.ts:1674`), so user-level config is not merged for a project
> that has no project file. Once this spec's scaffolder exists, far fewer projects hit that path.
> Whether the early return is itself a defect is a separate question and is **not** addressed
> here; raising it as its own issue is the appropriate follow-up.

**#1000 / #1001 / #1002 / #1025 — config validation defects.** These concern `validateConfig`
behavior: input mutation dropping user-level keys (#1000), `gate_code_validity` rejected as
unknown (#1001), `build_review`/`ci_watch` block discarding (#1002), and keys with no consumer
(#1025). All operate on the *validation* path for config that already exists. This spec adds a
*seeding* path and does not alter validation rules or the allow-list. Adjacent but disjoint.
**No conflict.** Story 1's acceptance criterion (the template's keys pass project-source
validation) consumes the allow-list as-is and stays correct under any of those fixes.

**#1012 — `conduct-ts --help` disagrees with behavior.** This spec adds a subcommand
(`config init`), which adds a help entry. If #1012 lands first, this spec's help text must be
consistent with the corrected format; if this lands first, #1012's audit should include the new
subcommand. Ordering-sensitive documentation only, no code contention. **No conflict.**

## Resource and state contention

- **No shared runtime state.** The scaffolder is a one-shot file write at onboarding; it holds no
  lock, touches no `.pipeline/` or `.daemon/` state, and runs outside any build.
- **No migration.** Existing repos are untouched unless the operator explicitly runs
  `config init`, which refuses to clobber.
- **The harness repo's own config is inert to this change** — no code path reads it as a seed
  source before or after, and self-host detection remains path-based (`detector.ts:46-57`).
