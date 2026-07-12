# Stories: engineer (brain) CLI — subcommand `--help` executes the command instead of printing help (#524, S)

Scope boundary (binding — issue #524): fix the swallow at its root — `detectEngineerCommand`
(`src/conductor/src/engine/engineer-cli.ts:128-252`) — so `--help`/`-h` on ANY recognized
`engineer` subcommand (`projects`, `worktree`, `land`, `handoff`, `poll`, `claim`, `forget`,
`resolve`, `migrate-issue-deps`) short-circuits to a help dispatch with **zero side effects**,
before any of that subcommand's own flag-parsing or the eventual `dispatchEngineer` mutation
runs. Also close the two related Desired-Outcome gaps from the issue: per-subcommand help
content, and unknown-flag rejection on the same subcommands (today silently ignored — the
same "swallow" failure class, just for garbage flags instead of `--help`).

Design anchor (root cause, verified): `detectEngineerCommand` dispatches purely by matching
`argv[3]` (the subcommand token) against a literal, e.g.
```
if (subCmd === 'claim') {
  return { kind: 'claim' };            // engineer-cli.ts:186-189
}
```
This branch (and every other subcommand branch, `worktree`/`land`/`handoff`/`poll`/`forget`/
`resolve`/`migrate-issue-deps`) never inspects the REST of `argv` for `--help`/`-h` before
returning a dispatch kind that `dispatchEngineer` then executes for real (gh calls, ledger
writes, worktree creation, PR opens). `engineer claim --help` therefore returns
`{kind:'claim'}` — identical to `engineer claim` — and `dispatchEngineer`'s `case 'claim':`
(`engineer-cli.ts:892-963`) runs unconditionally: dequeues the oldest pending intake entry,
transitions the ledger to `claimed`, and prints the claimed envelope as JSON. This is the
exact repro from the issue (`o/a#280` ledger flip + inbox envelope consumed by what was meant
to be a docs lookup).

The SAME failure class already has a shipped, verified fix for the sibling `daemon`
subcommand — `src/conductor/src/index.ts:378-388`:
```
// `daemon --help` / `daemon -h`: print the daemon command surface ... and exit. MUST
// precede every daemon dispatcher below — otherwise detectDaemonCommand treats `--help`
// as an unknown flag and LAUNCHES a daemon run instead of showing help (a real footgun).
if (process.argv[2] === 'daemon' && process.argv.slice(3).some((a) => a === '--help' || a === '-h')) {
  process.stdout.write(renderDaemonHelp());
  process.exit(0);
}
```
This work applies the same shape — a `--help`/`-h` guard checked BEFORE any subcommand's own
logic — inside `detectEngineerCommand` itself (rather than in `index.ts`), since `engineer`'s
entire dispatch/mutation lives in `engineer-cli.ts`, not behind commander's `program.parse()`
(confirmed: `createProgram()` in `src/conductor/src/cli.ts` is used ONLY to render help text
via `renderFullHelp()` at `index.ts:456` — it is never `.parse()`d, so it plays no role in
actual engineer dispatch and cannot itself be the fix site).

Binding non-goals:
- The bare interactive launch path (`conduct-ts engineer`, `engineer --idea "<text>"`, and the
  free-text-idea form `engineer add a /healthz endpoint`) is OUT OF SCOPE for the `--help`
  guard. These already drop a human operator into an interactive `claude /engineer` session
  (no silent background mutation) — they are not the "trap" class the issue reports. A
  trailing `--help` token in free text (e.g. `engineer add x --help`) is not addressed here.
- The #227 daemon→engine / engineer→brain rename decision is NOT re-litigated or pre-empted
  here — all new help text uses the SAME dual-naming already present in this codebase today
  (e.g. `cli.ts:129` "Supervisor engineer", HARNESS.md "engineer (brain)") so it reads
  correctly whichever way #227 lands.

---

## Story 1: `--help`/`-h` on any engineer subcommand short-circuits to help, with zero side effects

As the operator of the engineer CLI, I want `--help` (or `-h`) anywhere after an engineer
subcommand token to print usage and do NOTHING else, so a documentation lookup can never
mutate the ledger, inbox, worktrees, or open a PR.

**Happy path**
- Given `detectEngineerCommand` is called with argv for any recognized subcommand
  (`projects`, `worktree`, `land`, `handoff`, `poll`, `claim`, `forget`, `resolve`,
  `migrate-issue-deps`) followed anywhere by `--help` or `-h` (e.g.
  `engineer claim --help`, `engineer land --help --project x`, `engineer resolve o/a#1 -h`),
- When the argv is parsed,
- Then the returned dispatch is `{kind:'help', topic: <subcommand>}` — NOT the subcommand's
  normal mutating/query kind — and `dispatchEngineer` prints subcommand-specific usage to
  stdout and returns exit code 0 without calling `gh`, the ledger, the intake queue, or any
  worktree/PR primitive.

**Negative path (the exact #524 repro no longer executes)**
- Given `engineer claim --help` (the issue's literal repro),
- When dispatched,
- Then the inbox is NOT dequeued, the ledger is NOT transitioned to `claimed`, and no
  envelope JSON (other than the help text) is printed — contrast with today's behavior
  where this exact invocation silently claims and consumes a live intake entry.

---

## Story 2: Each subcommand's help documents what it does, its flags, what it mutates, and where it fits in the idea→spec loop

As an operator unfamiliar with the engineer CLI, I want each subcommand's `--help` output to
explain its purpose, accepted flags, the state it mutates (or "read-only" / "none"), and its
place in the idea→spec loop (claim → worktree → land → handoff → resolve/forget), so I can
learn the workflow from the CLI itself without repo-history knowledge.

**Happy path**
- Given `engineer <sub> --help` for each of `projects`, `worktree`, `land`, `handoff`, `poll`,
  `claim`, `forget`, `resolve`, `migrate-issue-deps`,
- When the help text is printed,
- Then it names the subcommand, states what it does in one sentence, lists every flag it
  accepts (required vs. optional), states what durable state it mutates (e.g. `claim`:
  "dequeues from the inbox, transitions the ledger entry to `claimed`"; `projects`:
  "read-only"), and names the adjacent step(s) in the loop (e.g. `land`'s help mentions it
  follows `worktree` and precedes `handoff`).

**Negative path (missing/incomplete help is a regression, not a silent gap)**
- Given a NEW engineer subcommand is added in the future without updating the help map,
- When its `--help` is invoked,
- Then a test asserts every entry in the subcommand-dispatch table (the `KNOWN_SUBCOMMANDS`/
  allowlist introduced by Story 1) has a corresponding help-text entry — so a subcommand
  added without help coverage fails a test rather than silently falling through to no help
  or the generic top-level guide text.

---

## Story 3: Unknown flags on an engineer subcommand are rejected, not silently swallowed

As the operator of the engineer CLI, I want an unrecognized `--flag` on a subcommand invocation
to be rejected with a clear error and exit 1, and cause NO state change, so a typo'd flag can
never be silently ignored and the intended (but unexecuted) mutation mistaken for having
happened — the same "swallow" failure class as Story 1, for garbage flags instead of `--help`.

**Happy path**
- Given a subcommand invocation with a flag NOT in that subcommand's known set (e.g.
  `engineer claim --verbose`, `engineer land --project x --idea y --worktree z --dry-run`,
  `engineer forget o/a#1 --force`),
- When parsed (after the Story 1 `--help` check, which always takes precedence if both are
  present),
- Then `detectEngineerCommand` returns a rejection dispatch (not the subcommand's normal
  kind), `dispatchEngineer` prints `engineer <sub>: unknown flag '<flag>' — run
  \`engineer <sub> --help\` for usage.` to stderr, and returns exit 1 — and no gh/ledger/
  worktree/PR primitive runs.

**Negative path (existing valid invocations are never rejected — no regression)**
- Given every subcommand invocation shape already covered by the existing
  `engineer-cli-*.test.ts` suites (e.g. `land --project x --idea y --worktree z
  [--source-ref r]`, `resolve <ref> --pr-url <url> [--branch <b>]`,
  `migrate-issue-deps [--confirm]`), none of which include a stray unrecognized flag,
- When re-run after this change,
- Then every one still parses to its ORIGINAL dispatch kind and payload — the new rejection
  path only fires on a flag outside the documented set; it never rejects a previously-valid,
  fully-recognized invocation. (This is also validated by NOT touching the existing
  missing-required-flag → `{kind:'guide'}` behavior, which stays exactly as-is; unknown-flag
  rejection is a NEW, additional failure mode, not a replacement for the existing one.)

---

## Story 4: The root `conduct-ts --help` names both loops and points to `engineer --help`; the generated reference is complete

As a new operator running `conduct-ts --help` for the first time, I want the output to name
BOTH loops this CLI runs (the build/ship daemon, and the engineer/brain idea→spec loop) and
tell me to run `engineer --help` for the latter, so the primary planning entry point is
discoverable without insider knowledge — closing the gap the issue calls out ("a consumer
without repo-history knowledge cannot learn the brain/engineer workflow from the CLI").

**Happy path**
- Given `conduct-ts --help` (root, no subcommand),
- When `renderFullHelp()` renders the top-level program description
  (`src/conductor/src/cli.ts`, `createBaseProgram`/`createProgram`),
- Then the description text names both the build/ship daemon loop and the engineer/brain
  idea→spec loop, and directs the reader to `engineer --help` for the latter's full command
  reference.
- And separately, the generated per-subcommand reference for `engineer` in
  `renderFullHelp()`'s walked commander tree (`cli.ts` `createProgram()`, currently declaring
  only `projects`/`land`/`handoff` at lines 130-142, missing `worktree`/`poll`/`claim`/
  `forget`/`resolve`/`migrate-issue-deps` entirely, and missing `land`'s `--worktree`/
  `--source-ref` flags and `handoff`'s `--worktree`/`--source-ref` flags) is completed so
  every subcommand and every flag `detectEngineerCommand` actually recognizes appears in the
  generated `conduct-ts --help` output too — not just in the runtime `--help`/`-h` guard from
  Story 1.

**Negative path (naming survives the #227 rename either way)**
- Given the #227 daemon→engine / engineer→brain rename has NOT yet landed at the time this
  ships,
- When the new root-help and per-subcommand help text is written,
- Then it uses the dual-naming already established elsewhere in this codebase (e.g.
  "engineer (brain)", "Supervisor engineer") rather than committing to one name exclusively —
  so neither outcome of #227 makes this help text wrong or requires an immediate follow-up
  edit.

Status: Accepted
