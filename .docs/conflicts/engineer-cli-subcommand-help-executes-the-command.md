# Conflict check — engineer-cli-subcommand-help-executes-the-command (#524)

No blocking conflicts.

## Story-vs-story

Stories 1-4 partition disjoint concerns of the same argv-dispatch function:
1. `--help`/`-h` short-circuit (new guard clause, runs first).
2. Per-subcommand help text content (consumed only by Story 1's new `help` dispatch kind).
3. Unknown-flag rejection (a second, independent guard clause after Story 1's).
4. Root `--help` / generated reference completeness (a different file, `cli.ts`, purely
   additive commander declarations — never executed for dispatch).

No two stories mutate the same state in contradictory ways: Story 1 and Story 3 both add
guard clauses ahead of each subcommand's existing branch, but they check DIFFERENT
conditions (`--help` present vs. an unrecognized `--flag` present) and Story 1 is
explicitly ordered first in both the stories text and the plan (a token that is both
`--help` and — vacuously — not a recognized flag never double-fires; the `--help` check
always wins). Clean.

## Story-vs-existing-system

| Area | Interaction | Resolution |
|------|-------------|-----------|
| `detectEngineerCommand` (`engineer-cli.ts:128-252`) | Every subcommand branch currently returns its dispatch kind unconditionally, ignoring trailing argv. | Two new guard checks are inserted right after `subCmd` is read and the bare-`launch` check, before ANY subcommand branch: `--help`/`-h` → `{kind:'help'}` (Story 1), then (per-branch, after existing required-flag validation) unknown-flag → `{kind:'reject'}` (Story 3). Existing branches' bodies are otherwise untouched — no re-ordering of the `if` chain, only new early-returns. |
| `dispatchEngineer` switch (`engineer-cli.ts:502-1117`) | 12 existing `case` arms, each performing real I/O (gh, ledger, worktree, PR). | Two new arms added (`case 'help'`, `case 'reject'`), both pure (print + return), added to the switch without touching any existing arm's body. |
| Existing `engineer-cli-*.test.ts` suites (8 files under `src/conductor/test/engine/engineer/`) | Assert specific dispatch shapes for `resolve`/`land`/`handoff`/`claim`/`migrate-issue-deps`/etc. for their CURRENTLY-VALID (fully-flagged, no stray tokens) invocations. | None of the existing test invocations include `--help`/`-h` or an unrecognized flag — the new guards are additive failure-mode branches that only fire on inputs those suites never construct. Full existing suite re-run is a plan Verification step (regression safety net), not merely asserted. |
| `createProgram()` engineer subtree (`cli.ts:127-142`) | Declares only `projects`/`land`/`handoff` (partially — missing `--worktree`/`--source-ref`); `worktree`/`poll`/`claim`/`forget`/`resolve`/`migrate-issue-deps` are entirely absent from the generated `conduct-ts --help` reference. | Story 4 completes this declaration to match what `detectEngineerCommand` actually parses. Purely additive commander `.command()`/`.option()` calls — this object is never `.parse()`d for engineer dispatch (confirmed: `index.ts` only calls `renderFullHelp()` for TEXT, and engineer dispatch runs entirely through `detectEngineerCommand`/`dispatchEngineer`), so adding declarations here cannot change runtime dispatch behavior — zero risk of a second, conflicting parse path. |
| `daemon --help` guard (`index.ts:378-388`) | The precedent this work mirrors. | Read-only reference — not modified. Confirms the guard-clause SHAPE is already proven correct in this codebase; no risk of inconsistent conventions. |
| Currently in-flight daemon build | `.daemon/daemon.log` (tail, checked at spec time) shows the daemon actively building `judged-attribution-verdict-persistence` — an unrelated feature (attribution/evidence lane), touching neither `engineer-cli.ts` nor `cli.ts`. No other `.docs/plans/*` entry with a newer mtime than this spec references `engineer-cli.ts`. | No live co-modification risk at spec time. If a future concurrent build also touches `detectEngineerCommand`'s `if` chain before this one lands, the worst case is a textual (not semantic) rebase conflict — the changes here are two early-return guard clauses, trivially re-applicable after any other branch's edits. |

## Resource / ordering

- No lock/port/DB contention introduced (pure in-process argv parsing + stdout/stderr
  text).
- No ordering constraint vs. another open issue/spec — this is a self-contained bug fix,
  not a blocker for or blocked-by any other tracked work.

**Verdict: clear.**
