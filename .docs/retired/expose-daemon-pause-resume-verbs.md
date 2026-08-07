# Implementation Plan — expose-daemon-pause-resume-verbs

**Track:** Technical · **Tier:** Small · **Origin:** `jstoup111/ai-conductor#304`
**Stories:** `.docs/stories/expose-daemon-pause-resume-verbs.md`

Scope: surface the already-shipped `pause`/`resume` verbs in the commander help tree and
the two READMEs, and refresh `restart`'s stale description. **No runtime/dispatch behavior
changes** — the verbs already work (`daemon-command.ts` recognizes them; `daemon-supervisor-cli.ts`
implements them). Every task is 2–5 minutes.

---

### Task 1 — Register `pause` in the daemon help tree
File: `src/conductor/src/cli.ts` (after the `restart` declaration at `:189–191`).
Add, mirroring the existing help-only declarations (no `.action()`):

```ts
daemon
  .command('pause')
  .description('Park dispatch via a durable .daemon/PAUSED marker (no halt, in-flight work finishes); reentrant. Fleet: --all or bare repo names (e.g. daemon pause repoA repoB)')
  .option('--all', 'Pause every registered repo');
```

Done when: declaration present; no `.action()` attached; documents `--all` + named-subset;
no `--names`.

### Task 2 — Register `resume` in the daemon help tree
File: `src/conductor/src/cli.ts` (immediately after Task 1's block).

```ts
daemon
  .command('resume')
  .description('Remove the .daemon/PAUSED marker and resume dispatch; reentrant. Fleet: --all or bare repo names (e.g. daemon resume repoA repoB)')
  .option('--all', 'Resume every registered repo');
```

Done when: declaration present; no `.action()`; documents `--all` + named-subset; no `--names`.

### Task 3 — Refresh `restart`'s description + document its fleet form
File: `src/conductor/src/cli.ts:189–191`.
Replace the terse description and add the `--all` option it already supports
(`daemon-supervisor-cli.ts:222`):

```ts
daemon
  .command('restart')
  .description('Respawn the daemon in place, preserving the tmux session (and scrollback where available) — connected operators stay attached; a busy daemon queues the restart (.daemon/RESTART-PENDING). Fleet: --all or bare repo names')
  .option('--all', 'Restart every registered repo');
```

Done when: description mentions respawn-in-place / session preservation; `--all` documented;
no options/dispatch behavior for restart changed elsewhere.

### Task 4 — Add pause/resume command forms to top-level `README.md`
File: `README.md`.
(a) In the daemon verb bash block (`:246–251`), add after the `restart` line:

```bash
conduct-ts daemon pause      # park dispatch (durable .daemon/PAUSED); in-flight work finishes
conduct-ts daemon resume     # remove the pause marker and resume dispatch
```

(b) In the management-verbs sentence (`:264–266`), add `pause`/`resume` to the parenthesized
verb list (`start`/`stop`/`restart`/`pause`/`resume`/`connect`/`debug`/`status`/`logs`).
(c) Add a short fleet note showing the fleet forms:

```bash
conduct-ts daemon pause --all              # every registered repo
conduct-ts daemon pause repoA repoB        # a named subset (bare repo names — no --names flag)
```

Done when: bash block lists pause+resume; management-verbs sentence includes them; fleet forms
shown with `--all` and bare names; no `--names` anywhere.

### Task 5 — Add command forms to `src/conductor/README.md`
File: `src/conductor/README.md`, in the existing "Daemon lifecycle controls" section
(`:674–684`), right after the pause/resume prose paragraph. Insert a fenced block:

```bash
conduct daemon pause                 # this repo
conduct daemon resume                # this repo
conduct daemon pause --all           # every registered repo
conduct daemon pause repoA repoB     # a named subset (bare repo names)
conduct daemon resume --all          # (resume mirrors pause)
```

Done when: concrete forms appear next to the prose; forms use only `--all` + bare names.

### Task 6 — CHANGELOG entry
File: `CHANGELOG.md` under `## [Unreleased]` → `Changed` (CI enforces a non-empty
`[Unreleased]`):
`- daemon: surfaced pause/resume in \`conduct daemon --help\` and both READMEs; refreshed restart's help to describe respawn-in-place semantics (#304).`

Done when: entry present under `[Unreleased]`.

### Task 7 — Help-surface assertion test
Add/extend a CLI/integrity test asserting the daemon help output contains `pause` and
`resume`. Prefer the existing CLI-help test if one exists; otherwise add a focused unit
test that builds the program (the `cli.ts` builder) and asserts `daemon --help` /
recursive help text includes both verbs and does **not** reference `--names`.

Done when: a test fails if `pause`/`resume` are dropped from the help tree; green with the
new declarations.

### Task 8 — Validate & verify
- Run `test/test_harness_integrity.sh` (repo mandate).
- Build the engine (`src/conductor`) and run `conduct-ts daemon --help`; confirm `pause`
  and `resume` render with their options and `restart`'s new description shows.
- Confirm no `--names` string was introduced anywhere.

Done when: integrity suite green; `daemon --help` visibly lists pause/resume/restart with
correct descriptions; no behavioral test regressions.

---

## Notes for the builder

- These are **help-only** declarations: commander does not dispatch `daemon <verb>` — real
  dispatch is `detectDaemonSupervisorCommand` in `index.ts`, already handling pause/resume.
  Do **not** attach `.action()` handlers (would risk shadowing the pre-boot dispatch).
- The named-subset selector is **bare positional repo names**, not a `--names` flag. Do not
  add a `--names` option — it does not exist in the parser.
- No changes to `daemon-command.ts`, `daemon-supervisor-cli.ts`, `pause-marker.ts`, or any
  dispatch/marker logic. This is help + docs only.
